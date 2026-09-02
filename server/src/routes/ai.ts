import { Router, type Request, type Response } from "express";
import multer from "multer";
import { getAiConfig } from "../db.js";
import { authenticateToken } from "../middleware/auth.js";

export const aiRouter = Router();

// Route Guard: Protect all /api/ai endpoints with JWT authentication
aiRouter.use(authenticateToken);

// Multer memory storage middleware for multipart image edits
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max upload per file
});

/**
 * Redact API key from string or JSON data to prevent zero-day credential leaks
 */
function sanitizeString(content: string, apiKey?: string): string {
  if (!content) return content;
  if (!apiKey || apiKey.trim().length < 4) return content;
  return content.replaceAll(apiKey.trim(), "[REDACTED]");
}

function sanitizeData<T>(data: T, apiKey?: string): T {
  if (!data) return data;
  if (!apiKey || apiKey.trim().length < 4) return data;
  try {
    const jsonStr = typeof data === "string" ? data : JSON.stringify(data);
    if (jsonStr.includes(apiKey.trim())) {
      const cleaned = jsonStr.replaceAll(apiKey.trim(), "[REDACTED]");
      return typeof data === "string" ? (cleaned as unknown as T) : JSON.parse(cleaned);
    }
  } catch {}
  return data;
}

/**
 * Retrieve and normalize current AI configuration from SQLite DB
 */
function getActiveAiConfig() {
  const config = getAiConfig();
  const apiKey = (config.apiKey || "").trim();
  const baseUrl = (config.baseUrl || "https://api.openai.com/v1").trim().replace(/\/+$/, "");
  const isConfigured = apiKey.length > 0;

  return {
    isConfigured,
    baseUrl,
    apiKey,
    imageModels: config.imageModels,
    defaultModel: config.defaultModel,
    chatModels: config.chatModels,
    timeoutMs: config.timeoutMs || 300000,
    customHeaders: config.customHeaders || {},
  };
}

// ==========================================
// 1. GET /api/ai/models
// ==========================================
aiRouter.get("/models", (_req: Request, res: Response) => {
  const config = getActiveAiConfig();
  res.json({
    imageModels: config.imageModels,
    defaultModel: config.defaultModel,
    defaultImageModel: config.defaultModel,
    chatModels: config.chatModels,
  });
});

// ==========================================
// 2. POST /api/ai/images/generations
// ==========================================
aiRouter.post("/images/generations", async (req: Request, res: Response) => {
  const config = getActiveAiConfig();

  if (!config.isConfigured) {
    res.status(503).json({
      success: false,
      error: {
        code: "AI_NOT_CONFIGURED",
        message: "AI service is not configured by administrator",
      },
      message: "AI service is not configured by administrator",
    });
    return;
  }

  const { prompt, model, ...rest } = req.body || {};

  if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
    res.status(400).json({
      success: false,
      error: {
        code: "INVALID_PROMPT",
        message: "Prompt is required and cannot be empty",
      },
      message: "Prompt is required and cannot be empty",
    });
    return;
  }

  const forwardPayload = {
    ...rest,
    prompt: prompt.trim(),
    model: model || config.defaultModel || "dall-e-3",
  };

  try {
    const upstreamUrl = `${config.baseUrl}/images/generations`;
    const upstreamHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    };
    if (config.customHeaders) {
      Object.assign(upstreamHeaders, config.customHeaders);
    }

    const upstreamRes = await fetch(upstreamUrl, {
      method: "POST",
      headers: upstreamHeaders,
      body: JSON.stringify(forwardPayload),
      signal: AbortSignal.timeout(config.timeoutMs || 300000),
    });

    const rawText = await upstreamRes.text();
    let parsedData: any = rawText;
    try {
      parsedData = JSON.parse(rawText);
    } catch {}

    const sanitizedData = sanitizeData(parsedData, config.apiKey);

    if (upstreamRes.ok) {
      res.status(upstreamRes.status).json(sanitizedData);
      return;
    }

    // Upstream error status code mapping
    let mappedStatus = upstreamRes.status;
    if (upstreamRes.status === 429) {
      mappedStatus = 429;
    } else if (upstreamRes.status === 401 || upstreamRes.status === 403) {
      mappedStatus = 502; // Hide upstream auth error as Bad Gateway
    } else if (upstreamRes.status >= 500) {
      mappedStatus = 502;
    }

    res.status(mappedStatus).json(sanitizedData);
  } catch (err: any) {
    const isTimeout = err.name === "TimeoutError" || err.name === "AbortError";
    res.status(502).json({
      success: false,
      error: {
        code: isTimeout ? "GATEWAY_TIMEOUT" : "BAD_GATEWAY",
        message: isTimeout ? "AI upstream request timed out" : (err.message || "Failed to connect to upstream AI service"),
      },
      message: isTimeout ? "AI upstream request timed out" : (err.message || "Failed to connect to upstream AI service"),
    });
  }
});

