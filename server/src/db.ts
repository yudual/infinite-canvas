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
  `);
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
}

// Run schema migration immediately on module import
initSchema();

