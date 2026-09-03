import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import {
  toChannelDto,
  listAiChannels,
  getAiChannelById,
  createAiChannel,
  updateAiChannel,
  deleteAiChannel,
  updateChannelHealth,
  type ChannelRecord,
} from "../../db.js";

export const channelsAdminRouter = Router();

/**
 * Categorize raw model IDs into image, chat, and other categories
 */
export function categorizeModels(modelIds: string[]) {
  const imageKeywords = [
    "dall-e", "flux", "stable-diffusion", "sd-", "sdxl", "sd3",
    "midjourney", "mj-", "recraft", "ideogram", "image", "kolors",
    "cogview", "imagen", "playground", "photomaker", "schnell", "dev", "pro"
  ];
  const chatKeywords = [
    "gpt", "claude", "deepseek", "gemini", "qwen", "glm", "llama",
    "chat", "mistral", "yi-", "kimi", "moonshot", "baichuan", "gemma", "command-r"
  ];

  const imageModels: string[] = [];
  const chatModels: string[] = [];
  const otherModels: string[] = [];

  for (const id of modelIds) {
    const lower = id.toLowerCase();
    const isImage = imageKeywords.some((k) => lower.includes(k));
    const isChat = chatKeywords.some((k) => lower.includes(k));

    if (isImage) {
      imageModels.push(id);
    } else if (isChat) {
      chatModels.push(id);
    } else {
      otherModels.push(id);
    }
  }

  return { imageModels, chatModels, otherModels, allModels: modelIds };
}

/**
 * Probe upstream models endpoint with timeout and error handling
 */
export async function probeUpstream(
  baseUrl: string,
  apiKey: string,
  customHeaders: Record<string, string> = {},
  timeoutMs = 8000
): Promise<{ success: boolean; latencyMs: number; statusCode: number; modelIds: string[]; message: string }> {
  const cleanBase = baseUrl.trim().replace(/\/+$/, "");
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
        ...customHeaders,
      };
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

      const response = await fetch(probeUrl, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });

      const latencyMs = Date.now() - startTime;
      lastStatus = response.status;

      if (response.ok) {
        const data = (await response.json()) as any;
        let rawItems: any[] = [];
        if (Array.isArray(data)) rawItems = data;
        else if (Array.isArray(data?.data)) rawItems = data.data;
        else if (Array.isArray(data?.models)) rawItems = data.models;

        const modelIds = Array.from(
          new Set(
            rawItems
              .map((m: any) => {
                if (typeof m === "string") return m;
                const raw = m?.id || m?.name || m?.model_id || m?.model;
                return typeof raw === "string" ? raw.replace(/^models\//, "") : "";
              })
              .filter((mid) => typeof mid === "string" && mid.trim().length > 0)
          )
        ).sort();

        return {
          success: true,
          latencyMs,
          statusCode: response.status,
          modelIds,
          message: `成功连接上游 API (HTTP ${response.status})，延迟 ${latencyMs}ms`,
        };
      }

      if (response.status === 401 || response.status === 403) {
        lastError = `上游鉴权失败 (HTTP ${response.status})：API Key 无效或未启用`;
        break;
      }

      const text = await response.text().catch(() => "");
      lastError = `上游返回 HTTP ${response.status}: ${text.slice(0, 150) || response.statusText}`;
    } catch (err: any) {
      const isTimeout = err.name === "TimeoutError" || err.name === "AbortError";
      lastError = isTimeout ? `连接上游超时 (${timeoutMs}ms)` : (err.message || "请求失败");
    }
  }

  const latencyMs = Date.now() - startTime;
  return {
    success: false,
    latencyMs,
    statusCode: lastStatus,
    modelIds: [],
    message: lastError || "无法连接至渠道上游服务",
  };
}

// 1. GET /api/admin/channels - List channels with search & status filter
channelsAdminRouter.get("/", (req: Request, res: Response) => {
  const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || "50", 10)));
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const status = typeof req.query.status === "string" ? req.query.status.trim() : "";

  const { channels, total } = listAiChannels({ search, status, page, limit });
  res.json({ success: true, channels: channels.map(toChannelDto), total, page, limit });
});

// 2. GET /api/admin/channels/:id - Get single channel
channelsAdminRouter.get("/:id", (req: Request, res: Response) => {
  const id = req.params.id as string;
  const channel = getAiChannelById(id);
  if (!channel) {
    res.status(404).json({ success: false, error: { code: "CHANNEL_NOT_FOUND", message: "Channel not found" }, message: "Channel not found" });
    return;
  }
  res.json({ success: true, channel: toChannelDto(channel) });
});

