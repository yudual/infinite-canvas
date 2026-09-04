import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { db, toSafeUser, getAiConfig, maskApiKey, updateAiConfig, getSystemNotice, updateSystemNotice, resetSystemNotice, type UserRecord, type NoticeItem } from "../db.js";
import { authenticateToken, requireAdmin } from "../middleware/auth.js";
import { channelsAdminRouter } from "./admin/channels.js";
import { assetsAdminRouter } from "./admin/assets.js";
import { projectsAdminRouter } from "./admin/projects.js";
import { auditLogsAdminRouter } from "./admin/audit-logs.js";

export const adminRouter = Router();

// Protect all admin routes with JWT and Admin guard
adminRouter.use(authenticateToken);
adminRouter.use(requireAdmin);

// Mount admin sub-routers
adminRouter.use("/channels", channelsAdminRouter);
adminRouter.use("/assets", assetsAdminRouter);
adminRouter.use("/projects", projectsAdminRouter);
adminRouter.use("/audit-logs", auditLogsAdminRouter);

// ==========================================
// 1. User Management Endpoints
// ==========================================

// GET /api/admin/users
adminRouter.get("/users", (req: Request, res: Response) => {
  const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || "50", 10)));
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const sortByParam = typeof req.query.sortBy === "string" ? req.query.sortBy.trim() : "created_at";
  const sortOrderParam = typeof req.query.sortOrder === "string" && req.query.sortOrder.toUpperCase() === "ASC" ? "ASC" : "DESC";
  const offset = (page - 1) * limit;

  // Allowed columns whitelist for sorting
  const sortColumnMap: Record<string, string> = {
    created_at: "created_at",
    createdAt: "created_at",
    updated_at: "updated_at",
    updatedAt: "updated_at",
    username: "username",
    display_name: "display_name",
    displayName: "display_name",
    role: "role",
    status: "status",
  };
  const sortColumn = sortColumnMap[sortByParam] || "created_at";

  let countQuery = "SELECT COUNT(*) as total FROM users";
  let listQuery = "SELECT * FROM users";
  const params: any[] = [];

  if (search) {
    countQuery += " WHERE username LIKE ? OR display_name LIKE ?";
    listQuery += " WHERE username LIKE ? OR display_name LIKE ?";
    params.push(`%${search}%`, `%${search}%`);
  }

  listQuery += ` ORDER BY ${sortColumn} ${sortOrderParam} LIMIT ? OFFSET ?`;

  const totalRow = db.prepare(countQuery).get(...params) as { total: number };
  const users = db.prepare(listQuery).all(...params, limit, offset) as UserRecord[];

  res.json({
    users: users.map(toSafeUser),
    total: totalRow.total,
    page,
    limit,
  });
});

