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
  type UserRecord,
  type AssetRecord,
  type ProjectRecord,
} from "../../server/src/db.js";
import { JWT_SECRET, UPLOADS_DIR } from "../../server/src/config.js";

interface AuditResult {
  category: string;
  check: string;
  passed: boolean;
  evidence: string;
}

const auditResults: AuditResult[] = [];

function verify(category: string, check: string, condition: boolean, evidence: string) {
  auditResults.push({ category, check, passed: condition, evidence });
  const status = condition ? "PASS" : "FAIL";
  console.log(`[${status}] [${category}] ${check}: ${evidence}`);
  if (!condition) {
    throw new Error(`FORENSIC AUDIT FAILURE: [${category}] ${check} - ${evidence}`);
  }
}

async function startServer(port: number): Promise<http.Server> {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  app.use("/api/setup", setupRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/admin", adminRouter);

  return new Promise((resolve) => {
    const s = app.listen(port, "127.0.0.1", () => resolve(s));
  });
}

async function runForensicAudit() {
  console.log("================================================================================");
  console.log("🔍 FORENSIC AUDITOR INDEPENDENT VERIFICATION & STRESS TEST (MILESTONE M2)");
  console.log("================================================================================\n");

  const AUDIT_PORT = 3989;
  const server = await startServer(AUDIT_PORT);
  const BASE_URL = `http://127.0.0.1:${AUDIT_PORT}`;

  try {
    // -------------------------------------------------------------------------
    // TEST SUITE 1: SQLite Schema, Indexes & Query Plan Inspection
    // -------------------------------------------------------------------------
    console.log(">>> CHECK 1: SQLite Indexes & Query Execution Plans");
    const indexes = db.prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index'").all() as any[];
    const idxMap = new Map(indexes.map((i: any) => [i.name, i]));

    verify("SCHEMA", "idx_assets_created_at index definition",
      idxMap.has("idx_assets_created_at") && idxMap.get("idx_assets_created_at").sql.includes("created_at DESC"),
      "Found idx_assets_created_at with DESC ordering"
    );

    verify("SCHEMA", "idx_assets_size_bytes index definition",
      idxMap.has("idx_assets_size_bytes") && idxMap.get("idx_assets_size_bytes").sql.includes("size_bytes DESC"),
      "Found idx_assets_size_bytes with DESC ordering"
    );

    verify("SCHEMA", "idx_projects_created_at index definition",
      idxMap.has("idx_projects_created_at") && idxMap.get("idx_projects_created_at").sql.includes("created_at DESC"),
      "Found idx_projects_created_at with DESC ordering"
    );

    // Verify SQLite Query Planner uses the indexes
    const assetPlanDesc = db.prepare("EXPLAIN QUERY PLAN SELECT * FROM assets ORDER BY created_at DESC").all() as any[];
    const usesCreatedIdx = assetPlanDesc.some((p: any) => p.detail && p.detail.includes("idx_assets_created_at"));
    verify("PERFORMANCE", "Query planner uses idx_assets_created_at",
      usesCreatedIdx,
      `Plan: ${assetPlanDesc.map((p) => p.detail).join("; ")}`
    );

    const assetPlanSize = db.prepare("EXPLAIN QUERY PLAN SELECT * FROM assets ORDER BY size_bytes DESC").all() as any[];
    const usesSizeIdx = assetPlanSize.some((p: any) => p.detail && p.detail.includes("idx_assets_size_bytes"));
    verify("PERFORMANCE", "Query planner uses idx_assets_size_bytes",
      usesSizeIdx,
      `Plan: ${assetPlanSize.map((p) => p.detail).join("; ")}`
    );

    // -------------------------------------------------------------------------
    // TEST SUITE 2: Authentication & Route Protection Boundaries
    // -------------------------------------------------------------------------
    console.log("\n>>> CHECK 2: RBAC & Token Security Boundaries");
    const now = new Date().toISOString();
    const adminUser: UserRecord = {
      id: "forensic-admin-" + Date.now(),
      username: "audit_admin_" + Date.now(),
      password_hash: "secret",
      display_name: "Audit Administrator",
      role: "admin",
      status: "active",
      created_at: now,
      updated_at: now,
    };
    const standardUser: UserRecord = {
      id: "forensic-user-" + Date.now(),
      username: "audit_user_" + Date.now(),
      password_hash: "secret",
      display_name: "Standard Auditor",
      role: "user",
      status: "active",
      created_at: now,
      updated_at: now,
    };

    db.prepare(`
      INSERT INTO users (id, username, password_hash, display_name, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(adminUser.id, adminUser.username, adminUser.password_hash, adminUser.display_name, adminUser.role, adminUser.status, now, now);

    db.prepare(`
      INSERT INTO users (id, username, password_hash, display_name, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(standardUser.id, standardUser.username, standardUser.password_hash, standardUser.display_name, standardUser.role, standardUser.status, now, now);

    const adminToken = jwt.sign(
      { userId: adminUser.id, sub: adminUser.id, username: adminUser.username, role: adminUser.role },
      JWT_SECRET,
      { expiresIn: "1h" }
    );
    const userToken = jwt.sign(
      { userId: standardUser.id, sub: standardUser.id, username: standardUser.username, role: standardUser.role },
      JWT_SECRET,
      { expiresIn: "1h" }
    );
    const expiredToken = jwt.sign(
      { userId: adminUser.id, sub: adminUser.id, username: adminUser.username, role: adminUser.role },
      JWT_SECRET,
      { expiresIn: "-10s" }
    );

    // Test Expired Token
    const expiredRes = await fetch(`${BASE_URL}/api/admin/assets`, {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    verify("SECURITY", "Expired token rejected with 401",
      expiredRes.status === 401,
      `Status: ${expiredRes.status}`
    );

    // Test Corrupt Token
    const corruptRes = await fetch(`${BASE_URL}/api/admin/assets`, {
      headers: { Authorization: `Bearer completely.bogus.jwt.payload` },
    });
    verify("SECURITY", "Corrupt token rejected with 401",
      corruptRes.status === 401,
      `Status: ${corruptRes.status}`
    );

    // Test Role Escalation (standard user -> admin route)
    const userForbiddenRes = await fetch(`${BASE_URL}/api/admin/assets`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    verify("SECURITY", "Standard user forbidden (403)",
      userForbiddenRes.status === 403,
      `Status: ${userForbiddenRes.status}`
    );

    // -------------------------------------------------------------------------
    // TEST SUITE 3: SQL Injection & Parameter Tampering Stress
    // -------------------------------------------------------------------------
    console.log("\n>>> CHECK 3: SQL Injection & Column Whitelist Immunity");

    const sqlAttacks = [
      "' OR 1=1 --",
      "'; DROP TABLE assets; --",
      "admin' UNION SELECT * FROM users --",
      "size_bytes; DROP TABLE projects;",
      "ASC; DELETE FROM assets;",
    ];

    for (const attack of sqlAttacks) {
      const res = await fetch(`${BASE_URL}/api/admin/assets?search=${encodeURIComponent(attack)}&sortBy=${encodeURIComponent(attack)}&sortOrder=${encodeURIComponent(attack)}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      verify("IMMUNITY", `SQL injection payload safely neutralized: ${attack.substring(0, 20)}`,
        res.status === 200,
        `Status ${res.status}`
      );
    }

    // Verify assets and projects tables were NOT dropped or harmed
    const assetTableCheck = db.prepare("SELECT COUNT(*) as count FROM assets").get() as any;
    verify("IMMUNITY", "Assets table intact after SQL injection stress",
      typeof assetTableCheck.count === "number",
      `Count: ${assetTableCheck.count}`
    );

    // -------------------------------------------------------------------------
    // TEST SUITE 4: Pagination & Boundary Clamping
    // -------------------------------------------------------------------------
    console.log("\n>>> CHECK 4: Pagination & Parameter Boundaries");

    const negativePageRes = await fetch(`${BASE_URL}/api/admin/assets?page=-5&limit=-10`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const negativeData = await negativePageRes.json() as any;
    verify("BOUNDARY", "Negative page/limit clamped to safe positive values (page >= 1, limit >= 1)",
      negativeData.page >= 1 && negativeData.limit >= 1,
      `page: ${negativeData.page}, limit: ${negativeData.limit}`
    );

    const excessiveLimitRes = await fetch(`${BASE_URL}/api/admin/assets?limit=99999`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const excessiveData = await excessiveLimitRes.json() as any;
    verify("BOUNDARY", "Excessive limit clamped to max 100",
      excessiveData.limit === 100,
      `limit: ${excessiveData.limit}`
    );

    // -------------------------------------------------------------------------
    // TEST SUITE 5: Physical Storage Sync, Traversal & Unlinking
    // -------------------------------------------------------------------------
    console.log("\n>>> CHECK 5: Physical Storage Traversal, Unlinking & Orphan Detection");

    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }

    const testAssetFile = `forensic_asset_${Date.now()}.png`;
    const testAssetPath = path.join(UPLOADS_DIR, testAssetFile);
    const testAssetSize = 13579;
    fs.writeFileSync(testAssetPath, Buffer.alloc(testAssetSize, "X"));

    const testAssetId = "forensic-asset-" + Date.now();
    db.prepare(`
      INSERT INTO assets (id, user_id, filename, original_name, mime_type, size_bytes, storage_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(testAssetId, adminUser.id, testAssetFile, "original_evidence.png", "image/png", testAssetSize, testAssetPath, now);

    // Verify stats accurately accounts for this file in DB and on disk
    const stats1Res = await fetch(`${BASE_URL}/api/admin/assets/stats`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const stats1 = await stats1Res.json() as any;
    verify("STORAGE", "Stats includes test asset in SQLite bytes",
      stats1.totalStorageBytes >= testAssetSize,
      `totalStorageBytes: ${stats1.totalStorageBytes}`
    );
    verify("STORAGE", "Stats includes test asset in physical disk bytes",
      stats1.diskBytes >= testAssetSize,
      `diskBytes: ${stats1.diskBytes}`
    );

    // Create an unrecorded orphan file
    const orphanFile = `forensic_orphan_${Date.now()}.jpg`;
    const orphanPath = path.join(UPLOADS_DIR, orphanFile);
    const orphanSize = 24680;
    fs.writeFileSync(orphanPath, Buffer.alloc(orphanSize, "Z"));

    const stats2Res = await fetch(`${BASE_URL}/api/admin/assets/stats`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const stats2 = await stats2Res.json() as any;
    verify("STORAGE", "Stats detects orphan file",
      stats2.orphanFiles.includes(orphanFile),
      `Found orphan: ${orphanFile} in ${stats2.orphanFiles.length} orphans`
    );

    // Remove orphan file
    fs.unlinkSync(orphanPath);

    // Delete single asset via API
    const delRes = await fetch(`${BASE_URL}/api/admin/assets/${testAssetId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const delData = await delRes.json() as any;
    verify("PHYSICAL_UNLINK", "DELETE asset returns 200 and reports freedBytes",
      delRes.status === 200 && delData.freedBytes === testAssetSize && delData.fileUnlinked === true,
      `freedBytes: ${delData.freedBytes}, fileUnlinked: ${delData.fileUnlinked}`
    );

    // Verify physical file is gone
    verify("PHYSICAL_UNLINK", "Physical file actually unlinked from disk",
      !fs.existsSync(testAssetPath),
      `fs.existsSync(${testAssetPath}) === false`
    );

    // Verify SQLite row deleted
    const dbRow = db.prepare("SELECT * FROM assets WHERE id = ?").get(testAssetId);
    verify("PHYSICAL_UNLINK", "Database row deleted from SQLite",
      dbRow === undefined,
      "dbRow is undefined"
    );

    // Resilient delete on already-missing file
    const ghostAssetId = "ghost-asset-" + Date.now();
    const ghostPath = path.join(UPLOADS_DIR, `non_existent_ghost_${Date.now()}.png`);
    db.prepare(`
      INSERT INTO assets (id, user_id, filename, original_name, mime_type, size_bytes, storage_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(ghostAssetId, adminUser.id, "ghost.png", "ghost.png", "image/png", 999, ghostPath, now);

    const ghostDelRes = await fetch(`${BASE_URL}/api/admin/assets/${ghostAssetId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const ghostDelData = await ghostDelRes.json() as any;
    verify("RESILIENCE", "Deletion of missing file succeeds with fileUnlinked=false",
      ghostDelRes.status === 200 && ghostDelData.fileUnlinked === false,
      `Status: ${ghostDelRes.status}, fileUnlinked: ${ghostDelData.fileUnlinked}`
    );
    const ghostDbCheck = db.prepare("SELECT * FROM assets WHERE id = ?").get(ghostAssetId);
    verify("RESILIENCE", "Ghost asset removed from DB without throwing",
      ghostDbCheck === undefined,
      "Ghost record removed"
    );

    // Batch deletion payload validation & execution
    const emptyBatchRes = await fetch(`${BASE_URL}/api/admin/assets/batch-delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ ids: ["   ", ""] }),
    });
    verify("VALIDATION", "Batch delete rejects whitespace-only IDs with 400",
      emptyBatchRes.status === 400,
      `Status: ${emptyBatchRes.status}`
    );

    // -------------------------------------------------------------------------
    // TEST SUITE 6: Project Management, Corrupt Canvas Reset & Bloat Protection
    // -------------------------------------------------------------------------
    console.log("\n>>> CHECK 6: Project Reset, Bloat Defense & Details Retrieval");

    const projId = "forensic-proj-" + Date.now();
    const brokenCanvas = "{ corrupt_json: [1, 2, ";
    db.prepare(`
      INSERT INTO projects (id, user_id, name, canvas_data, thumbnail, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(projId, standardUser.id, "Corrupted Forensic Canvas", brokenCanvas, null, now, now);

    // 1. Projects listing bloat check (ensure raw canvas_data is NOT in listing)
    const projListRes = await fetch(`${BASE_URL}/api/admin/projects`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const projListData = await projListRes.json() as any;
    const itemInList = projListData.projects.find((p: any) => p.id === projId);
    verify("OPTIMIZATION", "Projects list returns canvasDataSize without raw canvas_data",
      itemInList && itemInList.canvasDataSize === brokenCanvas.length && (itemInList as any).canvas_data === undefined,
      `canvasDataSize: ${itemInList?.canvasDataSize}`
    );

    // 2. Project details flags corruption accurately
    const detailRes = await fetch(`${BASE_URL}/api/admin/projects/${projId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const detailData = await detailRes.json() as any;
    verify("INTEGRITY", "Project details accurately flags isCorrupted = true",
      detailData.project && detailData.project.isCorrupted === true,
      `isCorrupted: ${detailData.project?.isCorrupted}`
    );

    // 3. Reset project canvas
    const resetRes = await fetch(`${BASE_URL}/api/admin/projects/${projId}/reset`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const resetData = await resetRes.json() as any;
    verify("RECOVERY", "Reset returns 200 and standard empty canvas structure",
      resetRes.status === 200 &&
      resetData.project &&
      resetData.project.canvasData.nodes.length === 0 &&
      resetData.project.canvasData.viewport.zoom === 1,
      `Reset nodes count: ${resetData.project?.canvasData.nodes.length}`
    );

    // Verify DB record is now clean valid JSON
    const dbProj = db.prepare("SELECT * FROM projects WHERE id = ?").get(projId) as ProjectRecord;
    const parsed = JSON.parse(dbProj.canvas_data);
    verify("RECOVERY", "Database canvas_data is valid JSON with nodes: []",
      Array.isArray(parsed.nodes) && parsed.nodes.length === 0,
      `Parsed nodes: ${parsed.nodes.length}`
    );
    verify("RECOVERY", "Ownership and name strictly preserved",
      dbProj.user_id === standardUser.id && dbProj.name === "Corrupted Forensic Canvas",
      `Owner: ${dbProj.user_id}, Name: ${dbProj.name}`
    );

    // 4. Delete project
    const delProjRes = await fetch(`${BASE_URL}/api/admin/projects/${projId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    verify("PROJECT_DELETE", "DELETE /api/admin/projects/:id returns 200",
      delProjRes.status === 200,
      `Status: ${delProjRes.status}`
    );
    const dbProjAfter = db.prepare("SELECT * FROM projects WHERE id = ?").get(projId);
    verify("PROJECT_DELETE", "Project record removed from SQLite",
      dbProjAfter === undefined,
      "dbProjAfter is undefined"
    );

    // Clean up test users
    db.prepare("DELETE FROM users WHERE id IN (?, ?)").run(adminUser.id, standardUser.id);

    console.log("\n================================================================================");
    console.log(`🏆 ALL ${auditResults.length} INDEPENDENT FORENSIC VERIFICATION CHECKS PASSED!`);
    console.log("================================================================================\n");

  } finally {
    server.close();
  }
}

runForensicAudit().catch((err) => {
  console.error("\n❌ FORENSIC AUDIT ENCOUNTERED FATAL FAILURE:\n", err);
  process.exit(1);
});