// 3. POST /api/admin/channels - Create new channel
channelsAdminRouter.post("/", (req: Request, res: Response) => {
  const {
    name, providerType = "openai", baseUrl, apiKey, models, defaultModel,
    priority = 0, weight = 1, isActive = true, timeoutMs = 300000, customHeaders,
  } = req.body || {};

  const cleanName = typeof name === "string" ? name.trim() : "";
  if (!cleanName) {
    res.status(400).json({ success: false, error: { code: "INVALID_NAME", message: "Channel name is required" }, message: "Channel name is required" });
    return;
  }

  const cleanBaseUrl = typeof baseUrl === "string" ? baseUrl.trim().replace(/\/+$/, "") : "";
  try {
    const parsed = new URL(cleanBaseUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Invalid protocol");
  } catch {
    res.status(400).json({ success: false, error: { code: "INVALID_BASE_URL", message: "Base URL must start with http:// or https://" }, message: "Base URL must start with http:// or https://" });
    return;
  }

  const cleanApiKey = typeof apiKey === "string" ? apiKey.trim() : "";
  if (!cleanApiKey) {
    res.status(400).json({ success: false, error: { code: "MISSING_API_KEY", message: "API key is required" }, message: "API key is required" });
    return;
  }

  const modelList = Array.isArray(models) ? models.filter((m) => typeof m === "string" && m.trim().length > 0) : [];
  const headersObj = customHeaders && typeof customHeaders === "object" && !Array.isArray(customHeaders) ? customHeaders : {};

  const created = createAiChannel({
    id: crypto.randomUUID(),
    name: cleanName,
    provider_type: typeof providerType === "string" && providerType.trim() ? providerType.trim() : "openai",
    base_url: cleanBaseUrl,
    api_key: cleanApiKey,
    models: JSON.stringify(modelList),
    default_model: typeof defaultModel === "string" && defaultModel.trim() ? defaultModel.trim() : null,
    priority: typeof priority === "number" ? priority : parseInt(priority, 10) || 0,
    weight: typeof weight === "number" ? Math.max(1, weight) : Math.max(1, parseInt(weight, 10) || 1),
    is_active: isActive === false || isActive === 0 ? 0 : 1,
    timeout_ms: typeof timeoutMs === "number" && timeoutMs > 0 ? timeoutMs : 300000,
    custom_headers: JSON.stringify(headersObj),
    health_status: "unknown",
    last_latency_ms: null,
    last_checked_at: null,
    last_error: null,
  });

  res.status(201).json({ success: true, channel: toChannelDto(created) });
});

// 4. PUT /api/admin/channels/:id - Update channel
channelsAdminRouter.put("/:id", (req: Request, res: Response) => {
  const id = req.params.id as string;
  const existing = getAiChannelById(id);
  if (!existing) {
    res.status(404).json({ success: false, error: { code: "CHANNEL_NOT_FOUND", message: "Channel not found" }, message: "Channel not found" });
    return;
  }

  const { name, providerType, baseUrl, apiKey, models, defaultModel, priority, weight, isActive, timeoutMs, customHeaders } = req.body || {};
  const updates: Partial<ChannelRecord> = {};

  if (typeof name === "string" && name.trim()) updates.name = name.trim();
  if (typeof providerType === "string" && providerType.trim()) updates.provider_type = providerType.trim();
  if (typeof baseUrl === "string" && baseUrl.trim()) {
    const cleanBase = baseUrl.trim().replace(/\/+$/, "");
    try {
      const parsed = new URL(cleanBase);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Invalid protocol");
      updates.base_url = cleanBase;
    } catch {
      res.status(400).json({ success: false, error: { code: "INVALID_BASE_URL", message: "Base URL must start with http:// or https://" }, message: "Base URL must start with http:// or https://" });
      return;
    }
  }

  // Retain existing key if omitted or masked '****'
  if (typeof apiKey === "string" && apiKey.trim() && !apiKey.includes("****")) updates.api_key = apiKey.trim();
  if (Array.isArray(models)) updates.models = JSON.stringify(models.filter((m) => typeof m === "string" && m.trim().length > 0));
  if (defaultModel !== undefined) updates.default_model = typeof defaultModel === "string" && defaultModel.trim() ? defaultModel.trim() : null;
  if (priority !== undefined) updates.priority = typeof priority === "number" ? priority : parseInt(priority, 10) || 0;
  if (weight !== undefined) updates.weight = Math.max(1, typeof weight === "number" ? weight : parseInt(weight, 10) || 1);
  if (isActive !== undefined) updates.is_active = isActive === false || isActive === 0 ? 0 : 1;
  if (typeof timeoutMs === "number" && timeoutMs > 0) updates.timeout_ms = timeoutMs;
  if (customHeaders && typeof customHeaders === "object" && !Array.isArray(customHeaders)) updates.custom_headers = JSON.stringify(customHeaders);

  const updated = updateAiChannel(id, updates);
  res.json({ success: true, channel: toChannelDto(updated!) });
});

// 5. PATCH /api/admin/channels/:id/status - Toggle active status
channelsAdminRouter.patch("/:id/status", (req: Request, res: Response) => {
  const id = req.params.id as string;
  const existing = getAiChannelById(id);
  if (!existing) {
    res.status(404).json({ success: false, error: { code: "CHANNEL_NOT_FOUND", message: "Channel not found" }, message: "Channel not found" });
    return;
  }

  const { isActive, is_active, enabled } = req.body || {};
  const activeVal = isActive !== undefined ? Boolean(isActive) : (is_active !== undefined ? Boolean(is_active) : Boolean(enabled));
  const updated = updateAiChannel(id, { is_active: activeVal ? 1 : 0 });

  res.json({ success: true, channel: toChannelDto(updated!), isActive: Boolean(updated!.is_active) });
});

// 6. DELETE /api/admin/channels/:id - Delete channel
channelsAdminRouter.delete("/:id", (req: Request, res: Response) => {
  const id = req.params.id as string;
  const existing = getAiChannelById(id);
  if (!existing) {
    res.status(404).json({ success: false, error: { code: "CHANNEL_NOT_FOUND", message: "Channel not found" }, message: "Channel not found" });
    return;
  }
  deleteAiChannel(id);
  res.json({ success: true, message: "Channel deleted" });
});

// 7. POST /api/admin/channels/:id/test - Probe channel connectivity
channelsAdminRouter.post("/:id/test", async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const channel = getAiChannelById(id);
  if (!channel) {
    res.status(404).json({ success: false, error: { code: "CHANNEL_NOT_FOUND", message: "Channel not found" }, message: "Channel not found" });
    return;
  }

  let customHeaders: Record<string, string> = {};
  try {
    const parsed = JSON.parse(channel.custom_headers);
    if (parsed && typeof parsed === "object") customHeaders = parsed;
  } catch {}

  const probe = await probeUpstream(channel.base_url, channel.api_key, customHeaders, 8000);
  const isAuthError = probe.statusCode === 401 || probe.statusCode === 403;
  const healthStatus = probe.success ? "healthy" : (isAuthError ? "unhealthy" : "degraded");

  updateChannelHealth(id, {
    healthStatus,
    latencyMs: probe.latencyMs,
    lastError: probe.success ? null : probe.message,
  });

  res.json({
    success: probe.success,
    latencyMs: probe.latencyMs,
    healthStatus,
    statusCode: probe.statusCode,
    message: probe.message,
  });
});