// POST /api/admin/users
adminRouter.post("/users", (req: Request, res: Response) => {
  const { username, password, role = "user", displayName } = req.body || {};

  const cleanUsername = typeof username === "string" ? username.trim() : "";
  const cleanPassword = typeof password === "string" ? password : "";
  const cleanDisplayName = typeof displayName === "string" && displayName.trim() ? displayName.trim() : cleanUsername;
  const cleanRole = role === "admin" ? "admin" : "user";

  if (!cleanUsername || cleanUsername.length < 2 || cleanUsername.length > 32) {
    res.status(400).json({
      success: false,
      error: { code: "INVALID_USERNAME", message: "Username must be between 2 and 32 characters" },
      message: "Username must be between 2 and 32 characters",
    });
    return;
  }

  if (!cleanPassword || cleanPassword.length < 6) {
    res.status(400).json({
      success: false,
      error: { code: "INVALID_PASSWORD", message: "Password must be at least 6 characters long" },
      message: "Password must be at least 6 characters long",
    });
    return;
  }

  const existing = db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").get(cleanUsername);
  if (existing) {
    res.status(400).json({
      success: false,
      error: { code: "USERNAME_EXISTS", message: "Username already exists" },
      message: "Username already exists",
    });
    return;
  }

  const id = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync(cleanPassword, 10);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO users (id, username, password_hash, display_name, role, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(id, cleanUsername, passwordHash, cleanDisplayName, cleanRole, now, now);

  const newUser = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRecord;
  res.status(201).json({
    success: true,
    user: toSafeUser(newUser),
  });
});

// PATCH /api/admin/users/:id/status
adminRouter.patch("/users/:id/status", (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body || {};

  if (status !== "active" && status !== "disabled") {
    res.status(400).json({
      success: false,
      error: { code: "INVALID_STATUS", message: "Status must be 'active' or 'disabled'" },
      message: "Status must be 'active' or 'disabled'",
    });
    return;
  }

  // Reject self-disable
  if (req.user?.id === id) {
    res.status(400).json({
      success: false,
      error: { code: "CANNOT_DISABLE_SELF", message: "Cannot disable your own admin account" },
      message: "Cannot disable your own admin account",
    });
    return;
  }

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRecord | undefined;
  if (!user) {
    res.status(404).json({
      success: false,
      error: { code: "USER_NOT_FOUND", message: "User not found" },
      message: "User not found",
    });
    return;
  }

  const now = new Date().toISOString();
  db.prepare("UPDATE users SET status = ?, updated_at = ? WHERE id = ?").run(status, now, id);

  const updatedUser = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRecord;
  res.json({
    success: true,
    user: toSafeUser(updatedUser),
  });
});

// POST /api/admin/users/:id/reset-password
adminRouter.post("/users/:id/reset-password", (req: Request, res: Response) => {
  const { id } = req.params;
  const { newPassword } = req.body || {};

  if (!newPassword || typeof newPassword !== "string" || newPassword.length < 6) {
    res.status(400).json({
      success: false,
      error: { code: "INVALID_PASSWORD", message: "Password must be at least 6 characters long" },
      message: "Password must be at least 6 characters long",
    });
    return;
  }

  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(id);
  if (!user) {
    res.status(404).json({
      success: false,
      error: { code: "USER_NOT_FOUND", message: "User not found" },
      message: "User not found",
    });
    return;
  }

  const passwordHash = bcrypt.hashSync(newPassword, 10);
  const now = new Date().toISOString();
  db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(passwordHash, now, id);

  res.json({ success: true, message: "Password reset successfully" });
});

// DELETE /api/admin/users/:id
adminRouter.delete("/users/:id", (req: Request, res: Response) => {
  const { id } = req.params;

  // Reject self-delete
  if (req.user?.id === id) {
    res.status(400).json({
      success: false,
      error: { code: "CANNOT_DELETE_SELF", message: "Cannot delete your own admin account" },
      message: "Cannot delete your own admin account",
    });
    return;
  }

  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(id);
  if (!user) {
    res.status(404).json({
      success: false,
      error: { code: "USER_NOT_FOUND", message: "User not found" },
      message: "User not found",
    });
    return;
  }

  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  res.json({ success: true, message: "User deleted successfully" });
});

// ==========================================
// 2. AI Configuration Endpoints
// ==========================================

// GET /api/admin/ai-config
adminRouter.get("/ai-config", (_req: Request, res: Response) => {
  const config = getAiConfig();
  const hasKey = config.apiKey.trim().length > 0;
  const apiKeyMasked = maskApiKey(config.apiKey);

  res.json({
    baseUrl: config.baseUrl,
    apiKeyMasked,
    hasKey,
    hasApiKey: hasKey,
    imageModels: config.imageModels,
    defaultModel: config.defaultModel,
    chatModels: config.chatModels,
    timeoutMs: config.timeoutMs || 300000,
    customHeaders: config.customHeaders || {},
  });
});

// PUT /api/admin/ai-config
adminRouter.put("/ai-config", (req: Request, res: Response) => {
  const { baseUrl, apiKey, imageModels, defaultModel, chatModels, timeoutMs, customHeaders } = req.body || {};

  updateAiConfig({
    baseUrl,
    apiKey,
    imageModels,
    defaultModel,
    chatModels,
    timeoutMs,
    customHeaders,
  });

  res.json({ success: true, message: "AI configuration updated successfully" });
});

// Helper function to categorize model IDs
export function categorizeModels(modelIds: string[]) {
  const imageKeywords = ["dall-e", "flux", "stable-diffusion", "sd-", "sdxl", "sd3", "midjourney", "mj-", "recraft", "ideogram", "image", "kolors", "cogview", "imagen", "playground", "photomaker", "schnell", "dev", "pro"];
  const chatKeywords = ["gpt", "claude", "deepseek", "gemini", "qwen", "glm", "llama", "chat", "mistral", "yi-", "kimi", "moonshot", "baichuan", "gemma", "command-r"];

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

// POST /api/admin/ai-config/fetch-models
adminRouter.post("/ai-config/fetch-models", async (req: Request, res: Response) => {
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
  
  // Build candidate probe URLs
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
        "Accept": "application/json",
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

        // Sort uniquely
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
        lastError = `上游接口鉴权失败 (HTTP ${response.status})：API Key 无效或未提供。许多服务商要求提供有效 API Key 才能查询模型列表。`;
        break; // Auth failure, no need to probe other URLs
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

// POST /api/admin/ai-config/test
adminRouter.post("/ai-config/test", async (req: Request, res: Response) => {
  const currentConfig = getAiConfig();
  const rawBaseUrl = (typeof req.body?.baseUrl === "string" && req.body.baseUrl.trim()) || currentConfig.baseUrl;
  const rawApiKey = (typeof req.body?.apiKey === "string" && req.body.apiKey.trim() && !req.body.apiKey.includes("****"))
    ? req.body.apiKey.trim()
    : currentConfig.apiKey;

  // Validate URL format
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawBaseUrl);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error("Invalid protocol");
    }
  } catch {
    res.json({
      success: false,
      latencyMs: 0,
      message: "Invalid Base URL format. Must start with http:// or https://",
    });
    return;
  }

  const cleanBase = rawBaseUrl.replace(/\/+$/, "");
  const probeUrl = cleanBase.endsWith("/models") ? cleanBase : `${cleanBase}/models`;

  const startTime = Date.now();
  try {
    const headers: Record<string, string> = {
      "Accept": "application/json",
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
      let modelCount = 0;
      try {
        const data = await response.json() as any;
        if (Array.isArray(data?.data)) modelCount = data.data.length;
        else if (Array.isArray(data)) modelCount = data.length;
      } catch {}

      res.json({
        success: true,
        latencyMs,
        status: response.status,
        modelCount,
        message: `成功连接上游 API 接口 (HTTP ${response.status})${modelCount > 0 ? `，检测到 ${modelCount} 个可用模型` : ""}`,
      });
      return;
    }

    if (response.status === 401 || response.status === 403) {
      res.json({
        success: false,
        latencyMs,
        status: response.status,
        message: `上游鉴权失败 (HTTP ${response.status})。请核对 API Key 是否正确或已启用。`,
      });
      return;
    }

    res.json({
      success: false,
      latencyMs,
      status: response.status,
      message: `上游接口返回异常状态 (HTTP ${response.status}: ${response.statusText})`,
    });
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    const isTimeout = err.name === "TimeoutError" || err.name === "AbortError";
    res.json({
      success: false,
      latencyMs,
      message: isTimeout ? "连接上游超时 (8000ms)，请检查网络连通性或代理配置" : (err.message || "无法连接至上游 API"),
    });
  }
});

// ==========================================
// 3. System Overview Stats Endpoint
// ==========================================

// GET /api/admin/stats
adminRouter.get("/stats", (_req: Request, res: Response) => {
  const userRow = db.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number } | undefined;
  const activeUserRow = db.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'active'").get() as { count: number } | undefined;
  const projectRow = db.prepare("SELECT COUNT(*) as count FROM projects").get() as { count: number } | undefined;
  const assetRow = db.prepare("SELECT COUNT(*) as count, COALESCE(SUM(size_bytes), 0) as totalBytes FROM assets").get() as { count: number; totalBytes: number } | undefined;

  res.json({
    userCount: userRow?.count ?? 0,
    activeUserCount: activeUserRow?.count ?? 0,
    projectCount: projectRow?.count ?? 0,
    assetCount: assetRow?.count ?? 0,
    storageBytes: assetRow?.totalBytes ?? 0,
  });
});

