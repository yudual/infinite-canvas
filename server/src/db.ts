import crypto from "node:crypto";
import { createRequire } from "node:module";
import { DB_PATH } from "./config.js";

const require = createRequire(import.meta.url);

function createDatabaseInstance() {
  if (typeof (process.versions as any)?.bun === "string") {
    const { Database } = require("bun:sqlite");
    class BunDatabaseWrapper {
      private rawDb: any;
      constructor(filePath: string) {
        this.rawDb = new Database(filePath, { create: true });
      }
      pragma(pragmaStr: string) {
        try {
          this.rawDb.exec(`PRAGMA ${pragmaStr}`);
        } catch {}
      }
      exec(sql: string) {
        return this.rawDb.exec(sql);
      }
      prepare(sql: string) {
        const query = this.rawDb.query(sql);
        return {
          get: (...params: any[]) => query.get(...params) ?? undefined,
          all: (...params: any[]) => query.all(...params),
          run: (...params: any[]) => query.run(...params),
        };
      }
      transaction(fn: any) {
        return this.rawDb.transaction(fn);
      }
    }
    return new BunDatabaseWrapper(DB_PATH);
  }

  try {
    const BetterSqlite3 = require("better-sqlite3");
    return new BetterSqlite3(DB_PATH);
  } catch (err) {
    try {
      const { Database } = require("bun:sqlite");
      class BunDatabaseWrapper {
        private rawDb: any;
        constructor(filePath: string) {
          this.rawDb = new Database(filePath, { create: true });
        }
        pragma(pragmaStr: string) {
          try {
            this.rawDb.exec(`PRAGMA ${pragmaStr}`);
          } catch {}
        }
        exec(sql: string) {
          return this.rawDb.exec(sql);
        }
        prepare(sql: string) {
          const query = this.rawDb.query(sql);
          return {
            get: (...params: any[]) => query.get(...params) ?? undefined,
            all: (...params: any[]) => query.all(...params),
            run: (...params: any[]) => query.run(...params),
          };
        }
        transaction(fn: any) {
          return this.rawDb.transaction(fn);
        }
      }
      return new BunDatabaseWrapper(DB_PATH);
    } catch {
      throw err;
    }
  }
}

export const db = createDatabaseInstance();

// Configure SQLite for high performance and safety
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export interface UserRecord {
  id: string;
  username: string;
  password_hash: string;
  display_name: string | null;
  role: "admin" | "user";
  status: "active" | "disabled";
  created_at: string;
  updated_at: string;
}

export interface SafeUserDto {
  id: string;
  username: string;
  displayName: string | null;
  role: "admin" | "user";
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
}

export interface SystemSettingRecord {
  key: string;
  value: string;
  updated_at: string;
}

