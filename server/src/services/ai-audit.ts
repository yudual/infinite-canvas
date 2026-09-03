import {
  getAiConfig,
  getActiveAiChannels,
  insertAiAuditLog,
  type AiAuditLogRecord,
} from "../db.js";

/**
 * Parameters for recording an AI audit log entry
 */
export interface RecordAiAuditParams {
  userId?: string | null;
  username?: string | null;
  requestType: "image_generation" | "image_edit" | "chat_completion";
  model: string;
  channelId?: string | null;
  channelName?: string | null;
  status: "success" | "failed";
  statusCode: number;
  durationMs: number;
  promptPreview?: string | null;
  requestBody?: any;
  responseSummary?: any;
  errorMessage?: string | null;
  retryCount?: number;
  ipAddress?: string | null;
}

/**
 * Collect all active channel and system API keys for zero-leak sanitization
 */
export function getAllKnownApiKeys(): string[] {
  const keys: string[] = [];
  try {
    const legacy = getAiConfig();
    if (legacy?.apiKey) keys.push(legacy.apiKey);
    const channels = getActiveAiChannels();
    for (const c of channels) {
      if (c?.api_key) keys.push(c.api_key);
    }
  } catch {}
  return Array.from(new Set(keys.filter((k) => k && typeof k === "string" && k.trim().length >= 4)));
}

/**
 * Recursively sanitizes payloads:
 * 1. Zero Base64 Bleed: Summarizes data URLs and raw base64 payloads to [Base64 Image: X KB]
 * 2. Zero Key Leak: Replaces any known API keys, sk- tokens, or Authorization Bearer secrets with [REDACTED]
 */
export function sanitizeForAudit(input: any, knownKeys: string[] = []): any {
  if (input === null || input === undefined) return input;

  if (typeof input === "string") {
    let text = input;

    // 1. Redact known API keys
    for (const key of knownKeys) {
      if (key && key.trim().length >= 4) {
        text = text.replaceAll(key.trim(), "[REDACTED]");
      }
    }

    // 2. Redact common API key formats (sk-..., Bearer ...)
    text = text.replace(/sk-[a-zA-Z0-9_\-]{20,}/g, "[REDACTED]");
    text = text.replace(/Bearer\s+[A-Za-z0-9_\-.~+/]+=*/gi, "Bearer [REDACTED]");

    // 3. Zero Base64 Bleed: Data URL images
    text = text.replace(/data:image\/[a-zA-Z0-9.+_\-]+;base64,[A-Za-z0-9+/=]+/g, (match) => {
      const sizeKb = Math.max(1, Math.round((match.length * 0.75) / 1024));
      return `[Base64 Image: ${sizeKb} KB]`;
    });

    // 4. Zero Base64 Bleed: Standalone long base64 chunks
    if (text.length > 500 && /^[A-Za-z0-9+/=]+$/.test(text.trim())) {
      const sizeKb = Math.max(1, Math.round((text.length * 0.75) / 1024));
      return `[Base64 Data: ${sizeKb} KB]`;
    }

    return text;
  }

  if (Array.isArray(input)) {
    return input.map((item) => sanitizeForAudit(item, knownKeys));
  }

  if (typeof input === "object") {
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(input)) {
      const lowerKey = k.toLowerCase();
      // Inspect for base64 fields (b64_json, image, mask, etc.)
      if (
        (lowerKey.includes("b64") || lowerKey === "image" || lowerKey === "mask") &&
        typeof v === "string"
      ) {
        if (v.startsWith("data:image/") || (v.length > 100 && /^[A-Za-z0-9+/=]+$/.test(v.trim()))) {
          const sizeKb = Math.max(1, Math.round((v.length * 0.75) / 1024));
          result[k] = `[Base64 Image: ${sizeKb} KB]`;
          continue;
        }
      }
      result[k] = sanitizeForAudit(v, knownKeys);
    }
    return result;
  }

  return input;
}

/**
 * Formats a clean response summary without large base64 image bloat
 */
