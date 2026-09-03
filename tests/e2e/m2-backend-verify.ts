import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import { setupRouter } from "../../server/src/routes/setup.js";
import { authRouter } from "../../server/src/routes/auth.js";
import { adminRouter } from "../../server/src/routes/admin.js";
import {
  db,
  initSchema,
  type UserRecord,
  type AssetRecord,
  type ProjectRecord,
} from "../../server/src/db.js";
import { JWT_SECRET, UPLOADS_DIR } from "../../server/src/config.js";

interface TestResult {
  suite: string;
  name: string;
  passed: boolean;
  details: string;
}

const testResults: TestResult[] = [];

function assert(suite: string, name: string, condition: boolean, details: string) {
  testResults.push({ suite, name, passed: condition, details });
  const icon = condition ? "✅ PASS" : "❌ FAIL";
  console.log(`${icon} [${suite}] ${name} - ${details}`);
  if (!condition) {
    throw new Error(`Assertion failed: [${suite}] ${name} - ${details}`);
  }
}

// Start test backend server
async function startTestServer(port: number): Promise<http.Server> {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  app.use("/api/setup", setupRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/admin", adminRouter);

  return new Promise((resolve) => {
    const server = app.listen(port, "127.0.0.1", () => resolve(server));
  });
}

async function runM2Verification() {
  console.log("================================================================");
  console.log("🚀 STARTING M2 ASSET & PROJECT BACKEND VERIFICATION");
  console.log("================================================================\n");

  const TEST_SERVER_PORT = 3988;
  const server = await startTestServer(TEST_SERVER_PORT);
  const BASE_URL = `http://127.0.0.1:${TEST_SERVER_PORT}`;

  try {
    // -------------------------------------------------------------------------
    // SECTION 1: Database Schema & Indexes Verification
    // -------------------------------------------------------------------------
    console.log("\n>>> SECTION 1: Database Schema & Indexes Verification <<<");

    const indexes = db.prepare(`
      SELECT name, tbl_name FROM sqlite_master WHERE type = 'index'
    `).all() as { name: string; tbl_name: string }[];

    const indexNames = new Set(indexes.map((i) => i.name));

    assert("SCHEMA", "idx_assets_created_at exists",
      indexNames.has("idx_assets_created_at"),
      "Index idx_assets_created_at found in sqlite_master"
    );

    assert("SCHEMA", "idx_assets_size_bytes exists",
      indexNames.has("idx_assets_size_bytes"),
      "Index idx_assets_size_bytes found in sqlite_master"
    );

    assert("SCHEMA", "idx_projects_created_at exists",
      indexNames.has("idx_projects_created_at"),
      "Index idx_projects_created_at found in sqlite_master"
    );

    assert("SCHEMA", "idx_projects_user_id exists",
      indexNames.has("idx_projects_user_id"),
      "Index idx_projects_user_id found in sqlite_master"
    );

    // -------------------------------------------------------------------------
    // SECTION 2: Auth & Security Route Guards Verification
    // -------------------------------------------------------------------------
    console.log("\n>>> SECTION 2: Auth & Security Route Guards Verification <<<");

    // Create test admin and normal user in SQLite
    const now = new Date().toISOString();
    const adminId = "test-admin-m2-" + Date.now();
    const normalUserId = "test-user-m2-" + Date.now();
    const secondaryUserId = "test-user2-m2-" + Date.now();

    db.prepare(`
      INSERT INTO users (id, username, password_hash, display_name, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(adminId, `admin_m2_${Date.now()}`, "hash", "Admin M2", "admin", "active", now, now);

    db.prepare(`
      INSERT INTO users (id, username, password_hash, display_name, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(normalUserId, `user_m2_${Date.now()}`, "hash", "Alice M2", "user", "active", now, now);

    db.prepare(`
      INSERT INTO users (id, username, password_hash, display_name, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(secondaryUserId, `user2_m2_${Date.now()}`, "hash", "Bob M2", "user", "active", now, now);

    const adminUser = db.prepare("SELECT * FROM users WHERE id = ?").get(adminId) as UserRecord;
    const normalUser = db.prepare("SELECT * FROM users WHERE id = ?").get(normalUserId) as UserRecord;
    const secondaryUser = db.prepare("SELECT * FROM users WHERE id = ?").get(secondaryUserId) as UserRecord;

    const adminToken = jwt.sign(
      { userId: adminUser.id, sub: adminUser.id, username: adminUser.username, role: adminUser.role },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    const normalUserToken = jwt.sign(
      { userId: normalUser.id, sub: normalUser.id, username: normalUser.username, role: normalUser.role },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    // Unauthenticated requests should be 401
    const unauthAssetsRes = await fetch(`${BASE_URL}/api/admin/assets`);
    assert("SECURITY", "Unauthenticated GET /api/admin/assets returns 401",
      unauthAssetsRes.status === 401,
      `Status: ${unauthAssetsRes.status}`
    );

    const unauthProjectsRes = await fetch(`${BASE_URL}/api/admin/projects`);
    assert("SECURITY", "Unauthenticated GET /api/admin/projects returns 401",
      unauthProjectsRes.status === 401,
      `Status: ${unauthProjectsRes.status}`
    );

    // Non-admin token should be 403
    const forbiddenAssetsRes = await fetch(`${BASE_URL}/api/admin/assets`, {
      headers: { Authorization: `Bearer ${normalUserToken}` },
    });
    assert("SECURITY", "Non-admin GET /api/admin/assets returns 403 Forbidden",
      forbiddenAssetsRes.status === 403,
      `Status: ${forbiddenAssetsRes.status}`
    );

    const forbiddenProjectsRes = await fetch(`${BASE_URL}/api/admin/projects`, {
      headers: { Authorization: `Bearer ${normalUserToken}` },
    });
    assert("SECURITY", "Non-admin GET /api/admin/projects returns 403 Forbidden",
      forbiddenProjectsRes.status === 403,
      `Status: ${forbiddenProjectsRes.status}`
    );

    // -------------------------------------------------------------------------
    // SECTION 3: Admin Asset Listing, Filtering & Sorting
    // -------------------------------------------------------------------------
    console.log("\n>>> SECTION 3: Admin Asset Listing, Filtering & Sorting <<<");

    // Ensure uploads directory exists
    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }

    // Seed test asset files on disk and records in SQLite
    const asset1Id = "asset-m2-1-" + Date.now();
    const asset1File = `m2_test_sketch_${Date.now()}.png`;
    const asset1Path = path.join(UPLOADS_DIR, asset1File);
    fs.writeFileSync(asset1Path, Buffer.alloc(10000, "a"));

    const asset2Id = "asset-m2-2-" + Date.now();
    const asset2File = `m2_test_photo_${Date.now()}.jpg`;
    const asset2Path = path.join(UPLOADS_DIR, asset2File);
    fs.writeFileSync(asset2Path, Buffer.alloc(50000, "b"));

    const asset3Id = "asset-m2-3-" + Date.now();
    const asset3File = `m2_test_diagram_${Date.now()}.webp`;
    const asset3Path = path.join(UPLOADS_DIR, asset3File);
    fs.writeFileSync(asset3Path, Buffer.alloc(20000, "c"));

    const asset4Id = "asset-m2-4-" + Date.now();
    const asset4File = `m2_test_huge_${Date.now()}.png`;
    const asset4Path = path.join(UPLOADS_DIR, asset4File);
    fs.writeFileSync(asset4Path, Buffer.alloc(200000, "d"));

    // Insert into assets table
    db.prepare(`
      INSERT INTO assets (id, user_id, filename, original_name, mime_type, size_bytes, storage_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(asset1Id, normalUser.id, asset1File, "sketch_design.png", "image/png", 10000, asset1Path, "2026-09-01T10:00:00Z");

    db.prepare(`
      INSERT INTO assets (id, user_id, filename, original_name, mime_type, size_bytes, storage_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(asset2Id, normalUser.id, asset2File, "real_photo.jpg", "image/jpeg", 50000, asset2Path, "2026-09-02T10:00:00Z");

    db.prepare(`
      INSERT INTO assets (id, user_id, filename, original_name, mime_type, size_bytes, storage_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(asset3Id, secondaryUser.id, asset3File, "diagram_arch.webp", "image/webp", 20000, asset3Path, "2026-09-03T10:00:00Z");

    db.prepare(`
      INSERT INTO assets (id, user_id, filename, original_name, mime_type, size_bytes, storage_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(asset4Id, secondaryUser.id, asset4File, "huge_poster.png", "image/png", 200000, asset4Path, "2026-09-04T10:00:00Z");

    // 1. Full list
    const listRes = await fetch(`${BASE_URL}/api/admin/assets`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert("ASSET_LIST", "GET /api/admin/assets returns 200",
      listRes.status === 200,
      `Status: ${listRes.status}`
    );
    const listData = await listRes.json() as any;
    assert("ASSET_LIST", "Assets response has success and array",
      listData.success === true && Array.isArray(listData.assets) && listData.total >= 4,
      `Total: ${listData.total}`
    );
    assert("ASSET_LIST", "Assets response includes aggregated totalStorageBytes",
      typeof listData.totalStorageBytes === "number" && listData.totalStorageBytes >= 280000,
      `totalStorageBytes: ${listData.totalStorageBytes}`
    );

    // Verify owner username and userDisplayName joined
    const foundAsset1 = listData.assets.find((a: any) => a.id === asset1Id);
    assert("ASSET_LIST", "Asset joins owner username and userDisplayName",
      foundAsset1 && foundAsset1.username === normalUser.username && foundAsset1.userDisplayName === normalUser.display_name,
      `Username: ${foundAsset1?.username}, DisplayName: ${foundAsset1?.userDisplayName}`
    );

    // 2. Filter by userId
    const userFilteredRes = await fetch(`${BASE_URL}/api/admin/assets?userId=${normalUser.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const userFilteredData = await userFilteredRes.json() as any;
    const allBelongToUser1 = userFilteredData.assets.every((a: any) => a.userId === normalUser.id);
    assert("ASSET_FILTER", "Filter by userId returns only user's assets",
      allBelongToUser1 && userFilteredData.assets.length >= 2,
      `Count: ${userFilteredData.assets.length}`
    );

    // 3. Search by filename or original_name
    const searchRes = await fetch(`${BASE_URL}/api/admin/assets?search=sketch_design`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const searchData = await searchRes.json() as any;
    assert("ASSET_SEARCH", "Search by original_name finds asset",
      searchData.assets.length === 1 && searchData.assets[0].id === asset1Id,
      `Found: ${searchData.assets[0]?.originalName}`
    );

    const searchFilenameRes = await fetch(`${BASE_URL}/api/admin/assets?search=${asset3File}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const searchFilenameData = await searchFilenameRes.json() as any;
    assert("ASSET_SEARCH", "Search by filename finds asset",
      searchFilenameData.assets.length === 1 && searchFilenameData.assets[0].id === asset3Id,
      `Found: ${searchFilenameData.assets[0]?.filename}`
    );

    // 4. Filter by mimeType
    const mimeRes = await fetch(`${BASE_URL}/api/admin/assets?mimeType=image/jpeg`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const mimeData = await mimeRes.json() as any;
    const allJpeg = mimeData.assets.every((a: any) => a.mimeType === "image/jpeg");
    assert("ASSET_FILTER", "Filter by mimeType returns only matching MIME assets",
      allJpeg && mimeData.assets.some((a: any) => a.id === asset2Id),
      `Count: ${mimeData.assets.length}`
    );

    // 5. Sort by size_bytes desc
    const sortDescRes = await fetch(`${BASE_URL}/api/admin/assets?sortBy=size_bytes&sortOrder=desc&limit=100`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const sortDescData = await sortDescRes.json() as any;
    const sizes = sortDescData.assets.map((a: any) => a.sizeBytes);
    let isSortedDesc = true;
    for (let i = 1; i < sizes.length; i++) {
      if (sizes[i] > sizes[i - 1]) isSortedDesc = false;
    }
    assert("ASSET_SORT", "Sort by size_bytes DESC correctly orders items",
      isSortedDesc && sizes[0] >= 200000,
      `Max size: ${sizes[0]}`
    );

    // 6. Sort by size_bytes asc
    const sortAscRes = await fetch(`${BASE_URL}/api/admin/assets?sortBy=size_bytes&sortOrder=asc&limit=100`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const sortAscData = await sortAscRes.json() as any;
    const sizesAsc = sortAscData.assets.map((a: any) => a.sizeBytes);
    let isSortedAsc = true;
    for (let i = 1; i < sizesAsc.length; i++) {
      if (sizesAsc[i] < sizesAsc[i - 1]) isSortedAsc = false;
    }
    assert("ASSET_SORT", "Sort by size_bytes ASC correctly orders items",
      isSortedAsc,
      `Min size: ${sizesAsc[0]}`
    );

    // 7. Pagination
    const page1Res = await fetch(`${BASE_URL}/api/admin/assets?page=1&limit=2`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const page1Data = await page1Res.json() as any;
    assert("ASSET_PAGINATION", "Page 1 returns limit items",
      page1Data.assets.length === 2 && page1Data.page === 1 && page1Data.limit === 2,
      `Returned: ${page1Data.assets.length}`
    );

    // -------------------------------------------------------------------------
    // SECTION 4: Real Disk Traversal & Storage Stats
    // -------------------------------------------------------------------------
    console.log("\n>>> SECTION 4: Real Disk Traversal & Storage Stats <<<");

    // Create an orphan file on disk with NO database record
    const orphanFilename = `orphan_test_${Date.now()}.png`;
    const orphanPath = path.join(UPLOADS_DIR, orphanFilename);
    fs.writeFileSync(orphanPath, Buffer.alloc(12345, "x"));

    const statsRes = await fetch(`${BASE_URL}/api/admin/assets/stats`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert("STATS", "GET /api/admin/assets/stats returns 200",
      statsRes.status === 200,
      `Status: ${statsRes.status}`
    );
    const statsData = await statsRes.json() as any;

    assert("STATS", "Stats returns SQLite totalAssetCount and totalStorageBytes",
      typeof statsData.totalAssetCount === "number" && statsData.totalAssetCount >= 4 &&
      typeof statsData.totalStorageBytes === "number" && statsData.totalStorageBytes >= 280000,
      `Count: ${statsData.totalAssetCount}, Bytes: ${statsData.totalStorageBytes}`
    );

    assert("STATS", "Stats performs real disk traversal detecting diskBytes and diskFileCount",
      statsData.diskFileCount >= 5 && statsData.diskBytes >= 292345,
      `diskFiles: ${statsData.diskFileCount}, diskBytes: ${statsData.diskBytes}`
    );

    assert("STATS", "Stats detects orphan file on disk",
      statsData.orphanCount >= 1 &&
      statsData.orphanBytes >= 12345 &&
      Array.isArray(statsData.orphanFiles) &&
      statsData.orphanFiles.includes(orphanFilename),
      `Orphans: ${statsData.orphanCount}, Files: ${statsData.orphanFiles.join(", ")}`
    );

    // Clean up test orphan file
    if (fs.existsSync(orphanPath)) {
      fs.unlinkSync(orphanPath);
    }

    // -------------------------------------------------------------------------
    // SECTION 5: Single Physical Asset Deletion (with Resilience)
    // -------------------------------------------------------------------------
    console.log("\n>>> SECTION 5: Single Physical Asset Deletion <<<");

    // 1. Delete asset 1 (file exists on disk)
    assert("DELETE", "Asset 1 file exists on disk before delete",
      fs.existsSync(asset1Path),
      `Path: ${asset1Path}`
    );

    const delete1Res = await fetch(`${BASE_URL}/api/admin/assets/${asset1Id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert("DELETE", "DELETE /api/admin/assets/:id returns 200",
      delete1Res.status === 200,
      `Status: ${delete1Res.status}`
    );
    const delete1Data = await delete1Res.json() as any;
    assert("DELETE", "DELETE response reports success and freedBytes",
      delete1Data.success === true && delete1Data.freedBytes === 10000,
      `Freed: ${delete1Data.freedBytes}`
    );

    // Verify removed from SQLite
    const checkDb1 = db.prepare("SELECT id FROM assets WHERE id = ?").get(asset1Id);
    assert("DELETE", "Asset 1 record deleted from SQLite",
      checkDb1 === undefined,
      "Record gone from DB"
    );

    // Verify physical file unlinked
    assert("DELETE", "Asset 1 physical file unlinked from disk",
      !fs.existsSync(asset1Path),
      "File no longer exists on disk"
    );

    // 2. Resilient deletion: missing file does not crash DB deletion
    const missingAssetId = "asset-missing-" + Date.now();
    const missingFilePath = path.join(UPLOADS_DIR, `non_existent_${Date.now()}.png`);
    db.prepare(`
      INSERT INTO assets (id, user_id, filename, original_name, mime_type, size_bytes, storage_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(missingAssetId, normalUser.id, "non_existent.png", "missing.png", "image/png", 500, missingFilePath, now);

    const resilientDeleteRes = await fetch(`${BASE_URL}/api/admin/assets/${missingAssetId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert("RESILIENCE", "Deletion of asset with missing disk file returns 200 OK",
      resilientDeleteRes.status === 200,
      `Status: ${resilientDeleteRes.status}`
    );
    const checkMissingDb = db.prepare("SELECT id FROM assets WHERE id = ?").get(missingAssetId);
    assert("RESILIENCE", "Asset with missing file successfully removed from DB",
      checkMissingDb === undefined,
      "Record removed without throwing"
    );

    // -------------------------------------------------------------------------
    // SECTION 6: Batch Asset Deletion
    // -------------------------------------------------------------------------
    console.log("\n>>> SECTION 6: Batch Asset Deletion <<<");

    assert("BATCH_DELETE", "Asset 2 and 3 files exist on disk before batch delete",
      fs.existsSync(asset2Path) && fs.existsSync(asset3Path),
      "Both files exist"
    );

    // Invalid payload checks
    const badBatchRes = await fetch(`${BASE_URL}/api/admin/assets/batch-delete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ ids: [] }),
    });
    assert("BATCH_DELETE", "Empty ids array returns 400 Bad Request",
      badBatchRes.status === 400,
      `Status: ${badBatchRes.status}`
    );

    // Batch delete Asset 2 and 3
    const batchRes = await fetch(`${BASE_URL}/api/admin/assets/batch-delete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ ids: [asset2Id, asset3Id] }),
    });
    assert("BATCH_DELETE", "POST /api/admin/assets/batch-delete returns 200",
      batchRes.status === 200,
      `Status: ${batchRes.status}`
    );
    const batchData = await batchRes.json() as any;
    assert("BATCH_DELETE", "Batch delete returns deletedCount and freedBytes",
      batchData.success === true && batchData.deletedCount === 2 && batchData.freedBytes === 70000,
      `DeletedCount: ${batchData.deletedCount}, Freed: ${batchData.freedBytes}`
    );

    // Verify removed from SQLite
    const checkBatchDb = db.prepare(`SELECT COUNT(*) as c FROM assets WHERE id IN (?, ?)`).get(asset2Id, asset3Id) as { c: number };
    assert("BATCH_DELETE", "Both records removed from SQLite",
      checkBatchDb.c === 0,
      `Count in DB: ${checkBatchDb.c}`
    );

    // Verify physical files unlinked
    assert("BATCH_DELETE", "Both physical files unlinked from disk",
      !fs.existsSync(asset2Path) && !fs.existsSync(asset3Path),
      "Files unlinked from disk"
    );

    // -------------------------------------------------------------------------
    // SECTION 7: Admin Project Listing & Filtering
    // -------------------------------------------------------------------------
    console.log("\n>>> SECTION 7: Admin Project Listing & Filtering <<<");

    const proj1Id = "proj-m2-1-" + Date.now();
    const proj2Id = "proj-m2-2-" + Date.now();
    const proj3Id = "proj-m2-3-" + Date.now();

    const normalCanvasData = JSON.stringify({
      nodes: [{ id: "n1", type: "image", position: { x: 100, y: 100 } }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    });

    const largeCanvasData = JSON.stringify({
      nodes: Array.from({ length: 50 }, (_, i) => ({ id: `node-${i}`, type: "card" })),
      edges: [],
      viewport: { x: 10, y: 20, zoom: 0.8 },
    });

    const corruptCanvasData = "{ corrupt_json_structure: missing_closing_bracket";

    db.prepare(`
      INSERT INTO projects (id, user_id, name, canvas_data, thumbnail, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(proj1Id, normalUser.id, "Alpha Board Project", normalCanvasData, "thumb1.png", "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z");

    db.prepare(`
      INSERT INTO projects (id, user_id, name, canvas_data, thumbnail, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(proj2Id, normalUser.id, "Beta Diagram Board", largeCanvasData, "thumb2.png", "2026-09-02T00:00:00Z", "2026-09-02T00:00:00Z");

    db.prepare(`
      INSERT INTO projects (id, user_id, name, canvas_data, thumbnail, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(proj3Id, secondaryUser.id, "Gamma Corrupt Wireframe", corruptCanvasData, null, "2026-09-03T00:00:00Z", "2026-09-03T00:00:00Z");

    // 1. List projects
    const projListRes = await fetch(`${BASE_URL}/api/admin/projects`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert("PROJECT_LIST", "GET /api/admin/projects returns 200",
      projListRes.status === 200,
      `Status: ${projListRes.status}`
    );
    const projListData = await projListRes.json() as any;
    assert("PROJECT_LIST", "Projects array returned with total >= 3",
      projListData.success === true && Array.isArray(projListData.projects) && projListData.total >= 3,
      `Total: ${projListData.total}`
    );

    // Verify owner details and canvasDataSize
    const foundProj1 = projListData.projects.find((p: any) => p.id === proj1Id);
    assert("PROJECT_LIST", "Project includes owner username, userDisplayName, and canvasDataSize",
      foundProj1 &&
      foundProj1.username === normalUser.username &&
      foundProj1.userDisplayName === normalUser.display_name &&
      typeof foundProj1.canvasDataSize === "number" &&
      foundProj1.canvasDataSize === normalCanvasData.length,
      `Size: ${foundProj1?.canvasDataSize}, Owner: ${foundProj1?.username}`
    );

    // 2. Search by project name
    const searchProjRes = await fetch(`${BASE_URL}/api/admin/projects?search=Alpha`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const searchProjData = await searchProjRes.json() as any;
    assert("PROJECT_SEARCH", "Search by name finds matching project",
      searchProjData.projects.length === 1 && searchProjData.projects[0].id === proj1Id,
      `Found: ${searchProjData.projects[0]?.name}`
    );

    // 3. Filter by userId
    const userProjRes = await fetch(`${BASE_URL}/api/admin/projects?userId=${secondaryUser.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const userProjData = await userProjRes.json() as any;
    assert("PROJECT_FILTER", "Filter by userId returns only secondary user's projects",
      userProjData.projects.length === 1 && userProjData.projects[0].id === proj3Id,
      `Found: ${userProjData.projects[0]?.name}`
    );

    // -------------------------------------------------------------------------
    // SECTION 8: Corrupted Project Canvas Reset
    // -------------------------------------------------------------------------
    console.log("\n>>> SECTION 8: Corrupted Project Canvas Reset <<<");

    // Project 3 has corrupt canvas data in DB
    const corruptRowBefore = db.prepare("SELECT canvas_data FROM projects WHERE id = ?").get(proj3Id) as ProjectRecord;
    assert("RESET", "Project 3 canvas_data is corrupt before reset",
      corruptRowBefore.canvas_data === corruptCanvasData,
      "Canvas data is invalid JSON"
    );

    const resetRes = await fetch(`${BASE_URL}/api/admin/projects/${proj3Id}/reset`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert("RESET", "POST /api/admin/projects/:id/reset returns 200",
      resetRes.status === 200,
      `Status: ${resetRes.status}`
    );
    const resetData = await resetRes.json() as any;
    assert("RESET", "Reset response has success and message",
      resetData.success === true && typeof resetData.message === "string",
      `Message: ${resetData.message}`
    );

    // Verify canvasData in response is valid clean empty canvas
    assert("RESET", "Reset project returns clean canvas data structure",
      resetData.project &&
      Array.isArray(resetData.project.canvasData.nodes) &&
      resetData.project.canvasData.nodes.length === 0 &&
      Array.isArray(resetData.project.canvasData.edges) &&
      resetData.project.canvasData.edges.length === 0 &&
      resetData.project.canvasData.viewport.zoom === 1,
      "Valid empty canvas structure"
    );

    // Verify ownership and name preserved
    assert("RESET", "Project ownership and name preserved after reset",
      resetData.project.userId === secondaryUser.id &&
      resetData.project.name === "Gamma Corrupt Wireframe",
      `Owner: ${resetData.project.userId}, Name: ${resetData.project.name}`
    );

    // Verify SQLite record updated to valid JSON
    const checkDbAfter = db.prepare("SELECT canvas_data, updated_at FROM projects WHERE id = ?").get(proj3Id) as ProjectRecord;
    let parsedDbCanvas: any = null;
    let parseOk = false;
    try {
      parsedDbCanvas = JSON.parse(checkDbAfter.canvas_data);
      parseOk = true;
    } catch {}
    assert("RESET", "SQLite canvas_data is now valid parseable JSON",
      parseOk && parsedDbCanvas.nodes.length === 0,
      "Valid JSON in database"
    );

    // -------------------------------------------------------------------------
    // SECTION 9: Admin Project Deletion (Single & Batch)
    // -------------------------------------------------------------------------
    console.log("\n>>> SECTION 9: Admin Project Deletion <<<");

    // 1. Single delete
    const deleteProjRes = await fetch(`${BASE_URL}/api/admin/projects/${proj1Id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert("PROJECT_DELETE", "DELETE /api/admin/projects/:id returns 200",
      deleteProjRes.status === 200,
      `Status: ${deleteProjRes.status}`
    );
    const checkProjDb = db.prepare("SELECT id FROM projects WHERE id = ?").get(proj1Id);
    assert("PROJECT_DELETE", "Project 1 deleted from SQLite",
      checkProjDb === undefined,
      "Project record removed"
    );

    // 2. Batch delete
    const batchProjRes = await fetch(`${BASE_URL}/api/admin/projects/batch-delete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ ids: [proj2Id, proj3Id] }),
    });
    assert("PROJECT_BATCH", "POST /api/admin/projects/batch-delete returns 200",
      batchProjRes.status === 200,
      `Status: ${batchProjRes.status}`
    );
    const batchProjData = await batchProjRes.json() as any;
    assert("PROJECT_BATCH", "Batch delete returns deletedCount",
      batchProjData.success === true && batchProjData.deletedCount === 2,
      `Deleted: ${batchProjData.deletedCount}`
    );
    const checkBatchProjDb = db.prepare("SELECT COUNT(*) as c FROM projects WHERE id IN (?, ?)").get(proj2Id, proj3Id) as { c: number };
    assert("PROJECT_BATCH", "Projects 2 and 3 removed from SQLite",
      checkBatchProjDb.c === 0,
      `Count in DB: ${checkBatchProjDb.c}`
    );

    // Clean up test asset 4 from disk
    if (fs.existsSync(asset4Path)) {
      fs.unlinkSync(asset4Path);
    }
    db.prepare("DELETE FROM assets WHERE id = ?").run(asset4Id);

    // Clean up test users
    db.prepare("DELETE FROM users WHERE id IN (?, ?, ?)").run(adminId, normalUserId, secondaryUserId);

    console.log("\n================================================================");
    console.log(`🎉 ALL ${testResults.length} VERIFICATION ASSERTIONS PASSED!`);
    console.log("================================================================\n");

  } finally {
    server.close();
  }
}

runM2Verification().catch((err) => {
  console.error("\n❌ VERIFICATION SUITE FAILED WITH ERROR:\n", err);
  process.exit(1);
});