export interface ProjectRecord {
  id: string;
  user_id: string;
  name: string;
  canvas_data: string;
  thumbnail: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssetRecord {
  id: string;
  user_id: string;
  filename: string;
  original_name: string | null;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  created_at: string;
}

export function toSafeUser(user: UserRecord): SafeUserDto {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    status: user.status,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

export function initSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      canvas_data TEXT NOT NULL,
      thumbnail TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
    CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at DESC);

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      storage_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_assets_user_id ON assets(user_id);
    CREATE INDEX IF NOT EXISTS idx_assets_created_at ON assets(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_assets_size_bytes ON assets(size_bytes DESC);

    CREATE TABLE IF NOT EXISTS ai_channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider_type TEXT NOT NULL DEFAULT 'openai',
      base_url TEXT NOT NULL,
      api_key TEXT NOT NULL,
      models TEXT NOT NULL DEFAULT '[]',
      default_model TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      weight INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      timeout_ms INTEGER NOT NULL DEFAULT 300000,
      custom_headers TEXT DEFAULT '{}',
      health_status TEXT NOT NULL DEFAULT 'unknown',
      last_latency_ms INTEGER,
      last_checked_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_channels_active_priority ON ai_channels(is_active, priority DESC);

    CREATE TABLE IF NOT EXISTS ai_audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      username TEXT,
      request_type TEXT NOT NULL CHECK(request_type IN ('image_generation', 'image_edit', 'chat_completion')),
      model TEXT NOT NULL,
      channel_id TEXT,
      channel_name TEXT,
      status TEXT NOT NULL CHECK(status IN ('success', 'failed')),
      status_code INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      prompt_preview TEXT,
      request_body TEXT,
      response_summary TEXT,
      error_message TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      ip_address TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_audit_logs_created_at ON ai_audit_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ai_audit_logs_status ON ai_audit_logs(status);
    CREATE INDEX IF NOT EXISTS idx_ai_audit_logs_channel_id ON ai_audit_logs(channel_id);
    CREATE INDEX IF NOT EXISTS idx_ai_audit_logs_user_id ON ai_audit_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_ai_audit_logs_model ON ai_audit_logs(model);
  `);

  // Auto-seeding: If ai_channels is empty and system_settings has legacy AI config (ai.base_url), seed active channel
  try {
    const channelCountRow = db.prepare("SELECT COUNT(*) as count FROM ai_channels").get() as { count: number } | undefined;
    if (!channelCountRow || channelCountRow.count === 0) {
      const legacyBaseUrl = getSetting("ai.base_url");
      if (legacyBaseUrl && legacyBaseUrl.trim()) {
        const legacyConfig = getAiConfig();
        const channelId = crypto.randomUUID();
        const now = new Date().toISOString();
        const combinedModels = Array.from(new Set([...legacyConfig.imageModels, ...legacyConfig.chatModels]));
        db.prepare(`
          INSERT INTO ai_channels (
            id, name, provider_type, base_url, api_key, models, default_model,
            priority, weight, is_active, timeout_ms, custom_headers, health_status,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          channelId,
          "默认主渠道 (Legacy Migrated)",
          "openai",
          legacyConfig.baseUrl,
          legacyConfig.apiKey,
          JSON.stringify(combinedModels),
          legacyConfig.defaultModel,
          100,
          1,
          1,
          legacyConfig.timeoutMs || 300000,
          JSON.stringify(legacyConfig.customHeaders || {}),
          "unknown",
          now,
          now
        );
      }
    }
  } catch (err) {
    console.error("Failed to seed initial ai_channels:", err);
  }
}

