import { Router, type Request, type Response } from "express";
import multer from "multer";
import { getAiConfig } from "../db.js";
import { authenticateToken } from "../middleware/auth.js";
import { categorizeModels } from "./admin/channels.js";
import { AiRouter, getAggregatedModels, getCandidateChannels } from "../services/ai-router.js";
import { AiAuditService } from "../services/ai-audit.js";

export const aiRouter = Router();

// Route Guard: Protect all /api/ai endpoints with JWT authentication
aiRouter.use(authenticateToken);

// Multer memory storage middleware for multipart image edits
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max upload per file
});

// ============================================================================
// 1. GET /api/ai/models - Aggregate models across all active channels
// ============================================================================
aiRouter.get("/models", (_req: Request, res: Response) => {
  const aggregated = getAggregatedModels();
  res.json(aggregated);
});

// ============================================================================
// 2. POST /api/ai/models/probe - Test probe upstream models endpoint
// ============================================================================
aiRouter.post("/models/probe", async (req: Request, res: Response) => {
  const currentConfig = getAiConfig();
  const rawBaseUrl = (typeof req.body?.baseUrl === "string" && req.body.baseUrl.trim()) || currentConfig.baseUrl;
  const rawApiKey = (typeof req.body?.apiKey === "string" && req.body.apiKey.trim() && !req.body.apiKey.includes("****"))
    ? req.body.apiKey.trim()
    : currentConfig.apiKey;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawBaseUrl);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error("Invalid protocol");
    }
  } catch {
    res.status(400).json({
      success: false,
      message: "Base URL 格式不正确，必须以 http:// 或 https:// 开头",
    });
    return;
  }

  const cleanBase = rawBaseUrl.replace(/\/+$/, "");
  const candidateUrls: string[] = [];
  if (cleanBase.endsWith("/models")) {
    candidateUrls.push(cleanBase);
  } else {
    candidateUrls.push(`${cleanBase}/models`);
    if (!cleanBase.endsWith("/v1")) {
      candidateUrls.push(`${cleanBase}/v1/models`);
    } else {
      candidateUrls.push(`${cleanBase.replace(/\/v1$/, "")}/models`);
    }
  }

  const startTime = Date.now();
  let lastError = "";
  let lastStatus = 500;

  for (const probeUrl of candidateUrls) {
    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        "User-Agent": "InfiniteCanvas/1.0",
      };
      if (rawApiKey) {
        headers["Authorization"] = `Bearer ${rawApiKey}`;
      }
      if (currentConfig.customHeaders) {
        Object.assign(headers, currentConfig.customHeaders);
      }

      const response = await fetch(probeUrl, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(8000),
      });

      const latencyMs = Date.now() - startTime;

      if (response.ok) {
        const data = (await response.json()) as any;
        let rawItems: any[] = [];

        if (Array.isArray(data)) {
          rawItems = data;
        } else if (Array.isArray(data?.data)) {
          rawItems = data.data;
        } else if (Array.isArray(data?.models)) {
          rawItems = data.models;
        }

        let modelIds = rawItems
          .map((m: any) => {
            if (typeof m === "string") return m;
            const raw = m?.id || m?.name || m?.model_id || m?.model;
            return typeof raw === "string" ? raw.replace(/^models\//, "") : "";
          })
          .filter((id) => typeof id === "string" && id.trim().length > 0);

        modelIds = Array.from(new Set(modelIds)).sort();

        if (modelIds.length > 0) {
          const categorized = categorizeModels(modelIds);
          res.json({
            success: true,
            latencyMs,
            total: modelIds.length,
            probeUrl,
            ...categorized,
          });
          return;
        }
      }

      lastStatus = response.status;
      if (response.status === 401 || response.status === 403) {
        lastError = `上游接口鉴权失败 (HTTP ${response.status})：API Key 无效或未提供。`;
        break;
      }

      const errorBody = await response.text().catch(() => "");
      lastError = `上游接口返回 HTTP ${response.status}: ${errorBody.slice(0, 150) || response.statusText}`;
    } catch (err: any) {
      const isTimeout = err.name === "TimeoutError" || err.name === "AbortError";
      lastError = isTimeout ? "连接上游超时 (8000ms)，请检查网络或代理" : (err.message || "请求失败");
    }
  }

  const latencyMs = Date.now() - startTime;
  let responseStatus = 502;
  if (lastStatus >= 400 && lastStatus < 600 && lastStatus !== 401 && lastStatus !== 403) {
    responseStatus = lastStatus;
  }
  res.status(responseStatus).json({
    success: false,
    latencyMs,
    message: lastError || "未能从上游接口获取到任何模型，请核对 Base URL 与 API Key",
  });
});

