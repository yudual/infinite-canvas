import { Router, type Request, type Response } from "express";
import {
  db,
  listAiAuditLogs,
  getAiAuditLogById,
  toAiAuditLogDto,
  type AiAuditLogRecord,
} from "../../db.js";

export const auditLogsAdminRouter = Router();

/**
 * GET /api/admin/audit-logs
 * List and filter AI audit logs with pagination
 */
auditLogsAdminRouter.get("/", (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || "20", 10)));
    const status = typeof req.query.status === "string" ? req.query.status.trim() : undefined;
    const requestType =
      typeof req.query.requestType === "string"
        ? req.query.requestType.trim()
        : typeof req.query.request_type === "string"
        ? req.query.request_type.trim()
        : undefined;
    const model = typeof req.query.model === "string" ? req.query.model.trim() : undefined;
    const channelId =
      typeof req.query.channelId === "string"
        ? req.query.channelId.trim()
        : typeof req.query.channel_id === "string"
        ? req.query.channel_id.trim()
        : undefined;
    const userId =
      typeof req.query.userId === "string"
        ? req.query.userId.trim()
        : typeof req.query.user_id === "string"
        ? req.query.user_id.trim()
        : undefined;
    const startDate =
      typeof req.query.startDate === "string"
        ? req.query.startDate.trim()
        : typeof req.query.start_date === "string"
        ? req.query.start_date.trim()
        : undefined;
    const endDate =
      typeof req.query.endDate === "string"
        ? req.query.endDate.trim()
        : typeof req.query.end_date === "string"
        ? req.query.end_date.trim()
        : undefined;
    const search = typeof req.query.search === "string" ? req.query.search.trim() : undefined;

    const { logs, total } = listAiAuditLogs({
      page,
      limit,
      status,
      requestType,
      model,
      channelId,
      userId,
      startDate,
      endDate,
      search,
    });

    res.json({
      success: true,
      logs: logs.map(toAiAuditLogDto),
      total,
      page,
      limit,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: { code: "SERVER_ERROR", message: err.message || "Failed to query audit logs" },
      message: err.message || "Failed to query audit logs",
    });
  }
});

/**
 * GET /api/admin/audit-logs/stats
 * Aggregated statistics for audit logs dashboard
 */
auditLogsAdminRouter.get("/stats", (_req: Request, res: Response) => {
  try {
    const row = db.prepare(`
      SELECT
        COUNT(*) as totalRequests,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successCount,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failureCount,
        COALESCE(ROUND(AVG(duration_ms)), 0) as avgDurationMs
      FROM ai_audit_logs
    `).get() as {
      totalRequests: number;
      successCount: number;
      failureCount: number;
      avgDurationMs: number;
    };

    res.json({
      success: true,
      stats: {
        totalRequests: row?.totalRequests || 0,
        successCount: row?.successCount || 0,
        failureCount: row?.failureCount || 0,
        avgDurationMs: row?.avgDurationMs || 0,
      },
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: { code: "SERVER_ERROR", message: err.message || "Failed to fetch audit log stats" },
      message: err.message || "Failed to fetch audit log stats",
    });
  }
});

/**
 * POST /api/admin/audit-logs/clear
 * Purge historical audit logs
 */
auditLogsAdminRouter.post("/clear", (req: Request, res: Response) => {
  try {
    const { olderThanDays, clearAll } = req.body || {};
    let query = "DELETE FROM ai_audit_logs";
    const params: any[] = [];

    if (!clearAll && typeof olderThanDays === "number" && olderThanDays > 0) {
      const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
      query += " WHERE created_at < ?";
      params.push(cutoff);
    }

    const result = db.prepare(query).run(...params);
    res.json({
      success: true,
      clearedCount: (result as any)?.changes || 0,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: { code: "SERVER_ERROR", message: err.message || "Failed to clear audit logs" },
      message: err.message || "Failed to clear audit logs",
    });
  }
});

/**
 * GET /api/admin/audit-logs/:id
 * Retrieve single audit log detail for inspection drawer
 */
auditLogsAdminRouter.get("/:id", (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : String(req.params.id);
    const log = getAiAuditLogById(id);

    if (!log) {
      res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Audit log not found" },
        message: "Audit log not found",
      });
      return;
    }

    res.json({
      success: true,
      log: toAiAuditLogDto(log),
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: { code: "SERVER_ERROR", message: err.message || "Failed to fetch audit log" },
      message: err.message || "Failed to fetch audit log",
    });
  }
});
