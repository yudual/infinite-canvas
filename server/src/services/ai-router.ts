import type { Response } from "express";
import {
  getActiveAiChannels,
  updateChannelHealth,
  getAiConfig,
  type ChannelRecord,
} from "../db.js";
import { categorizeModels } from "../routes/admin/channels.js";

/**
 * Sanitizes any raw API keys from text
 */
export function sanitizeText(content: string, apiKeys: string[]): string {
  if (!content) return content;
  let result = content;
  for (const key of apiKeys) {
    if (key && key.trim().length >= 4) {
      result = result.replaceAll(key.trim(), "[REDACTED]");
    }
  }
  return result;
}

/**
 * Sanitizes any raw API keys from data objects or strings
 */
export function sanitizeData<T>(data: T, apiKeys: string[]): T {
  if (!data) return data;
  try {
    const jsonStr = typeof data === "string" ? data : JSON.stringify(data);
    let cleaned = jsonStr;
    let modified = false;
    for (const key of apiKeys) {
      if (key && key.trim().length >= 4 && cleaned.includes(key.trim())) {
        cleaned = cleaned.replaceAll(key.trim(), "[REDACTED]");
        modified = true;
      }
    }
    if (modified) {
      return typeof data === "string" ? (cleaned as unknown as T) : JSON.parse(cleaned);
    }
  } catch {}
  return data;
}

/**
 * Collect all known API keys across channels and legacy config to guarantee zero leak
 */
function getAllKnownApiKeys(): string[] {
  const keys: string[] = [];
  try {
    const legacy = getAiConfig();
    if (legacy.apiKey) keys.push(legacy.apiKey);
    const channels = getActiveAiChannels();
    for (const c of channels) {
      if (c.api_key) keys.push(c.api_key);
    }
  } catch {}
  return Array.from(new Set(keys.filter((k) => k && k.trim().length >= 4)));
}

/**
 * Query candidate active channels supporting the requested model,
 * sorted by priority DESC, health_status, and weight DESC.
 */
export function getCandidateChannels(targetModel?: string): ChannelRecord[] {
  const allActive = getActiveAiChannels();
  if (allActive.length === 0) return [];

  const healthWeight: Record<string, number> = { healthy: 3, unknown: 2, degraded: 1, unhealthy: 0 };
  const sortChannels = (list: ChannelRecord[]) => {
    return list.slice().sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      const hwA = healthWeight[a.health_status] ?? 2;
      const hwB = healthWeight[b.health_status] ?? 2;
      if (hwB !== hwA) return hwB - hwA;
      return b.weight - a.weight;
    });
  };

  if (!targetModel) return sortChannels(allActive);

  const modelLower = targetModel.toLowerCase().trim();
  const matched = allActive.filter((c) => {
    try {
      const models = JSON.parse(c.models);
      if (Array.isArray(models)) {
        return models.some((m) => typeof m === "string" && (m.toLowerCase() === modelLower || m === "*"));
      }
    } catch {}
    return false;
  });

  return matched.length > 0 ? sortChannels(matched) : sortChannels(allActive);
}

/**
 * Aggregates all supported models across all active channels
 */
export function getAggregatedModels() {
  const activeChannels = getActiveAiChannels();
  const allImageModels: string[] = [];
  const allChatModels: string[] = [];
  let defaultModel = "";

  for (const channel of activeChannels) {
    if (!defaultModel && channel.default_model) defaultModel = channel.default_model;
    try {
      const models = JSON.parse(channel.models);
      if (Array.isArray(models)) {
        const { imageModels, chatModels, otherModels } = categorizeModels(models);
        allImageModels.push(...imageModels);
        allChatModels.push(...chatModels);
        for (const m of otherModels) allImageModels.push(m);
      }
    } catch {}
  }

  const imageModels = Array.from(new Set(allImageModels));
  const chatModels = Array.from(new Set(allChatModels));
  if (!defaultModel) defaultModel = imageModels[0] || "dall-e-3";

  if (imageModels.length === 0 && chatModels.length === 0) {
    const legacy = getAiConfig();
    return {
      imageModels: legacy.imageModels,
      defaultModel: legacy.defaultModel,
      defaultImageModel: legacy.defaultModel,
      chatModels: legacy.chatModels,
      allModels: Array.from(new Set([...legacy.imageModels, ...legacy.chatModels])),
    };
  }

  return {
    imageModels,
    defaultModel,
    defaultImageModel: defaultModel,
    chatModels,
    allModels: Array.from(new Set([...imageModels, ...chatModels])),
  };
}