// ==========================================
// 3. POST /api/ai/images/edits
// ==========================================
aiRouter.post("/images/edits", upload.any(), async (req: Request, res: Response) => {
  const config = getActiveAiConfig();

  if (!config.isConfigured) {
    res.status(503).json({
      success: false,
      error: {
        code: "AI_NOT_CONFIGURED",
        message: "AI service is not configured by administrator",
      },
      message: "AI service is not configured by administrator",
    });
    return;
  }

  const prompt = req.body?.prompt;
  if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
    res.status(400).json({
      success: false,
      error: {
        code: "INVALID_PROMPT",
        message: "Prompt is required and cannot be empty",
      },
      message: "Prompt is required and cannot be empty",
    });
    return;
  }

  try {
    const upstreamUrl = `${config.baseUrl}/images/edits`;
    const files = (req.files as Express.Multer.File[]) || [];
    let fetchOptions: RequestInit;

    if (files.length > 0) {
      // Rebuild multipart form data with blobs
      const formData = new FormData();
      for (const [key, value] of Object.entries(req.body)) {
        if (typeof value === "string") {
          formData.append(key, value);
        }
      }
      if (!req.body.model) {
        formData.append("model", config.defaultModel || "gpt-image-2");
      }
      for (const file of files) {
        const blob = new Blob([file.buffer], { type: file.mimetype || "image/png" });
        formData.append(file.fieldname, blob, file.originalname || "image.png");
      }

      const headers: Record<string, string> = {
        Authorization: `Bearer ${config.apiKey}`,
      };
      if (config.customHeaders) {
        Object.assign(headers, config.customHeaders);
      }

      fetchOptions = {
        method: "POST",
        headers,
        body: formData,
        signal: AbortSignal.timeout(config.timeoutMs || 300000),
      };
    } else {
      // Direct JSON forwarding
      const forwardPayload = {
        ...req.body,
        model: req.body.model || config.defaultModel || "gpt-image-2",
      };
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      };
      if (config.customHeaders) {
        Object.assign(headers, config.customHeaders);
      }

      fetchOptions = {
        method: "POST",
        headers,
        body: JSON.stringify(forwardPayload),
        signal: AbortSignal.timeout(config.timeoutMs || 300000),
      };
    }

    const upstreamRes = await fetch(upstreamUrl, fetchOptions);
    const rawText = await upstreamRes.text();
    let parsedData: any = rawText;
    try {
      parsedData = JSON.parse(rawText);
    } catch {}

    const sanitizedData = sanitizeData(parsedData, config.apiKey);

    if (upstreamRes.ok) {
      res.status(upstreamRes.status).json(sanitizedData);
      return;
    }

    let mappedStatus = upstreamRes.status;
    if (upstreamRes.status === 429) {
      mappedStatus = 429;
    } else if (upstreamRes.status === 401 || upstreamRes.status === 403 || upstreamRes.status >= 500) {
      mappedStatus = 502;
    }

    res.status(mappedStatus).json(sanitizedData);
  } catch (err: any) {
    const isTimeout = err.name === "TimeoutError" || err.name === "AbortError";
    res.status(502).json({
      success: false,
      error: {
        code: isTimeout ? "GATEWAY_TIMEOUT" : "BAD_GATEWAY",
        message: isTimeout ? "AI upstream request timed out" : "Failed to connect to upstream AI service",
      },
      message: isTimeout ? "AI upstream request timed out" : "Failed to connect to upstream AI service",
    });
  }
});

