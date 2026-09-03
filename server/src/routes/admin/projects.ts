import { Router, type Request, type Response } from "express";
import { db, type ProjectRecord } from "../../db.js";

export const projectsAdminRouter = Router();

/**
 * Standard empty canvas JSON structure for project corruption recovery
 */
export const CLEAN_EMPTY_CANVAS = {
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
};

/**
 * GET /api/admin/projects
 * Lists all user cloud canvas projects with pagination, search, and user filtering.
 * Joins users table to return owner username and userDisplayName.
 * Calculates canvasDataSize via LENGTH(canvas_data).
 */
projectsAdminRouter.get("/", (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || "20", 10)));
    const offset = (page - 1) * limit;

    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const userId = typeof req.query.userId === "string" ? req.query.userId.trim() : "";

    // Sort column validation
    const sortByParam = typeof req.query.sortBy === "string" ? req.query.sortBy.trim() : "updated_at";
    let sortColumn = "p.updated_at";
    if (sortByParam === "created_at" || sortByParam === "createdAt") {
      sortColumn = "p.created_at";
    } else if (sortByParam === "updated_at" || sortByParam === "updatedAt") {
      sortColumn = "p.updated_at";
    } else if (sortByParam === "name") {
      sortColumn = "p.name";
    } else if (sortByParam === "canvasDataSize" || sortByParam === "canvas_data_size" || sortByParam === "size") {
      sortColumn = "LENGTH(p.canvas_data)";
    }

    const sortOrderParam = typeof req.query.sortOrder === "string" && req.query.sortOrder.toUpperCase() === "ASC"
      ? "ASC"
      : "DESC";

    const conditions: string[] = [];
    const params: any[] = [];

    if (search) {
      conditions.push("p.name LIKE ?");
      params.push(`%${search}%`);
    }

    if (userId) {
      conditions.push("p.user_id = ?");
      params.push(userId);
    }

    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";

    // 1. Total matching count
    const countSql = `SELECT COUNT(*) as total FROM projects p${whereClause}`;
    const totalRow = db.prepare(countSql).get(...params) as { total: number } | undefined;
    const total = totalRow?.total ?? 0;

    // 2. Query projects list without bloat (only LENGTH(canvas_data))
    const querySql = `
      SELECT p.id, p.user_id, p.name, p.thumbnail,
             LENGTH(p.canvas_data) as canvasDataSize,
             p.created_at, p.updated_at,
             u.username, u.display_name as user_display_name
      FROM projects p
      LEFT JOIN users u ON p.user_id = u.id
      ${whereClause}
      ORDER BY ${sortColumn} ${sortOrderParam}
      LIMIT ? OFFSET ?
    `;

    const rows = db.prepare(querySql).all(...params, limit, offset) as any[];

    const projects = rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      username: r.username || "unknown",
      userDisplayName: r.user_display_name || r.username || null,
      displayName: r.user_display_name || r.username || null,
      name: r.name,
      thumbnail: r.thumbnail,
      canvasDataSize: r.canvasDataSize ?? 0,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    return res.json({
      success: true,
      projects,
      total,
      page,
      limit,
    });
  } catch (err: any) {
    console.error("Error listing admin projects:", err);
    return res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: err.message },
      message: err.message,
    });
  }
});

/**
 * GET /api/admin/projects/:id
 * Fetches full details for a single cloud project, including parsed canvasData.
 */
projectsAdminRouter.get("/:id", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const row = db.prepare(`
      SELECT p.*, LENGTH(p.canvas_data) as canvasDataSize,
             u.username, u.display_name as user_display_name
      FROM projects p
      LEFT JOIN users u ON p.user_id = u.id
      WHERE p.id = ?
    `).get(id) as any;

    if (!row) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Project not found" },
        message: "Project not found",
      });
    }

    let parsedCanvasData: any = null;
    let isCorrupted = false;
    try {
      parsedCanvasData = JSON.parse(row.canvas_data);
    } catch {
      isCorrupted = true;
      parsedCanvasData = row.canvas_data;
    }

    return res.json({
      success: true,
      project: {
        id: row.id,
        userId: row.user_id,
        username: row.username || "unknown",
        userDisplayName: row.user_display_name || row.username || null,
        name: row.name,
        thumbnail: row.thumbnail,
        canvasData: parsedCanvasData,
        canvasDataSize: row.canvasDataSize ?? 0,
        isCorrupted,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (err: any) {
    console.error("Error getting admin project details:", err);
    return res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: err.message },
      message: err.message,
    });
  }
});