export function isSystemInitialized(): boolean {
  const adminRow = db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'admin'`).get() as { count: number } | undefined;
  if (adminRow && adminRow.count > 0) {
    return true;
  }
  const settingRow = db.prepare(`SELECT value FROM system_settings WHERE key = 'system.initialized'`).get() as { value: string } | undefined;
  return settingRow?.value === "true";
}

export function getSetting(key: string): string | null {
  const row = db.prepare(`SELECT value FROM system_settings WHERE key = ?`).get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setSetting(key: string, value: string): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value, now);
}

export interface NoticeItem {
  id?: string;
  title: string;
  description: string;
  type: "info" | "warning" | "tip" | "error";
}

export interface SystemNoticeConfig {
  enabled: boolean;
  title: string;
  tag: string;
  tagColor: string;
  content: string;
  items: NoticeItem[];
  footerNote: string;
  updatedAt: string;
}

export const DEFAULT_NOTICE_CONFIG: SystemNoticeConfig = {
  enabled: true,
  title: "关于 Grok 2.0 图像模型画质设置的重要说明",
  tag: "重要通知",
  tagColor: "orange",
  content: "近期接入的 grok-imagine-image-2.0 图像生成与编辑模型，在调用时请注意以下说明：",
  items: [
    {
      title: "最高画质支持 Medium（2K）：",
      description: "xAI 官方底层接口目前仅开放了 Medium（2K 高清）与 Low（1K 极速）两个档位，Medium 即为官方当前最高画质。",
      type: "warning"
    },
    {
      title: "切勿选择 High（高质量）档位：",
      description: "因官方未开放 High 档位，选 High 会被官方接口拦截并报错 400 (quality 必须是 low 或 medium)，导致生图任务失败。",
      type: "error"
    },
    {
      title: "使用建议：",
      description: "在画布或生图工作台右侧面板中，将画质设为 Medium 即可正常极速出图。",
      type: "tip"
    }
  ],
  footerNote: "ℹ️ 后续若 xAI 官方开放 High 档位，系统将第一时间解除限制，请留意后续公告。",
  updatedAt: "2026-09-03T15:30:00.000Z"
};

export function getSystemNotice(): SystemNoticeConfig {
  const raw = getSetting("system.notice");
  if (!raw) {
    return DEFAULT_NOTICE_CONFIG;
  }
  try {
    const parsed = JSON.parse(raw);
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : true,
      title: typeof parsed.title === "string" ? parsed.title : DEFAULT_NOTICE_CONFIG.title,
      tag: typeof parsed.tag === "string" ? parsed.tag : DEFAULT_NOTICE_CONFIG.tag,
      tagColor: typeof parsed.tagColor === "string" ? parsed.tagColor : DEFAULT_NOTICE_CONFIG.tagColor,
      content: typeof parsed.content === "string" ? parsed.content : DEFAULT_NOTICE_CONFIG.content,
      items: Array.isArray(parsed.items) ? parsed.items : DEFAULT_NOTICE_CONFIG.items,
      footerNote: typeof parsed.footerNote === "string" ? parsed.footerNote : DEFAULT_NOTICE_CONFIG.footerNote,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : DEFAULT_NOTICE_CONFIG.updatedAt
    };
  } catch {
    return DEFAULT_NOTICE_CONFIG;
  }
}

export function resetSystemNotice(): SystemNoticeConfig {
  const resetConfig: SystemNoticeConfig = {
    ...DEFAULT_NOTICE_CONFIG,
    updatedAt: new Date().toISOString()
  };
  setSetting("system.notice", JSON.stringify(resetConfig));
  return resetConfig;
}

export function updateSystemNotice(config: Partial<SystemNoticeConfig>): SystemNoticeConfig {
  const current = getSystemNotice();
  const updated: SystemNoticeConfig = {
    enabled: typeof config.enabled === "boolean" ? config.enabled : current.enabled,
    title: typeof config.title === "string" ? config.title : current.title,
    tag: typeof config.tag === "string" ? config.tag : current.tag,
    tagColor: typeof config.tagColor === "string" ? config.tagColor : current.tagColor,
    content: typeof config.content === "string" ? config.content : current.content,
    items: Array.isArray(config.items) ? config.items : current.items,
    footerNote: typeof config.footerNote === "string" ? config.footerNote : current.footerNote,
    updatedAt: new Date().toISOString()
  };
  setSetting("system.notice", JSON.stringify(updated));
  return updated;
}

export interface AiConfigData {
  baseUrl: string;
  apiKey: string;
  imageModels: string[];
  defaultModel: string;
  chatModels: string[];
  timeoutMs?: number;
  customHeaders?: Record<string, string>;
}

export function getAiConfig(): AiConfigData {
  const baseUrl = getSetting("ai.base_url") || "https://api.openai.com/v1";
  const apiKey = getSetting("ai.api_key") || "";
  let imageModels = ["dall-e-3", "gpt-image-2"];
  let chatModels = ["gpt-4o", "gpt-4o-mini"];
  let defaultModel = getSetting("ai.default_model") || "dall-e-3";
  let timeoutMs = 300000;
  let customHeaders: Record<string, string> = {};

  const rawImageModels = getSetting("ai.image_models");
  if (rawImageModels) {
    try {
      const parsed = JSON.parse(rawImageModels);
      if (Array.isArray(parsed) && parsed.length > 0) {
        imageModels = parsed.filter((m) => typeof m === "string" && m.trim().length > 0);
      }
    } catch {}
  }

  const rawChatModels = getSetting("ai.chat_models");
  if (rawChatModels) {
    try {
      const parsed = JSON.parse(rawChatModels);
      if (Array.isArray(parsed) && parsed.length > 0) {
        chatModels = parsed.filter((m) => typeof m === "string" && m.trim().length > 0);
      }
    } catch {}
  }

  const rawTimeout = getSetting("ai.timeout_ms");
  if (rawTimeout) {
    const parsedTimeout = parseInt(rawTimeout, 10);
    if (!isNaN(parsedTimeout) && parsedTimeout > 0) {
      timeoutMs = parsedTimeout;
    }
  }

  const rawHeaders = getSetting("ai.custom_headers");
  if (rawHeaders) {
    try {
      const parsed = JSON.parse(rawHeaders);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        customHeaders = parsed;
      }
    } catch {}
  }

  return { baseUrl, apiKey, imageModels, defaultModel, chatModels, timeoutMs, customHeaders };
}

export function maskApiKey(apiKey: string): string {
  if (!apiKey || typeof apiKey !== "string") return "";
  const trimmed = apiKey.trim();
  if (trimmed.length === 0) return "";
  if (trimmed.length <= 8) return "sk-****";
  const prefix = trimmed.slice(0, 3);
  const suffix = trimmed.slice(-4);
  return `${prefix}****${suffix}`;
}

export function updateAiConfig(config: Partial<AiConfigData>): void {
  if (typeof config.baseUrl === "string" && config.baseUrl.trim()) {
    setSetting("ai.base_url", config.baseUrl.trim());
  }
  if (typeof config.apiKey === "string") {
    const cleanKey = config.apiKey.trim();
    if (cleanKey.length > 0 && !cleanKey.includes("****")) {
      setSetting("ai.api_key", cleanKey);
    }
  }
  if (Array.isArray(config.imageModels)) {
    const validModels = config.imageModels.filter((m) => typeof m === "string" && m.trim().length > 0);
    setSetting("ai.image_models", JSON.stringify(validModels));
  }
  if (typeof config.defaultModel === "string" && config.defaultModel.trim()) {
    setSetting("ai.default_model", config.defaultModel.trim());
  }
  if (Array.isArray(config.chatModels)) {
    const validModels = config.chatModels.filter((m) => typeof m === "string" && m.trim().length > 0);
    setSetting("ai.chat_models", JSON.stringify(validModels));
  }
  if (typeof config.timeoutMs === "number" && config.timeoutMs > 0) {
    setSetting("ai.timeout_ms", config.timeoutMs.toString());
  }
  if (config.customHeaders && typeof config.customHeaders === "object") {
    setSetting("ai.custom_headers", JSON.stringify(config.customHeaders));
  }

  // Synchronize to the legacy migrated channel in ai_channels if present
  try {
    const legacy = db.prepare("SELECT * FROM ai_channels WHERE name = '默认主渠道 (Legacy Migrated)' LIMIT 1").get() as ChannelRecord | undefined;
    const now = new Date().toISOString();
    const current = getAiConfig();
    const combinedModels = Array.from(new Set([...current.imageModels, ...current.chatModels]));

    if (legacy) {
      const newKey = (typeof config.apiKey === "string" && config.apiKey.trim().length > 0 && !config.apiKey.includes("****"))
        ? config.apiKey.trim() : legacy.api_key;
      const newBase = (typeof config.baseUrl === "string" && config.baseUrl.trim()) ? config.baseUrl.trim() : legacy.base_url;
      const newDef = (typeof config.defaultModel === "string" && config.defaultModel.trim()) ? config.defaultModel.trim() : legacy.default_model;
      const newTimeout = (typeof config.timeoutMs === "number" && config.timeoutMs > 0) ? config.timeoutMs : legacy.timeout_ms;
      const newHeaders = (config.customHeaders && typeof config.customHeaders === "object") ? JSON.stringify(config.customHeaders) : legacy.custom_headers;

      db.prepare(`
        UPDATE ai_channels
        SET base_url = ?, api_key = ?, models = ?, default_model = ?, timeout_ms = ?, custom_headers = ?, updated_at = ?
        WHERE id = ?
      `).run(newBase, newKey, JSON.stringify(combinedModels), newDef, newTimeout, newHeaders, now, legacy.id);
    } else {
      const count = (db.prepare("SELECT COUNT(*) as count FROM ai_channels").get() as { count: number }).count;
      if (count === 0) {
        db.prepare(`
          INSERT INTO ai_channels (
            id, name, provider_type, base_url, api_key, models, default_model,
            priority, weight, is_active, timeout_ms, custom_headers, health_status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          crypto.randomUUID(), "默认主渠道 (Legacy Migrated)", "openai", current.baseUrl, current.apiKey,
          JSON.stringify(combinedModels), current.defaultModel, 100, 1, 1, current.timeoutMs || 300000,
          JSON.stringify(current.customHeaders || {}), "unknown", now, now
        );
      }
    }
  } catch (err) {
    console.error("Failed to sync legacy config to ai_channels:", err);
  }
}