// ==========================================
// 4. System Announcement Endpoints
// ==========================================

// GET /api/admin/notice
adminRouter.get("/notice", (_req: Request, res: Response) => {
  const notice = getSystemNotice();
  res.json({ success: true, notice });
});

// PUT /api/admin/notice
adminRouter.put("/notice", (req: Request, res: Response) => {
  const { enabled, title, tag, tagColor, content, items, footerNote } = req.body || {};

  if (title !== undefined && (typeof title !== "string" || !title.trim())) {
    res.status(400).json({
      success: false,
      error: { code: "INVALID_TITLE", message: "公告标题不能为空" },
      message: "公告标题不能为空",
    });
    return;
  }

  let sanitizedItems: NoticeItem[] | undefined;
  if (Array.isArray(items)) {
    sanitizedItems = items
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        title: typeof item.title === "string" ? item.title.trim() : "",
        description: typeof item.description === "string" ? item.description.trim() : "",
        type: ["info", "warning", "tip", "error"].includes(item.type) ? item.type : "info",
      }));
  }

  const updated = updateSystemNotice({
    enabled: typeof enabled === "boolean" ? enabled : undefined,
    title: typeof title === "string" ? title.trim() : undefined,
    tag: typeof tag === "string" ? tag.trim() : undefined,
    tagColor: typeof tagColor === "string" ? tagColor.trim() : undefined,
    content: typeof content === "string" ? content.trim() : undefined,
    items: sanitizedItems,
    footerNote: typeof footerNote === "string" ? footerNote.trim() : undefined,
  });

  res.json({
    success: true,
    notice: updated,
    message: "系统公告配置已保存",
  });
});

// POST /api/admin/notice/reset
adminRouter.post("/notice/reset", (_req: Request, res: Response) => {
  const notice = resetSystemNotice();
  res.json({
    success: true,
    notice,
    message: "系统公告已重置为初始默认配置",
  });
});