export function summarizeResponse(data: any, knownKeys: string[] = []): string {
  if (!data) return "";
  try {
    if (typeof data === "string") {
      return sanitizeForAudit(data.slice(0, 1000), knownKeys);
    }

    // Image generation / edit responses
    if (Array.isArray(data?.data)) {
      const items = data.data;
      const urls = items.filter((it: any) => typeof it?.url === "string").map((it: any) => it.url);
      const b64Items = items.filter((it: any) => typeof it?.b64_json === "string");
      const summary: Record<string, any> = { count: items.length };

      if (urls.length > 0) {
        summary.urls = urls;
      }
      if (b64Items.length > 0) {
        summary.format = "b64_json";
        summary.base64Images = b64Items.map((it: any) => {
          const sizeKb = Math.max(1, Math.round(((it.b64_json?.length || 0) * 0.75) / 1024));
          return `[Base64 Image: ${sizeKb} KB]`;
        });
      }

      return JSON.stringify(summary);
    }

    if (Array.isArray(data?.images)) {
      return JSON.stringify({
        count: data.images.length,
        format: "images_array",
        sample: sanitizeForAudit(data.images[0], knownKeys),
      });
    }

    // Chat completion responses
    if (Array.isArray(data?.choices)) {
      const choice = data.choices[0];
      const content = choice?.message?.content;
      const preview = typeof content === "string" ? content.slice(0, 300) : undefined;
      return JSON.stringify({
        contentPreview: sanitizeForAudit(preview, knownKeys),
        finishReason: choice?.finish_reason,
        usage: data.usage,
      });
    }

    const sanitized = sanitizeForAudit(data, knownKeys);
    const serialized = JSON.stringify(sanitized);
    return serialized.length > 2000 ? serialized.slice(0, 2000) + "... [truncated]" : serialized;
  } catch {
    return "";
  }
}

/**
 * AI Audit Logging Service
 */
export class AiAuditService {
  /**
   * Records a structured AI audit log entry into SQLite.
   * Completely non-blocking and safe: DB errors are caught internally so AI requests are never disrupted.
   */
  static async record(params: RecordAiAuditParams): Promise<AiAuditLogRecord | null> {
    try {
      // 1. Gather all API keys to guarantee zero secret leaks
      const knownKeys = getAllKnownApiKeys();

      // 2. Sanitize prompt preview (guaranteed no base64 and no key leaks)
      let promptPreview: string | null = null;
      if (params.promptPreview && typeof params.promptPreview === "string") {
        const sanitized = sanitizeForAudit(params.promptPreview, knownKeys);
        if (typeof sanitized === "string") {
          promptPreview = sanitized.length > 1000 ? sanitized.slice(0, 1000) + "..." : sanitized;
        }
      }

      // 3. Sanitize request body (zero base64 bleed and key redaction)
      let requestBodyStr: string | null = null;
      if (params.requestBody !== undefined && params.requestBody !== null) {
        const sanitizedBody = sanitizeForAudit(params.requestBody, knownKeys);
        requestBodyStr = typeof sanitizedBody === "string" ? sanitizedBody : JSON.stringify(sanitizedBody);
        if (requestBodyStr.length > 30000) {
          requestBodyStr = requestBodyStr.slice(0, 30000) + "... [truncated]";
        }
      }

      // 4. Sanitize response summary
      let responseSummaryStr: string | null = null;
      if (params.responseSummary !== undefined && params.responseSummary !== null) {
        if (typeof params.responseSummary === "string") {
          responseSummaryStr = sanitizeForAudit(params.responseSummary, knownKeys);
        } else {
          responseSummaryStr = summarizeResponse(params.responseSummary, knownKeys);
        }
        if (responseSummaryStr && responseSummaryStr.length > 10000) {
          responseSummaryStr = responseSummaryStr.slice(0, 10000) + "... [truncated]";
        }
      }

      // 5. Sanitize error message
      let errorMessage: string | null = null;
      if (params.errorMessage) {
        errorMessage = sanitizeForAudit(params.errorMessage, knownKeys);
        if (typeof errorMessage === "string" && errorMessage.length > 2000) {
          errorMessage = errorMessage.slice(0, 2000) + "... [truncated]";
        }
      }

      // 6. Non-blocking persist to SQLite
      return insertAiAuditLog({
        user_id: params.userId || null,
        username: params.username || null,
        request_type: params.requestType,
        model: params.model,
        channel_id: params.channelId || null,
        channel_name: params.channelName || null,
        status: params.status,
        status_code: params.statusCode,
        duration_ms: params.durationMs,
        prompt_preview: promptPreview,
        request_body: requestBodyStr,
        response_summary: responseSummaryStr,
        error_message: errorMessage,
        retry_count: params.retryCount ?? 0,
        ip_address: params.ipAddress || null,
      });
    } catch (err) {
      console.error("AiAuditService.record caught error (request preserved):", err);
      return null;
    }
  }
}