/**
 * POST /api/admin/projects/:id/reset
 * Resets damaged or corrupted canvas_data to a clean empty canvas JSON structure,
 * preserving project ownership and name.
 */
projectsAdminRouter.post("/:id/reset", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existing = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRecord | undefined;

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Project not found" },
        message: "Project not found",
      });
    }

    const cleanCanvasStr = JSON.stringify(CLEAN_EMPTY_CANVAS);
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE projects
      SET canvas_data = ?, updated_at = ?
      WHERE id = ?
    `).run(cleanCanvasStr, now, id);

    const updatedRow = db.prepare(`
      SELECT p.*, LENGTH(p.canvas_data) as canvasDataSize,
             u.username, u.display_name as user_display_name
      FROM projects p
      LEFT JOIN users u ON p.user_id = u.id
      WHERE p.id = ?
    `).get(id) as any;

    return res.json({
      success: true,
      message: "Project canvas data reset to clean empty canvas",
      project: {
        id: updatedRow.id,
        userId: updatedRow.user_id,
        username: updatedRow.username || "unknown",
        userDisplayName: updatedRow.user_display_name || updatedRow.username || null,
        displayName: updatedRow.user_display_name || updatedRow.username || null,
        name: updatedRow.name,
        canvasData: CLEAN_EMPTY_CANVAS,
        canvasDataSize: updatedRow.canvasDataSize ?? cleanCanvasStr.length,
        thumbnail: updatedRow.thumbnail,
        createdAt: updatedRow.created_at,
        updatedAt: updatedRow.updated_at,
      },
    });
  } catch (err: any) {
    console.error("Error resetting project canvas data:", err);
    return res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: err.message },
      message: err.message,
    });
  }
});

/**
 * DELETE /api/admin/projects/:id
 * Deletes a cloud canvas project from SQLite.
 */
projectsAdminRouter.delete("/:id", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existing = db.prepare("SELECT id FROM projects WHERE id = ?").get(id);

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Project not found" },
        message: "Project not found",
      });
    }

    db.prepare("DELETE FROM projects WHERE id = ?").run(id);

    return res.json({
      success: true,
      message: "Project deleted successfully",
    });
  } catch (err: any) {
    console.error("Error deleting project:", err);
    return res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: err.message },
      message: err.message,
    });
  }
});

/**
 * POST /api/admin/projects/batch-delete
 * Bulk deletes multiple projects from SQLite in a transaction.
 */
projectsAdminRouter.post("/batch-delete", (req: Request, res: Response) => {
  try {
    const { ids } = req.body || {};

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_IDS", message: "ids array is required and must not be empty" },
        message: "ids array is required and must not be empty",
      });
    }

    const validIds = ids.filter((id) => typeof id === "string" && id.trim().length > 0);
    if (validIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_IDS", message: "No valid project IDs provided" },
        message: "No valid project IDs provided",
      });
    }

    const placeholders = validIds.map(() => "?").join(",");
    let deletedCount = 0;

    const deleteTx = db.transaction(() => {
      const info = db.prepare(`DELETE FROM projects WHERE id IN (${placeholders})`).run(...validIds);
      deletedCount = (info as any)?.changes || 0;
    });
    deleteTx();

    return res.json({
      success: true,
      deletedCount,
      message: `Successfully deleted ${deletedCount} project(s)`,
    });
  } catch (err: any) {
    console.error("Error in batch project deletion:", err);
    return res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: err.message },
      message: err.message,
    });
  }
});
