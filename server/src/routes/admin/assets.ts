import fs from "node:fs";
import path from "node:path";
import { Router, type Request, type Response } from "express";
import { db, type AssetRecord } from "../../db.js";
import { UPLOADS_DIR } from "../../config.js";

export const assetsAdminRouter = Router();

/**
 * Common image extensions for disk traversal classification
 */
const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".webp", ".gif",
  ".svg", ".bmp", ".ico", ".avif", ".tiff"
]);

/**
 * GET /api/admin/assets/stats
 * Aggregates database storage metrics and real disk usage in data/uploads,
 * identifying total bytes, image count, and orphaned files on disk.
 */
assetsAdminRouter.get("/stats", (_req: Request, res: Response) => {
  try {
    // 1. Query SQLite storage stats
    const dbStats = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(size_bytes), 0) as totalBytes
      FROM assets
    `).get() as { count: number; totalBytes: number } | undefined;

    const totalAssetCount = dbStats?.count ?? 0;
    const totalStorageBytes = dbStats?.totalBytes ?? 0;

    // 2. Fetch all known filenames from database
    const dbAssets = db.prepare("SELECT filename FROM assets").all() as { filename: string }[];
    const dbFilenames = new Set(dbAssets.map((a) => a.filename));

    // 3. Real disk traversal in UPLOADS_DIR
    let diskBytes = 0;
    let diskFileCount = 0;
    let imageCount = 0;
    let orphanCount = 0;
    let orphanBytes = 0;
    const orphanFiles: string[] = [];

    if (fs.existsSync(UPLOADS_DIR)) {
      const files = fs.readdirSync(UPLOADS_DIR);
      for (const file of files) {
        const fullPath = path.join(UPLOADS_DIR, file);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isFile()) {
            diskFileCount++;
            diskBytes += stat.size;

            const ext = path.extname(file).toLowerCase();
            if (IMAGE_EXTENSIONS.has(ext)) {
              imageCount++;
            }

            if (!dbFilenames.has(file)) {
              orphanCount++;
              orphanBytes += stat.size;
              orphanFiles.push(file);
            }
          }
        } catch (statErr) {
          console.warn(`Failed to stat file ${fullPath}:`, statErr);
        }
      }
    }

    return res.json({
      success: true,
      totalAssetCount,
      totalCount: totalAssetCount,
      totalStorageBytes,
      totalBytes: totalStorageBytes,
      diskBytes,
      diskFileCount,
      imageCount,
      orphanCount,
      orphanBytes,
      orphanFiles,
    });
  } catch (err: any) {
    console.error("Error fetching admin asset stats:", err);
    return res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: err.message },
      message: err.message,
    });
  }
});

/**
 * GET /api/admin/assets
 * Lists assets across all users with pagination, search, user filtering,
 * mimeType filtering, and sorting.
 */
assetsAdminRouter.get("/", (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || "20", 10)));
    const offset = (page - 1) * limit;

    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const userId = typeof req.query.userId === "string" ? req.query.userId.trim() : "";
    const mimeType = typeof req.query.mimeType === "string" ? req.query.mimeType.trim() : "";

    // Sorting column validation
    const sortByParam = typeof req.query.sortBy === "string" ? req.query.sortBy.trim() : "created_at";
    let sortColumn = "created_at";
    if (sortByParam === "size_bytes" || sortByParam === "sizeBytes") {
      sortColumn = "size_bytes";
    } else if (sortByParam === "created_at" || sortByParam === "createdAt") {
      sortColumn = "created_at";
    }

    const sortOrderParam = typeof req.query.sortOrder === "string" && req.query.sortOrder.toUpperCase() === "ASC"
      ? "ASC"
      : "DESC";

    const conditions: string[] = [];
    const params: any[] = [];

    if (search) {
      conditions.push("(a.filename LIKE ? OR a.original_name LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }

    if (userId) {
      conditions.push("a.user_id = ?");
      params.push(userId);
    }

    if (mimeType) {
      if (mimeType.includes("/")) {
        conditions.push("a.mime_type = ?");
        params.push(mimeType);
      } else {
        conditions.push("a.mime_type LIKE ?");
        params.push(`%${mimeType}%`);
      }
    }

    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";

    // 1. Total matching count
    const countSql = `SELECT COUNT(*) as total FROM assets a${whereClause}`;
    const totalRow = db.prepare(countSql).get(...params) as { total: number } | undefined;
    const total = totalRow?.total ?? 0;

    // 2. Global total storage bytes across all assets in system
    const storageSql = "SELECT COALESCE(SUM(size_bytes), 0) as totalStorageBytes FROM assets";
    const storageRow = db.prepare(storageSql).get() as { totalStorageBytes: number } | undefined;
    const totalStorageBytes = storageRow?.totalStorageBytes ?? 0;

    // 3. Query paginated list joining users
    const querySql = `
      SELECT a.id, a.user_id, a.filename, a.original_name, a.mime_type, a.size_bytes,
             a.storage_path, a.created_at,
             u.username, u.display_name as user_display_name
      FROM assets a
      LEFT JOIN users u ON a.user_id = u.id
      ${whereClause}
      ORDER BY a.${sortColumn} ${sortOrderParam}
      LIMIT ? OFFSET ?
    `;

    const rows = db.prepare(querySql).all(...params, limit, offset) as any[];

    const assets = rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      username: r.username || "unknown",
      userDisplayName: r.user_display_name || r.username || null,
      displayName: r.user_display_name || r.username || null,
      filename: r.filename,
      originalName: r.original_name,
      mimeType: r.mime_type,
      sizeBytes: r.size_bytes,
      url: `/uploads/${r.filename}`,
      storagePath: r.storage_path,
      createdAt: r.created_at,
    }));

    return res.json({
      success: true,
      assets,
      total,
      page,
      limit,
      totalStorageBytes,
    });
  } catch (err: any) {
    console.error("Error listing admin assets:", err);
    return res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: err.message },
      message: err.message,
    });
  }
});

/**
 * POST /api/admin/assets/batch-delete
 * Transactionally deletes multiple asset records from SQLite and physically
 * unlinks all associated files from disk.
 */
assetsAdminRouter.post("/batch-delete", (req: Request, res: Response) => {
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
        error: { code: "INVALID_IDS", message: "No valid asset IDs provided" },
        message: "No valid asset IDs provided",
      });
    }

    const placeholders = validIds.map(() => "?").join(",");
    const assetsToDelete = db.prepare(`
      SELECT * FROM assets WHERE id IN (${placeholders})
    `).all(...validIds) as AssetRecord[];

    // Transactional deletion from SQLite
    const deleteTx = db.transaction(() => {
      db.prepare(`DELETE FROM assets WHERE id IN (${placeholders})`).run(...validIds);
    });
    deleteTx();

    // Physically unlink files on disk
    let freedBytes = 0;
    let unlinkedFiles = 0;

    for (const asset of assetsToDelete) {
      freedBytes += (asset.size_bytes || 0);
      const filePath = asset.storage_path || path.join(UPLOADS_DIR, asset.filename);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
          unlinkedFiles++;
        } catch (unlinkErr) {
          console.warn(`Failed to unlink asset file ${filePath}:`, unlinkErr);
        }
      }
    }

    return res.json({
      success: true,
      deletedCount: assetsToDelete.length,
      freedBytes,
      unlinkedFiles,
      message: `Successfully deleted ${assetsToDelete.length} asset(s)`,
    });
  } catch (err: any) {
    console.error("Error in batch asset deletion:", err);
    return res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: err.message },
      message: err.message,
    });
  }
});

/**
 * DELETE /api/admin/assets/:id
 * Physically deletes the file on disk and removes the asset record from SQLite.
 * Resilient against missing disk files so database records are reliably cleaned up.
 */
assetsAdminRouter.delete("/:id", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const asset = db.prepare("SELECT * FROM assets WHERE id = ?").get(id) as AssetRecord | undefined;

    if (!asset) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Asset not found" },
        message: "Asset not found",
      });
    }

    // Physical unlinking with resilient error handling
    const filePath = asset.storage_path || path.join(UPLOADS_DIR, asset.filename);
    let fileUnlinked = false;

    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        fileUnlinked = true;
      } catch (unlinkErr) {
        console.warn(`Failed to unlink asset file on disk (${filePath}):`, unlinkErr);
      }
    }

    // Delete record from SQLite
    db.prepare("DELETE FROM assets WHERE id = ?").run(id);

    return res.json({
      success: true,
      message: "Asset deleted successfully",
      freedBytes: asset.size_bytes,
      fileUnlinked,
    });
  } catch (err: any) {
    console.error("Error deleting asset:", err);
    return res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: err.message },
      message: err.message,
    });
  }
});