/**
 * Intelligent Router for AI proxy requests with multi-channel failover
 */
export class AiRouter {
  private static readonly MAX_FAILOVERS = 2; // Up to 2 failover retries (3 attempts total)

  private static isRetriableStatus(status: number): boolean {
    return status === 429 || (status >= 500 && status <= 504) || status === 401 || status === 403;
  }

  /**
   * Universal failover executor for non-streaming HTTP requests
   */
  private static async executeWithFailover(
    targetModel: string,
    prepareRequest: (channel: ChannelRecord) => {
      url: string;
      fetchOptions: RequestInit;
    }
  ): Promise<{ status: number; data: any; channelUsed?: string }> {
    const candidates = getCandidateChannels(targetModel);
    const allKeys = getAllKnownApiKeys();

    if (candidates.length === 0) {
      return {
        status: 503,
        data: {
          success: false,
          error: { code: "NO_ACTIVE_CHANNEL", message: "No active AI channels configured" },
          message: "No active AI channels configured",
        },
      };
    }

    const attempts = candidates.slice(0, 1 + this.MAX_FAILOVERS);
    let lastError = "All candidate AI channels failed";
    let lastStatus = 502;

    for (let i = 0; i < attempts.length; i++) {
      const channel = attempts[i];
      const startTime = Date.now();

      try {
        const { url, fetchOptions } = prepareRequest(channel);
        const response = await fetch(url, fetchOptions);
        const latencyMs = Date.now() - startTime;
        const rawText = await response.text();
        let parsedData: any = rawText;
        try { parsedData = JSON.parse(rawText); } catch {}
        const sanitized = sanitizeData(parsedData, allKeys);

        if (response.ok) {
          updateChannelHealth(channel.id, { healthStatus: "healthy", latencyMs, lastError: null });
          return { status: response.status, data: sanitized, channelUsed: channel.name };
        }

        lastStatus = 502;
        lastError = `Channel [${channel.name}] HTTP ${response.status}: ${
          typeof sanitized === "object" ? JSON.stringify(sanitized) : String(sanitized).slice(0, 150)
        }`;

        if (this.isRetriableStatus(response.status)) {
          updateChannelHealth(channel.id, {
            healthStatus: "degraded",
            latencyMs,
            lastError,
          });
          if (i < attempts.length - 1) {
            continue;
          }
          break;
        }

        updateChannelHealth(channel.id, { healthStatus: "healthy", latencyMs, lastError: null });
        return { status: response.status, data: sanitized };
      } catch (err: any) {
        const latencyMs = Date.now() - startTime;
        const isTimeout = err.name === "TimeoutError" || err.name === "AbortError";
        lastError = `Channel [${channel.name}] failed: ${isTimeout ? "Timeout" : err.message || "Network error"}`;
        lastStatus = 502;

        updateChannelHealth(channel.id, {
          healthStatus: isTimeout ? "degraded" : "unhealthy",
          latencyMs,
          lastError,
        });

        if (i < attempts.length - 1) continue;
      }
    }

    return {
      status: lastStatus,
      data: {
        success: false,
        error: { code: "BAD_GATEWAY", message: sanitizeText(lastError, allKeys) },
        message: sanitizeText(lastError, allKeys),
      },
    };
  }