function extractChatPromptPreview(messages: any[]): string {
  if (!Array.isArray(messages) || messages.length === 0) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role === "user") {
      if (typeof msg.content === "string") {
        return msg.content.slice(0, 500);
      }
      if (Array.isArray(msg.content)) {
        const textPart = msg.content.find((p: any) => p?.type === "text");
        if (typeof textPart?.text === "string") {
          return textPart.text.slice(0, 500);
        }
      }
    }
  }
  const last = messages[messages.length - 1];
  return typeof last?.content === "string" ? last.content.slice(0, 500) : "";
}

function resolveChannelAndRetries(targetModel: string, channelUsed?: string, isSuccess = true) {
  const candidates = getCandidateChannels(targetModel);
  const attempts = candidates.slice(0, 3);
  const channelIdx = channelUsed ? attempts.findIndex((c) => c.name === channelUsed) : -1;
  const channelId = channelIdx >= 0 ? attempts[channelIdx].id : candidates[0]?.id || null;
  const channelName = channelIdx >= 0 ? attempts[channelIdx].name : channelUsed || candidates[0]?.name || null;
  const retryCount = channelIdx >= 0 ? channelIdx : isSuccess ? 0 : Math.max(0, attempts.length - 1);
  return { channelId, channelName, retryCount };
}

// ============================================================================
// 3. POST /api/ai/images/generations - Forward image generation via AiRouter
// ============================================================================
aiRouter.post("/images/generations", async (req: Request, res: Response) => {
  const startTime = Date.now();
  const { prompt, model, ...rest } = req.body || {};
  const targetModel = (typeof model === "string" && model.trim()) || "dall-e-3";
  const ipAddress = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || req.ip || null;

  if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
    const errorData = {
      success: false,
      error: {
        code: "INVALID_PROMPT",
        message: "Prompt is required and cannot be empty",
      },
      message: "Prompt is required and cannot be empty",
    };

    AiAuditService.record({
      userId: req.user?.id,
      username: req.user?.username,
      requestType: "image_generation",
      model: targetModel,
      status: "failed",
      statusCode: 400,
      durationMs: Date.now() - startTime,
      promptPreview: "",
      requestBody: req.body,
      errorMessage: errorData.message,
      retryCount: 0,
      ipAddress,
    }).catch(() => {});

    res.status(400).json(errorData);
    return;
  }

  const result = await AiRouter.generateImage({
    ...rest,
    prompt: prompt.trim(),
    model: targetModel,
  });

  const durationMs = Date.now() - startTime;
  const isSuccess = result.status >= 200 && result.status < 300;
  const { channelId, channelName, retryCount } = resolveChannelAndRetries(targetModel, result.channelUsed, isSuccess);

  AiAuditService.record({
    userId: req.user?.id,
    username: req.user?.username,
    requestType: "image_generation",
    model: targetModel,
    channelId,
    channelName,
    status: isSuccess ? "success" : "failed",
    statusCode: result.status,
    durationMs,
    promptPreview: prompt.trim().slice(0, 500),
    requestBody: req.body,
    responseSummary: result.data,
    errorMessage: !isSuccess ? (result.data?.error?.message || result.data?.message || JSON.stringify(result.data)) : null,
    retryCount,
    ipAddress,
  }).catch(() => {});

  res.status(result.status).json(result.data);
});