export interface ChannelRecord {
  id: string;
  name: string;
  provider_type: string;
  base_url: string;
  api_key: string;
  models: string; // JSON array string
  default_model: string | null;
  priority: number;
  weight: number;
  is_active: number;
  timeout_ms: number;
  custom_headers: string; // JSON object string
  health_status: "healthy" | "degraded" | "unhealthy" | "unknown";
  last_latency_ms: number | null;
  last_checked_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChannelDto {
  id: string;
  name: string;
  providerType: string;
  baseUrl: string;
  apiKeyMasked: string;
  hasKey: boolean;
  models: string[];
  defaultModel: string | null;
  priority: number;
  weight: number;
  isActive: boolean;
  timeoutMs: number;
  customHeaders: Record<string, string>;
  healthStatus: "healthy" | "degraded" | "unhealthy" | "unknown";
  lastLatencyMs: number | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toChannelDto(record: ChannelRecord): ChannelDto {
  let models: string[] = [];
  try {
    const parsed = JSON.parse(record.models);
    if (Array.isArray(parsed)) models = parsed.filter((m) => typeof m === "string" && m.trim().length > 0);
  } catch {}

  let customHeaders: Record<string, string> = {};
  try {
    const parsed = JSON.parse(record.custom_headers);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) customHeaders = parsed;
  } catch {}

  return {
    id: record.id,
    name: record.name,
    providerType: record.provider_type,
    baseUrl: record.base_url,
    apiKeyMasked: maskApiKey(record.api_key),
    hasKey: Boolean(record.api_key && record.api_key.trim().length > 0),
    models,
    defaultModel: record.default_model,
    priority: record.priority,
    weight: record.weight,
    isActive: Boolean(record.is_active),
    timeoutMs: record.timeout_ms,
    customHeaders,
    healthStatus: record.health_status,
    lastLatencyMs: record.last_latency_ms,
    lastCheckedAt: record.last_checked_at,
    lastError: record.last_error,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

export function listAiChannels(options?: {
  search?: string;
  status?: string;
  page?: number;
  limit?: number;
}): { channels: ChannelRecord[]; total: number } {
  let countSql = "SELECT COUNT(*) as total FROM ai_channels";
  let querySql = "SELECT * FROM ai_channels";
  const conditions: string[] = [];
  const params: any[] = [];

  if (options?.search && options.search.trim()) {
    conditions.push("(name LIKE ? OR base_url LIKE ? OR provider_type LIKE ?)");
    const term = `%${options.search.trim()}%`;
    params.push(term, term, term);
  }

  if (options?.status && options.status.trim()) {
    const st = options.status.trim().toLowerCase();
    if (st === "active" || st === "1" || st === "true") {
      conditions.push("is_active = 1");
    } else if (st === "inactive" || st === "disabled" || st === "0" || st === "false") {
      conditions.push("is_active = 0");
    } else if (["healthy", "degraded", "unhealthy", "unknown"].includes(st)) {
      conditions.push("health_status = ?");
      params.push(st);
    }
  }

  if (conditions.length > 0) {
    const where = ` WHERE ${conditions.join(" AND ")}`;
    countSql += where;
    querySql += where;
  }

  querySql += " ORDER BY priority DESC, weight DESC, created_at DESC";

  const page = Math.max(1, options?.page || 1);
  const limit = Math.min(100, Math.max(1, options?.limit || 50));
  const offset = (page - 1) * limit;

  const totalRow = db.prepare(countSql).get(...params) as { total: number };
  const channels = db.prepare(`${querySql} LIMIT ? OFFSET ?`).all(...params, limit, offset) as ChannelRecord[];

  return { channels, total: totalRow.total };
}

export function getAiChannelById(id: string): ChannelRecord | null {
  const row = db.prepare("SELECT * FROM ai_channels WHERE id = ?").get(id) as ChannelRecord | undefined;
  return row || null;
}

export function getActiveAiChannels(): ChannelRecord[] {
  return db.prepare("SELECT * FROM ai_channels WHERE is_active = 1 ORDER BY priority DESC, weight DESC, created_at ASC").all() as ChannelRecord[];
}

export function createAiChannel(channel: Omit<ChannelRecord, "created_at" | "updated_at">): ChannelRecord {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO ai_channels (
      id, name, provider_type, base_url, api_key, models, default_model,
      priority, weight, is_active, timeout_ms, custom_headers, health_status,
      last_latency_ms, last_checked_at, last_error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    channel.id,
    channel.name,
    channel.provider_type || "openai",
    channel.base_url,
    channel.api_key,
    channel.models || "[]",
    channel.default_model || null,
    channel.priority ?? 0,
    channel.weight ?? 1,
    channel.is_active ?? 1,
    channel.timeout_ms || 300000,
    channel.custom_headers || "{}",
    channel.health_status || "unknown",
    channel.last_latency_ms ?? null,
    channel.last_checked_at ?? null,
    channel.last_error ?? null,
    now,
    now
  );
  return getAiChannelById(channel.id)!;
}

export function updateAiChannel(id: string, updates: Partial<ChannelRecord>): ChannelRecord | null {
  const existing = getAiChannelById(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const name = updates.name !== undefined ? updates.name : existing.name;
  const provider_type = updates.provider_type !== undefined ? updates.provider_type : existing.provider_type;
  const base_url = updates.base_url !== undefined ? updates.base_url : existing.base_url;
  const api_key = (updates.api_key !== undefined && updates.api_key.trim() && !updates.api_key.includes("****"))
    ? updates.api_key : existing.api_key;
  const models = updates.models !== undefined ? updates.models : existing.models;
  const default_model = updates.default_model !== undefined ? updates.default_model : existing.default_model;
  const priority = updates.priority !== undefined ? updates.priority : existing.priority;
  const weight = updates.weight !== undefined ? updates.weight : existing.weight;
  const is_active = updates.is_active !== undefined ? updates.is_active : existing.is_active;
  const timeout_ms = updates.timeout_ms !== undefined ? updates.timeout_ms : existing.timeout_ms;
  const custom_headers = updates.custom_headers !== undefined ? updates.custom_headers : existing.custom_headers;
  const health_status = updates.health_status !== undefined ? updates.health_status : existing.health_status;
  const last_latency_ms = updates.last_latency_ms !== undefined ? updates.last_latency_ms : existing.last_latency_ms;
  const last_checked_at = updates.last_checked_at !== undefined ? updates.last_checked_at : existing.last_checked_at;
  const last_error = updates.last_error !== undefined ? updates.last_error : existing.last_error;

  db.prepare(`
    UPDATE ai_channels
    SET name = ?, provider_type = ?, base_url = ?, api_key = ?, models = ?, default_model = ?,
        priority = ?, weight = ?, is_active = ?, timeout_ms = ?, custom_headers = ?,
        health_status = ?, last_latency_ms = ?, last_checked_at = ?, last_error = ?, updated_at = ?
    WHERE id = ?
  `).run(
    name, provider_type, base_url, api_key, models, default_model,
    priority, weight, is_active, timeout_ms, custom_headers,
    health_status, last_latency_ms, last_checked_at, last_error, now,
    id
  );

  return getAiChannelById(id);
}

export function deleteAiChannel(id: string): boolean {
  const res = db.prepare("DELETE FROM ai_channels WHERE id = ?").run(id);
  return ((res as any)?.changes || 0) > 0;
}

export function updateChannelHealth(
  id: string,
  health: {
    healthStatus: "healthy" | "degraded" | "unhealthy" | "unknown";
    latencyMs?: number | null;
    lastError?: string | null;
  }
): void {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE ai_channels
    SET health_status = ?,
        last_latency_ms = COALESCE(?, last_latency_ms),
        last_checked_at = ?,
        last_error = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    health.healthStatus,
    health.latencyMs !== undefined ? health.latencyMs : null,
    now,
    health.lastError !== undefined ? health.lastError : null,
    now,
    id
  );
}

export interface AiAuditLogRecord {
  id: string;
  user_id: string | null;
  username: string | null;
  request_type: "image_generation" | "image_edit" | "chat_completion";
  model: string;
  channel_id: string | null;
  channel_name: string | null;
  status: "success" | "failed";
  status_code: number;
  duration_ms: number;
  prompt_preview: string | null;
  request_body: string | null;
  response_summary: string | null;
  error_message: string | null;
  retry_count: number;
  ip_address: string | null;
  created_at: string;
}

export interface AiAuditLogDto {
  id: string;
  userId: string | null;
  username: string | null;
  requestType: "image_generation" | "image_edit" | "chat_completion";
  model: string;
  channelId: string | null;
  channelName: string | null;
  status: "success" | "failed";
  statusCode: number;
  durationMs: number;
  promptPreview: string | null;
  requestBody?: string | null;
  responseSummary?: string | null;
  errorMessage?: string | null;
  retryCount: number;
  ipAddress?: string | null;
  createdAt: string;
}

export function toAiAuditLogDto(record: AiAuditLogRecord): AiAuditLogDto {
  return {
    id: record.id,
    userId: record.user_id,
    username: record.username,
    requestType: record.request_type,
    model: record.model,
    channelId: record.channel_id,
    channelName: record.channel_name,
    status: record.status,
    statusCode: record.status_code,
    durationMs: record.duration_ms,
    promptPreview: record.prompt_preview,
    requestBody: record.request_body,
    responseSummary: record.response_summary,
    errorMessage: record.error_message,
    retryCount: record.retry_count,
    ipAddress: record.ip_address,
    createdAt: record.created_at,
  };
}

export function insertAiAuditLog(log: Omit<AiAuditLogRecord, "id" | "created_at"> & { id?: string; created_at?: string }): AiAuditLogRecord {
  const id = log.id || crypto.randomUUID();
  const created_at = log.created_at || new Date().toISOString();

  db.prepare(`
    INSERT INTO ai_audit_logs (
      id, user_id, username, request_type, model, channel_id, channel_name,
      status, status_code, duration_ms, prompt_preview, request_body,
      response_summary, error_message, retry_count, ip_address, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    log.user_id ?? null,
    log.username ?? null,
    log.request_type,
    log.model,
    log.channel_id ?? null,
    log.channel_name ?? null,
    log.status,
    log.status_code,
    log.duration_ms,
    log.prompt_preview ?? null,
    log.request_body ?? null,
    log.response_summary ?? null,
    log.error_message ?? null,
    log.retry_count ?? 0,
    log.ip_address ?? null,
    created_at
  );

  return {
    id,
    user_id: log.user_id ?? null,
    username: log.username ?? null,
    request_type: log.request_type,
    model: log.model,
    channel_id: log.channel_id ?? null,
    channel_name: log.channel_name ?? null,
    status: log.status,
    status_code: log.status_code,
    duration_ms: log.duration_ms,
    prompt_preview: log.prompt_preview ?? null,
    request_body: log.request_body ?? null,
    response_summary: log.response_summary ?? null,
    error_message: log.error_message ?? null,
    retry_count: log.retry_count ?? 0,
    ip_address: log.ip_address ?? null,
    created_at,
  };
}

export function getAiAuditLogById(id: string): AiAuditLogRecord | null {
  const row = db.prepare("SELECT * FROM ai_audit_logs WHERE id = ?").get(id) as AiAuditLogRecord | undefined;
  return row || null;
}

export function listAiAuditLogs(filters: {
  page?: number;
  limit?: number;
  status?: string;
  requestType?: string;
  model?: string;
  channelId?: string;
  userId?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
}): { logs: AiAuditLogRecord[]; total: number } {
  const page = Math.max(1, filters.page || 1);
  const limit = Math.min(100, Math.max(1, filters.limit || 20));
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const params: any[] = [];

  if (filters.status && filters.status !== "all") {
    conditions.push("status = ?");
    params.push(filters.status);
  }

  if (filters.requestType && filters.requestType !== "all") {
    conditions.push("request_type = ?");
    params.push(filters.requestType);
  }

  if (filters.model && filters.model.trim()) {
    conditions.push("model LIKE ?");
    params.push(`%${filters.model.trim()}%`);
  }

  if (filters.channelId && filters.channelId.trim()) {
    conditions.push("channel_id = ?");
    params.push(filters.channelId.trim());
  }

  if (filters.userId && filters.userId.trim()) {
    conditions.push("user_id = ?");
    params.push(filters.userId.trim());
  }

  if (filters.startDate && filters.startDate.trim()) {
    conditions.push("created_at >= ?");
    params.push(filters.startDate.trim());
  }

  if (filters.endDate && filters.endDate.trim()) {
    conditions.push("created_at <= ?");
    params.push(filters.endDate.trim());
  }

  if (filters.search && filters.search.trim()) {
    const s = `%${filters.search.trim()}%`;
    conditions.push("(prompt_preview LIKE ? OR error_message LIKE ? OR username LIKE ? OR channel_name LIKE ?)");
    params.push(s, s, s, s);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM ai_audit_logs ${whereClause}`).get(...params) as { total: number };
  const logs = db.prepare(`
    SELECT * FROM ai_audit_logs
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as AiAuditLogRecord[];

  return { logs, total: countRow?.total || 0 };
}

// Run schema migration immediately on module import
initSchema();

