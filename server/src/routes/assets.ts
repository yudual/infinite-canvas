import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { db } from "../db.js";
import { authenticateToken } from "../middleware/auth.js";
import { uploadMiddleware } from "../middleware/upload.js";
import { UPLOADS_DIR } from "../config.js";

export const assetsRouter = Router();

// Protect all assets endpoints with JWT
assetsRouter.use(authenticateToken);

function handleUpload(req: Request, res: Response) {
  uploadMiddleware.single("file")(req, res, (err: any) => {
    if (err) {
      return res.status(400).json({
        success: false,
        error: {
          code: "UPLOAD_ERROR",
          message: err.message || "Failed to process uploaded file",
        },
        message: err.message || "Failed to process uploaded file",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: {
          code: "NO_FILE_PROVIDED",
          message: "No file was uploaded in request field 'file'",
        },
        message: "No file was uploaded in request field 'file'",
      });
    }

    try {
      const assetId = crypto.randomUUID();
      const now = new Date().toISOString();
      const relativeUrl = `/uploads/${req.file.filename}`;

      db.prepare(`
        INSERT INTO assets (id, user_id, filename, original_name, mime_type, size_bytes, storage_path, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        assetId,
        req.user!.id,
        req.file.filename,
        req.file.originalname || req.file.filename,
        req.file.mimetype,
        req.file.size,
        req.file.path,
        now
      );

      const assetDto = {
        id: assetId,
        url: relativeUrl,
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        createdAt: now,
      };

      return res.status(201).json({
        success: true,
        asset: assetDto,
        ...assetDto, // Flattened compatibility
      });
    } catch (dbErr: any) {
      // Keep the database and filesystem in sync when metadata persistence fails.
      try {
        if (req.file?.path && fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
      } catch (cleanupErr) {
        console.warn("Failed to clean up uploaded asset after DB error:", cleanupErr);
      }
      console.error("Asset DB insert error:", dbErr);
      return res.status(500).json({
        success: false,
        error: {
          code: "DB_ERROR",
          message: "Failed to save asset record",
        },
        message: "Failed to save asset record",
      });
    }
  });
}

// 1. Upload endpoints
assetsRouter.post("/upload", handleUpload);
assetsRouter.post("/", handleUpload);

// 2. GET /api/assets
assetsRouter.get("/", (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 30));
    const offset = (page - 1) * limit;

    const countRow = db.prepare(`SELECT COUNT(*) as count FROM assets WHERE user_id = ?`).get(req.user!.id) as { count: number };
    const total = countRow ? countRow.count : 0;

    const rows = db.prepare(`
      SELECT id, filename, original_name, mime_type, size_bytes, created_at
      FROM assets
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(req.user!.id, limit, offset) as any[];

    const assets = rows.map((r) => ({
      id: r.id,
      url: `/uploads/${r.filename}`,
      filename: r.filename,
      originalName: r.original_name,
      mimeType: r.mime_type,
      sizeBytes: r.size_bytes,
      createdAt: r.created_at,
    }));

    return res.json({
      success: true,
      assets,
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

// 3. DELETE /api/assets/:id
assetsRouter.delete("/:id", (req: Request, res: Response) => {
  try {
    const asset = db.prepare(`SELECT * FROM assets WHERE id = ? AND user_id = ?`).get(req.params.id, req.user!.id) as any;
    if (!asset) {
      return res.status(404).json({
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "Asset not found or access denied",
        },
        message: "Asset not found or access denied",
      });
    }

    db.prepare(`DELETE FROM assets WHERE id = ? AND user_id = ?`).run(req.params.id, req.user!.id);

    // Remove file from disk
    const filePath = asset.storage_path || path.join(UPLOADS_DIR, asset.filename);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        console.warn("Failed to delete physical asset file:", filePath, e);
      }
    }

    return res.json({ success: true, message: "Asset deleted successfully" });
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