// 8. POST /api/admin/channels/:id/sync-models - Pull models from upstream
channelsAdminRouter.post("/:id/sync-models", async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const channel = getAiChannelById(id);
  if (!channel) {
    res.status(404).json({ success: false, error: { code: "CHANNEL_NOT_FOUND", message: "Channel not found" }, message: "Channel not found" });
    return;
  }

  let customHeaders: Record<string, string> = {};
  try {
    const parsed = JSON.parse(channel.custom_headers);
    if (parsed && typeof parsed === "object") customHeaders = parsed;
  } catch {}

  const probe = await probeUpstream(channel.base_url, channel.api_key, customHeaders, 8000);
  if (!probe.success || probe.modelIds.length === 0) {
    updateChannelHealth(id, { healthStatus: "degraded", latencyMs: probe.latencyMs, lastError: probe.message });
    res.status(502).json({ success: false, latencyMs: probe.latencyMs, message: probe.message || "未能从渠道上游获取到模型列表" });
    return;
  }

  const categorized = categorizeModels(probe.modelIds);
  updateAiChannel(id, { models: JSON.stringify(probe.modelIds) });
  updateChannelHealth(id, { healthStatus: "healthy", latencyMs: probe.latencyMs, lastError: null });

  res.json({
    success: true,
    latencyMs: probe.latencyMs,
    total: probe.modelIds.length,
    ...categorized,
  });
});
