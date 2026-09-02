import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { db } from "../db.js";
import { authenticateToken } from "../middleware/auth.js";

export const projectsRouter = Router();

// Protect all project endpoints with JWT
projectsRouter.use(authenticateToken);

// ==========================================
// 1. GET /api/projects
// ==========================================
projectsRouter.get("/", (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 50));
    const offset = (page - 1) * limit;
    const search = (req.query.search as string || "").trim();

    let countSql = `SELECT COUNT(*) as count FROM projects WHERE user_id = ?`;
    let querySql = `
      SELECT id, user_id, name, thumbnail, created_at, updated_at
      FROM projects
      WHERE user_id = ?
    `;
    const params: any[] = [req.user!.id];

    if (search) {
      countSql += ` AND name LIKE ?`;
      querySql += ` AND name LIKE ?`;
      params.push(`%${search}%`);
    }

    querySql += ` ORDER BY updated_at DESC LIMIT ? OFFSET ?`;

    const countRow = db.prepare(countSql).get(...params) as { count: number };
    const total = countRow ? countRow.count : 0;

    const rows = db.prepare(querySql).all(...params, limit, offset) as any[];

    const projects = rows.map((r) => ({
      id: r.id,
      name: r.name,
      thumbnail: r.thumbnail,
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
    return res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: err.message,
      },
      message: err.message,
    });
  }
});

// ==========================================
// 2. POST /api/projects
// ==========================================
projectsRouter.post("/", (req: Request, res: Response) => {
  try {
    const { name, canvasData, thumbnail } = req.body || {};

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_NAME",
          message: "Project name is required",
        },
        message: "Project name is required",
      });
    }

    const projectId = crypto.randomUUID();
    const now = new Date().toISOString();
    const serializedData = typeof canvasData === "string" ? canvasData : JSON.stringify(canvasData ?? {});

    db.prepare(`
      INSERT INTO projects (id, user_id, name, canvas_data, thumbnail, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      projectId,
      req.user!.id,
      name.trim(),
      serializedData,
      thumbnail || null,
      now,
      now
    );

    return res.status(201).json({
      success: true,
      project: {
        id: projectId,
        name: name.trim(),
        canvasData: typeof canvasData === "object" ? canvasData : JSON.parse(serializedData),
        thumbnail: thumbnail || null,
        createdAt: now,
        updatedAt: now,
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: err.message,
      },
      message: err.message,
    });
  }
});

// ==========================================
// 3. GET /api/projects/:id
// ==========================================
projectsRouter.get("/:id", (req: Request, res: Response) => {
  try {
    const row = db.prepare(`SELECT * FROM projects WHERE id = ? AND user_id = ?`).get(req.params.id, req.user!.id) as any;
    if (!row) {
      return res.status(404).json({
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "Project not found or access denied",
        },
        message: "Project not found or access denied",
      });
    }

    let parsedCanvasData: any = {};
    try {
      parsedCanvasData = JSON.parse(row.canvas_data);
    } catch {
      parsedCanvasData = row.canvas_data;
    }

    return res.json({
      success: true,
      project: {
        id: row.id,
        name: row.name,
        canvasData: parsedCanvasData,
        thumbnail: row.thumbnail,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: err.message,
      },
      message: err.message,
    });
  }
});

// ==========================================
// 4. PUT /api/projects/:id
// ==========================================
projectsRouter.put("/:id", (req: Request, res: Response) => {
  try {
    const existing = db.prepare(`SELECT * FROM projects WHERE id = ? AND user_id = ?`).get(req.params.id, req.user!.id) as any;
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "Project not found or access denied",
        },
        message: "Project not found or access denied",
      });
    }

    const { name, canvasData, thumbnail } = req.body || {};
    const now = new Date().toISOString();

    const updatedName = typeof name === "string" && name.trim() ? name.trim() : existing.name;
    let serializedData = existing.canvas_data;
    if (canvasData !== undefined) {
      serializedData = typeof canvasData === "string" ? canvasData : JSON.stringify(canvasData);
    }
    const updatedThumbnail = thumbnail !== undefined ? thumbnail : existing.thumbnail;

    db.prepare(`
      UPDATE projects
      SET name = ?, canvas_data = ?, thumbnail = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(updatedName, serializedData, updatedThumbnail, now, req.params.id, req.user!.id);

    let parsedCanvasData: any = {};
    try {
      parsedCanvasData = JSON.parse(serializedData);
    } catch {
      parsedCanvasData = serializedData;
    }

    return res.json({
      success: true,
      project: {
        id: req.params.id,
        name: updatedName,
        canvasData: parsedCanvasData,
        thumbnail: updatedThumbnail,
        createdAt: existing.created_at,
        updatedAt: now,
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: err.message,
      },
      message: err.message,
    });
  }
});

// ==========================================
// 5. DELETE /api/projects/:id
// ==========================================
projectsRouter.delete("/:id", (req: Request, res: Response) => {
  try {
    const existing = db.prepare(`SELECT * FROM projects WHERE id = ? AND user_id = ?`).get(req.params.id, req.user!.id) as any;
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "Project not found or access denied",
        },
        message: "Project not found or access denied",
      });
    }

    db.prepare(`DELETE FROM projects WHERE id = ? AND user_id = ?`).run(req.params.id, req.user!.id);

    return res.json({
      success: true,
      message: "Project deleted successfully",
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: err.message,
      },
      message: err.message,
    });
  }
});