// ==========================================
// 4. POST /api/ai/chat/completions (SSE Stream & Non-Stream)
// ==========================================
aiRouter.post("/chat/completions", async (req: Request, res: Response) => {
  const config = getActiveAiConfig();

  if (!config.isConfigured) {
    res.status(503).json({
      success: false,
      error: {
        code: "AI_NOT_CONFIGURED",
        message: "AI service is not configured by administrator",
      },
      message: "AI service is not configured by administrator",
    });
    return;
  }

  const { messages, model, stream, ...rest } = req.body || {};

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({
      success: false,
      error: {
        code: "MISSING_MESSAGES",
        message: "Messages array is required and must not be empty",
      },
      message: "Messages array is required and must not be empty",
    });
    return;
  }

  const forwardPayload = {
    ...rest,
    messages,
    model: model || (config.chatModels && config.chatModels[0]) || "gpt-4o",
    stream: Boolean(stream),
  };

  const isStream = Boolean(stream);
  const upstreamUrl = `${config.baseUrl}/chat/completions`;

  if (isStream) {
    // Graceful client abort handling
    const abortController = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    try {
      const upstreamRes = await fetch(upstreamUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(forwardPayload),
        signal: abortController.signal,
      });

      if (!upstreamRes.ok) {
        const errorText = await upstreamRes.text();
        let parsedData: any = errorText;
        try {
          parsedData = JSON.parse(errorText);
        } catch {}

        const sanitizedData = sanitizeData(parsedData, config.apiKey);
        let mappedStatus = upstreamRes.status;
        if (upstreamRes.status === 429) mappedStatus = 429;
        else if (upstreamRes.status >= 500 || upstreamRes.status === 401 || upstreamRes.status === 403) mappedStatus = 502;

        res.status(mappedStatus).json(sanitizedData);
        return;
      }

      // Set SSE headers
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      if (!upstreamRes.body) {
        res.end();
        return;
      }

      const reader = upstreamRes.body.getReader();
      const decoder = new TextDecoder("utf-8");

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const rawChunk = decoder.decode(value, { stream: true });
          const sanitizedChunk = sanitizeString(rawChunk, config.apiKey);
          res.write(sanitizedChunk);
        }
      } catch (readErr: any) {
        if (readErr.name !== "AbortError") {
          console.error("Error piping upstream SSE stream:", readErr);
        }
      } finally {
        res.end();
      }
    } catch (err: any) {
      const isTimeout = err.name === "TimeoutError" || err.name === "AbortError";
      if (!res.headersSent) {
        res.status(502).json({
          success: false,
          error: {
            code: isTimeout ? "GATEWAY_TIMEOUT" : "BAD_GATEWAY",
            message: "Failed to establish AI streaming connection",
          },
          message: isTimeout ? "AI upstream request timed out" : "Failed to connect to upstream AI service",
        });
      }
    }
  } else {
    // Non-streaming JSON response
    try {
      const upstreamRes = await fetch(upstreamUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(forwardPayload),
        signal: AbortSignal.timeout(config.timeoutMs || 180000),
      });

      const rawText = await upstreamRes.text();
      let parsedData: any = rawText;
      try {
        parsedData = JSON.parse(rawText);
      } catch {}

      const sanitizedData = sanitizeData(parsedData, config.apiKey);

      if (upstreamRes.ok) {
        res.status(upstreamRes.status).json(sanitizedData);
        return;
      }

      let mappedStatus = upstreamRes.status;
      if (upstreamRes.status === 429) mappedStatus = 429;
      else if (upstreamRes.status >= 500 || upstreamRes.status === 401 || upstreamRes.status === 403) mappedStatus = 502;

      res.status(mappedStatus).json(sanitizedData);
    } catch (err: any) {
      const isTimeout = err.name === "TimeoutError" || err.name === "AbortError";
      res.status(502).json({
        success: false,
        error: {
          code: isTimeout ? "GATEWAY_TIMEOUT" : "BAD_GATEWAY",
          message: isTimeout ? "AI upstream request timed out" : "Failed to connect to upstream AI service",
        },
        message: isTimeout ? "AI upstream request timed out" : "Failed to connect to upstream AI service",
      });
    }
  }
});