// ============================================================================
// 4. POST /api/ai/images/edits - Forward image editing via AiRouter
// ============================================================================
aiRouter.post("/images/edits", upload.any(), async (req: Request, res: Response) => {
  const startTime = Date.now();
  const prompt = req.body?.prompt;
  const targetModel = (typeof req.body?.model === "string" && req.body.model.trim()) || "gpt-image-2";
  const ipAddress = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || req.ip || null;

  if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
    const errorData = {
      success: false,
      error: {
        code: "INVALID_PROMPT",
        message: "Prompt is required and cannot be empty",
      },
      message: "Prompt is required and cannot be empty",
    };

    AiAuditService.record({
      userId: req.user?.id,
      username: req.user?.username,
      requestType: "image_edit",
      model: targetModel,
      status: "failed",
      statusCode: 400,
      durationMs: Date.now() - startTime,
      promptPreview: "",
      requestBody: req.body,
      errorMessage: errorData.message,
      retryCount: 0,
      ipAddress,
    }).catch(() => {});

    res.status(400).json(errorData);
    return;
  }

  const result = await AiRouter.editImage({
    body: req.body,
    files: (req.files as Express.Multer.File[]) || [],
  });

  const durationMs = Date.now() - startTime;
  const isSuccess = result.status >= 200 && result.status < 300;
  const { channelId, channelName, retryCount } = resolveChannelAndRetries(targetModel, result.channelUsed, isSuccess);

  AiAuditService.record({
    userId: req.user?.id,
    username: req.user?.username,
    requestType: "image_edit",
    model: targetModel,
    channelId,
    channelName,
    status: isSuccess ? "success" : "failed",
    statusCode: result.status,
    durationMs,
    promptPreview: prompt.trim().slice(0, 500),
    requestBody: {
      ...req.body,
      uploadedFiles: ((req.files as Express.Multer.File[]) || []).map((f) => ({
        fieldname: f.fieldname,
        originalname: f.originalname,
        mimetype: f.mimetype,
        size: f.size,
      })),
    },
    responseSummary: result.data,
    errorMessage: !isSuccess ? (result.data?.error?.message || result.data?.message || JSON.stringify(result.data)) : null,
    retryCount,
    ipAddress,
  }).catch(() => {});

  res.status(result.status).json(result.data);
});

// ============================================================================
// 5. POST /api/ai/chat/completions - Forward chat completions via AiRouter
// ============================================================================
aiRouter.post("/chat/completions", async (req: Request, res: Response) => {
  const startTime = Date.now();
  const { messages, model, stream, ...rest } = req.body || {};
  const targetModel = (typeof model === "string" && model.trim()) || "gpt-4o";
  const ipAddress = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || req.ip || null;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    const errorData = {
      success: false,
      error: {
        code: "MISSING_MESSAGES",
        message: "Messages array is required and must not be empty",
      },
      message: "Messages array is required and must not be empty",
    };

    AiAuditService.record({
      userId: req.user?.id,
      username: req.user?.username,
      requestType: "chat_completion",
      model: targetModel,
      status: "failed",
      statusCode: 400,
      durationMs: Date.now() - startTime,
      promptPreview: "",
      requestBody: req.body,
      errorMessage: errorData.message,
      retryCount: 0,
      ipAddress,
    }).catch(() => {});

    res.status(400).json(errorData);
    return;
  }

  const promptPreview = extractChatPromptPreview(messages);

  const result = await AiRouter.chatCompletion({
    ...rest,
    messages,
    model: targetModel,
    stream: Boolean(stream),
    clientRes: res,
  });

  const durationMs = Date.now() - startTime;
  const statusCode = stream ? (result.streamed ? res.statusCode || 200 : result.status || 500) : result.status || 200;
  const isSuccess = statusCode >= 200 && statusCode < 300;
  const { channelId, channelName, retryCount } = resolveChannelAndRetries(targetModel, result.channelUsed, isSuccess);

  AiAuditService.record({
    userId: req.user?.id,
    username: req.user?.username,
    requestType: "chat_completion",
    model: targetModel,
    channelId,
    channelName,
    status: isSuccess ? "success" : "failed",
    statusCode,
    durationMs,
    promptPreview,
    requestBody: req.body,
    responseSummary: stream ? (result.streamed ? { streamed: true, statusCode } : result.data) : result.data,
    errorMessage: !isSuccess ? (result.data?.error?.message || result.data?.message || JSON.stringify(result.data)) : null,
    retryCount,
    ipAddress,
  }).catch(() => {});

  if (!stream && result.status && !res.headersSent) {
    res.status(result.status).json(result.data);
  }
});