  /**
   * Route Image Generation requests (/images/generations)
   */
  static async generateImage(payload: {
    prompt: string;
    model?: string;
    [key: string]: any;
  }): Promise<{ status: number; data: any; channelUsed?: string }> {
    return this.executeWithFailover(payload.model || "dall-e-3", (channel) => {
      let customHeaders: Record<string, string> = {};
      try {
        const parsed = JSON.parse(channel.custom_headers);
        if (parsed && typeof parsed === "object") customHeaders = parsed;
      } catch {}

      return {
        url: `${channel.base_url.replace(/\/+$/, "")}/images/generations`,
        fetchOptions: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${channel.api_key}`,
            ...customHeaders,
          },
          body: JSON.stringify({
            ...payload,
            model: payload.model || channel.default_model || "dall-e-3",
          }),
          signal: AbortSignal.timeout(channel.timeout_ms || 300000),
        },
      };
    });
  }

  /**
   * Route Image Edit requests (/images/edits)
   */
  static async editImage(options: {
    body: any;
    files?: Express.Multer.File[];
  }): Promise<{ status: number; data: any; channelUsed?: string }> {
    const { body, files = [] } = options;
    return this.executeWithFailover(body?.model || "gpt-image-2", (channel) => {
      let customHeaders: Record<string, string> = {};
      try {
        const parsed = JSON.parse(channel.custom_headers);
        if (parsed && typeof parsed === "object") customHeaders = parsed;
      } catch {}

      const upstreamUrl = `${channel.base_url.replace(/\/+$/, "")}/images/edits`;

      if (files.length > 0 || body?.image) {
        const formData = new FormData();
        for (const [key, value] of Object.entries(body)) {
          if (typeof value === "string" && key !== "image" && key !== "mask") {
            formData.append(key, value);
          }
        }
        if (!body.model) formData.append("model", channel.default_model || "gpt-image-2");
        for (const file of files) {
          const blob = new Blob([file.buffer], { type: file.mimetype || "image/png" });
          formData.append(file.fieldname, blob, file.originalname || "image.png");
        }

        if (files.length === 0 && body?.image) {
          const rawImage = String(body.image);
          const match = rawImage.match(/^data:([^;,]+);base64,(.+)$/);
          const mimeType = match ? match[1] : "image/png";
          const base64Data = match ? match[2] : rawImage.replace(/^data:image\/\w+;base64,/, "");
          const buffer = Buffer.from(base64Data, "base64");
          formData.append("image", new Blob([buffer], { type: mimeType }), "image.png");

          if (body.mask) {
            const rawMask = String(body.mask);
            const maskMatch = rawMask.match(/^data:([^;,]+);base64,(.+)$/);
            const maskMime = maskMatch ? maskMatch[1] : "image/png";
            const maskBase64 = maskMatch ? maskMatch[2] : rawMask.replace(/^data:image\/\w+;base64,/, "");
            formData.append("mask", new Blob([Buffer.from(maskBase64, "base64")], { type: maskMime }), "mask.png");
          }
        }

        return {
          url: upstreamUrl,
          fetchOptions: {
            method: "POST",
            headers: { Authorization: `Bearer ${channel.api_key}`, ...customHeaders },
            body: formData,
            signal: AbortSignal.timeout(channel.timeout_ms || 300000),
          },
        };
      }

      return {
        url: upstreamUrl,
        fetchOptions: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${channel.api_key}`,
            ...customHeaders,
          },
          body: JSON.stringify({ ...body, model: body?.model || channel.default_model || "gpt-image-2" }),
          signal: AbortSignal.timeout(channel.timeout_ms || 300000),
        },
      };
    });
  }

  /**
   * Route Chat Completions requests (/chat/completions)
   */
  static async chatCompletion(options: {
    messages: any[];
    model?: string;
    stream?: boolean;
    clientRes?: Response;
    [key: string]: any;
  }): Promise<{ status?: number; data?: any; streamed?: boolean; channelUsed?: string }> {
    const { messages, model, stream = false, clientRes, ...rest } = options;
    const targetModel = model || "gpt-4o";

    if (!stream) {
      return this.executeWithFailover(targetModel, (channel) => {
        let customHeaders: Record<string, string> = {};
        try {
          const parsed = JSON.parse(channel.custom_headers);
          if (parsed && typeof parsed === "object") customHeaders = parsed;
        } catch {}

        return {
          url: `${channel.base_url.replace(/\/+$/, "")}/chat/completions`,
          fetchOptions: {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              Authorization: `Bearer ${channel.api_key}`,
              ...customHeaders,
            },
            body: JSON.stringify({
              ...rest,
              messages,
              model: model || channel.default_model || "gpt-4o",
              stream: false,
            }),
            signal: AbortSignal.timeout(channel.timeout_ms || 180000),
          },
        };
      });
    }

    // Streaming chat completions with failover before first chunk
    const candidates = getCandidateChannels(targetModel);
    const allKeys = getAllKnownApiKeys();

    if (candidates.length === 0) {
      const err = { success: false, error: { code: "NO_ACTIVE_CHANNEL", message: "No active AI channels configured" }, message: "No active AI channels configured" };
      if (clientRes && !clientRes.headersSent) clientRes.status(503).json(err);
      return { status: 503, data: err };
    }

    const attempts = candidates.slice(0, 1 + this.MAX_FAILOVERS);
    let lastError = "All candidate AI channels failed";
    let lastStatus = 502;

    for (let i = 0; i < attempts.length; i++) {
      if (clientRes && (clientRes.destroyed || clientRes.writableEnded)) {
        break;
      }

      const channel = attempts[i];
      const startTime = Date.now();
      const abortController = new AbortController();
      const clientCloseHandler = () => {
        if (clientRes && !clientRes.writableEnded) {
          abortController.abort();
        }
      };
      clientRes?.on("close", clientCloseHandler);

      try {
        let customHeaders: Record<string, string> = {};
        try {
          const parsed = JSON.parse(channel.custom_headers);
          if (parsed && typeof parsed === "object") customHeaders = parsed;
        } catch {}

        const channelTimeoutMs = channel.timeout_ms || 180000;
        const fetchSignal = typeof AbortSignal.any === "function"
          ? AbortSignal.any([abortController.signal, AbortSignal.timeout(channelTimeoutMs)])
          : abortController.signal;

        const response = await fetch(`${channel.base_url.replace(/\/+$/, "")}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            Authorization: `Bearer ${channel.api_key}`,
            ...customHeaders,
          },
          body: JSON.stringify({ ...rest, messages, model: model || channel.default_model || "gpt-4o", stream: true }),
          signal: fetchSignal,
        });

        const latencyMs = Date.now() - startTime;

        if (!response.ok) {
          const rawText = await response.text().catch(() => "");
          let parsedData: any = rawText;
          try { parsedData = JSON.parse(rawText); } catch {}
          const sanitized = sanitizeData(parsedData, allKeys);

          lastStatus = 502;
          lastError = `Channel [${channel.name}] HTTP ${response.status}: ${
            typeof sanitized === "object" ? JSON.stringify(sanitized) : String(sanitized).slice(0, 150)
          }`;

          if (this.isRetriableStatus(response.status)) {
            updateChannelHealth(channel.id, {
              healthStatus: "degraded",
              latencyMs,
              lastError: `Channel [${channel.name}] HTTP ${response.status}`,
            });
            if (i < attempts.length - 1) {
              continue;
            }
            break;
          }

          updateChannelHealth(channel.id, { healthStatus: "healthy", latencyMs, lastError: null });
          if (clientRes && !clientRes.headersSent) clientRes.status(response.status).json(sanitized);
          return { status: response.status, data: sanitized };
        }

        updateChannelHealth(channel.id, { healthStatus: "healthy", latencyMs, lastError: null });

        if (clientRes) {
          clientRes.setHeader("Content-Type", "text/event-stream; charset=utf-8");
          clientRes.setHeader("Cache-Control", "no-cache, no-transform");
          clientRes.setHeader("Connection", "keep-alive");
          clientRes.flushHeaders?.();

          if (response.body) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                clientRes.write(sanitizeText(decoder.decode(value, { stream: true }), allKeys));
              }
            } catch (readErr: any) {
              if (readErr.name !== "AbortError") console.error("Error piping upstream SSE:", readErr);
            } finally {
              clientRes.end();
            }
          } else {
            clientRes.end();
          }
        }

        return { streamed: true, channelUsed: channel.name };
      } catch (err: any) {
        const latencyMs = Date.now() - startTime;
        const isTimeout = err.name === "TimeoutError" || err.name === "AbortError";
        lastError = `Channel [${channel.name}] failed: ${isTimeout ? "Timeout" : err.message || "Network error"}`;
        lastStatus = 502;

        updateChannelHealth(channel.id, { healthStatus: isTimeout ? "degraded" : "unhealthy", latencyMs, lastError });
        if (i < attempts.length - 1) continue;
      } finally {
        clientRes?.off("close", clientCloseHandler);
      }
    }

    const finalError = {
      success: false,
      error: { code: "BAD_GATEWAY", message: sanitizeText(lastError, allKeys) },
      message: sanitizeText(lastError, allKeys),
    };
    if (clientRes && !clientRes.headersSent) clientRes.status(lastStatus).json(finalError);
    return { status: lastStatus, data: finalError };
  }
}
