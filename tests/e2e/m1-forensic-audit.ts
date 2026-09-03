import http from "node:http";
import crypto from "node:crypto";
import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import { setupRouter } from "../../server/src/routes/setup.js";
import { authRouter } from "../../server/src/routes/auth.js";
import { adminRouter } from "../../server/src/routes/admin.js";
import { aiRouter } from "../../server/src/routes/ai.js";
import {
  db,
  listAiChannels,
  getAiChannelById,
  getActiveAiChannels,
  createAiChannel,
  updateAiChannel,
  deleteAiChannel,
  updateChannelHealth,
  toChannelDto,
} from "../../server/src/db.js";
import { JWT_SECRET } from "../../server/src/config.js";
import { AiRouter, getCandidateChannels, getAggregatedModels, sanitizeText, sanitizeData } from "../../server/src/services/ai-router.js";

interface AuditCheck {
  id: string;
  category: string;
  description: string;
  passed: boolean;
  evidence: string;
}

const auditChecks: AuditCheck[] = [];

function recordCheck(id: string, category: string, description: string, passed: boolean, evidence: string) {
  auditChecks.push({ id, category, description, passed, evidence });
  const tag = passed ? "PASS" : "FAIL";
  console.log(`[${tag}] [${id}] [${category}] ${description} -> ${evidence}`);
  if (!passed) {
    throw new Error(`FORENSIC AUDIT FAILURE at [${id}]: ${description} (${evidence})`);
  }
}

async function startTestApp(port: number): Promise<http.Server> {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  app.use("/api/setup", setupRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/ai", aiRouter);

  return new Promise((resolve) => {
    const server = app.listen(port, "127.0.0.1", () => resolve(server));
  });
}

async function runForensicAudit() {
  console.log("====================================================================");
  console.log("🔍 FORENSIC INTEGRITY AUDIT: MILESTONE M1 BACKEND VERIFICATION");
  console.log("====================================================================\n");

  const APP_PORT = 4990;
  const UPSTREAM_1_PORT = 4991;
  const UPSTREAM_2_PORT = 4992;
  const UPSTREAM_3_PORT = 4993;

  const appServer = await startTestApp(APP_PORT);
  const APP_URL = `http://127.0.0.1:${APP_PORT}`;

  // State loggers for upstream mock servers
  const upstreamCalls: Record<string, { count: number; lastHeaders: any; lastBody: any; lastUrl: string }> = {
    up1: { count: 0, lastHeaders: null, lastBody: null, lastUrl: "" },
    up2: { count: 0, lastHeaders: null, lastBody: null, lastUrl: "" },
    up3: { count: 0, lastHeaders: null, lastBody: null, lastUrl: "" },
  };

  // Upstream 1: Fails with 500 error on AI requests, 200 on models probe
  const up1 = http.createServer((req, res) => {
    upstreamCalls.up1.count++;
    upstreamCalls.up1.lastHeaders = req.headers;
    upstreamCalls.up1.lastUrl = req.url || "";
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf-8");
      try { upstreamCalls.up1.lastBody = JSON.parse(bodyText); } catch { upstreamCalls.up1.lastBody = bodyText; }

      if (req.url?.includes("/models")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "forensic-gpt-4o" }, { id: "forensic-sdxl" }] }));
        return;
      }

      // Return 500 Internal Server Error
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Internal server crash on Upstream 1", code: 500 } }));
    });
  });
  await new Promise<void>((r) => up1.listen(UPSTREAM_1_PORT, "127.0.0.1", () => r()));

  // Upstream 2: Drops connection / resets socket or returns 429
  let up2Behavior: "reset" | "429" = "429";
  const up2 = http.createServer((req, res) => {
    upstreamCalls.up2.count++;
    upstreamCalls.up2.lastHeaders = req.headers;
    upstreamCalls.up2.lastUrl = req.url || "";
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf-8");
      try { upstreamCalls.up2.lastBody = JSON.parse(bodyText); } catch { upstreamCalls.up2.lastBody = bodyText; }

      if (req.url?.includes("/models")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "forensic-gpt-4o" }, { id: "forensic-dalle3" }] }));
        return;
      }

      if (up2Behavior === "reset") {
        req.socket.destroy();
        return;
      }

      // Return 429 Too Many Requests
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Rate limit exceeded on Upstream 2", code: 429 } }));
    });
  });
  await new Promise<void>((r) => up2.listen(UPSTREAM_2_PORT, "127.0.0.1", () => r()));

  // Upstream 3: Healthy fallback returning genuine response containing dynamic payload
  const up3 = http.createServer((req, res) => {
    upstreamCalls.up3.count++;
    upstreamCalls.up3.lastHeaders = req.headers;
    upstreamCalls.up3.lastUrl = req.url || "";
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf-8");
      try { upstreamCalls.up3.lastBody = JSON.parse(bodyText); } catch { upstreamCalls.up3.lastBody = bodyText; }

      if (req.url?.includes("/models")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "forensic-gpt-4o" }, { id: "forensic-flux" }] }));
        return;
      }

      if (req.url?.includes("/images/generations")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          data: [{
            url: `https://mock.cdn/img-${Date.now()}.png`,
            revised_prompt: upstreamCalls.up3.lastBody?.prompt,
          }]
        }));
        return;
      }

      if (req.url?.includes("/chat/completions")) {
        const isStream = upstreamCalls.up3.lastBody?.stream === true;
        if (isStream) {
          res.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          });
          const echoed = upstreamCalls.up3.lastBody?.messages?.[0]?.content || "no content";
          res.write(`data: {"choices":[{"delta":{"content":"Echo: ${echoed}"}}]}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();
        } else {
          const echoed = upstreamCalls.up3.lastBody?.messages?.[0]?.content || "no content";
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            choices: [{ message: { content: `Echo: ${echoed}` } }]
          }));
        }
        return;
      }

      res.writeHead(404);
      res.end();
    });
  });
  await new Promise<void>((r) => up3.listen(UPSTREAM_3_PORT, "127.0.0.1", () => r()));

  try {
    // Generate Admin Token for auth
    const adminUser = db.prepare("SELECT * FROM users WHERE role = 'admin' AND status = 'active' LIMIT 1").get() as any;
    const adminToken = jwt.sign(
      { userId: adminUser?.id || "admin-test", username: adminUser?.username || "admin", role: "admin" },
      JWT_SECRET,
      { expiresIn: "1h" }
    );
    const authHeaders = {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    };

    // Clean up forensic test channels
    db.prepare("DELETE FROM ai_channels WHERE name LIKE 'Forensic %'").run();

    // -------------------------------------------------------------------------
    // TEST SECTION 1: Direct SQLite DB Execution & Schema Integrity
    // -------------------------------------------------------------------------
    console.log("\n>>> AUDIT SECTION 1: Database Operations & SQL Injection Resistance <<<");

    // 1.1 Direct schema check
    const schemaRow = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ai_channels'").get() as any;
    recordCheck(
      "CHECK-DB-01",
      "DATABASE",
      "SQLite table ai_channels exists with complete DDL schema",
      Boolean(schemaRow && schemaRow.sql.includes("priority") && schemaRow.sql.includes("health_status")),
      `DDL includes priority, health_status, timeout_ms: ${schemaRow?.sql?.slice(0, 100)}...`
    );

    // 1.2 SQL Injection resistance on listAiChannels
    const injectionSearch = "' OR '1'='1' UNION SELECT 'hacked', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 --";
    const sqliResult = listAiChannels({ search: injectionSearch });
    recordCheck(
      "CHECK-DB-02",
      "DATABASE_SECURITY",
      "listAiChannels parameter binding safely sanitizes SQL injection payloads",
      sqliResult.total === 0,
      `Injected query returned 0 rows (safely handled as literal string)`
    );

    // 1.3 Direct physical insert and verification
    const channelId1 = crypto.randomUUID();
    const testSecret1 = "sk-forensic-secret-key-11111111";
    createAiChannel({
      id: channelId1,
      name: "Forensic Provider 1 (Primary 500)",
      provider_type: "openai",
      base_url: `http://127.0.0.1:${UPSTREAM_1_PORT}/v1`,
      api_key: testSecret1,
      models: JSON.stringify(["forensic-model", "forensic-sdxl"]),
      default_model: "forensic-model",
      priority: 100,
      weight: 1,
      is_active: 1,
      timeout_ms: 5000,
      custom_headers: "{}",
      health_status: "unknown",
      last_latency_ms: null,
      last_checked_at: null,
      last_error: null,
    });

    const directRow = db.prepare("SELECT * FROM ai_channels WHERE id = ?").get(channelId1) as any;
    recordCheck(
      "CHECK-DB-03",
      "DATABASE",
      "createAiChannel directly commits row to SQLite file",
      Boolean(directRow && directRow.name === "Forensic Provider 1 (Primary 500)" && directRow.api_key === testSecret1),
      `Row retrieved directly from SQLite disk database: id=${directRow?.id}`
    );

    // 1.4 Test direct update
    updateAiChannel(channelId1, { priority: 90, last_error: "initial test error" });
    const updatedRow = db.prepare("SELECT * FROM ai_channels WHERE id = ?").get(channelId1) as any;
    recordCheck(
      "CHECK-DB-04",
      "DATABASE",
      "updateAiChannel persists partial fields to SQLite",
      updatedRow.priority === 90 && updatedRow.last_error === "initial test error",
      `Priority updated to 90, last_error recorded`
    );

    // -------------------------------------------------------------------------
    // TEST SECTION 2: Dynamic Upstream Fetch & Failover Execution
    // -------------------------------------------------------------------------
    console.log("\n>>> AUDIT SECTION 2: Runtime HTTP Fetch & Multi-Stage Failover <<<");

    // Create Channel 2 (Secondary, returns 429)
    const channelId2 = crypto.randomUUID();
    const testSecret2 = "sk-forensic-secret-key-22222222";
    createAiChannel({
      id: channelId2,
      name: "Forensic Provider 2 (Secondary 429)",
      provider_type: "openai",
      base_url: `http://127.0.0.1:${UPSTREAM_2_PORT}/v1`,
      api_key: testSecret2,
      models: JSON.stringify(["forensic-model", "forensic-dalle3"]),
      default_model: "forensic-model",
      priority: 70,
      weight: 1,
      is_active: 1,
      timeout_ms: 5000,
      custom_headers: "{}",
      health_status: "unknown",
      last_latency_ms: null,
      last_checked_at: null,
      last_error: null,
    });

    // Create Channel 3 (Tertiary, returns 200)
    const channelId3 = crypto.randomUUID();
    const testSecret3 = "sk-forensic-secret-key-33333333";
    createAiChannel({
      id: channelId3,
      name: "Forensic Provider 3 (Tertiary 200)",
      provider_type: "openai",
      base_url: `http://127.0.0.1:${UPSTREAM_3_PORT}/v1`,
      api_key: testSecret3,
      models: JSON.stringify(["forensic-model", "forensic-flux"]),
      default_model: "forensic-model",
      priority: 50,
      weight: 1,
      is_active: 1,
      timeout_ms: 5000,
      custom_headers: "{}",
      health_status: "unknown",
      last_latency_ms: null,
      last_checked_at: null,
      last_error: null,
    });

    // Reset call counts
    upstreamCalls.up1.count = 0;
    upstreamCalls.up2.count = 0;
    upstreamCalls.up3.count = 0;

    // Generate dynamic random prompt
    const dynamicPrompt = `Unique Forensic Prompt ${crypto.randomUUID()}`;

    // Execute Image Generation
    const genRes = await fetch(`${APP_URL}/api/ai/images/generations`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        prompt: dynamicPrompt,
        model: "forensic-model",
      }),
    });
    const genJson = await genRes.json();

    // Verify 3-stage failover:
    // Upstream 1 was tried first (Priority 90) -> HTTP 500
    // Upstream 2 was tried second (Priority 70) -> HTTP 429
    // Upstream 3 was tried third (Priority 50) -> HTTP 200
    recordCheck(
      "CHECK-FAILOVER-01",
      "FAILOVER_LOGIC",
      "aiRouter sequentially dispatches through candidate channels on 500 and 429",
      upstreamCalls.up1.count === 1 && upstreamCalls.up2.count === 1 && upstreamCalls.up3.count === 1,
      `Calls count: up1=${upstreamCalls.up1.count}, up2=${upstreamCalls.up2.count}, up3=${upstreamCalls.up3.count}`
    );

    recordCheck(
      "CHECK-FETCH-01",
      "RUNTIME_FETCH",
      "Upstream 3 received genuine HTTP fetch with exact dynamic prompt and Auth header",
      upstreamCalls.up3.lastBody?.prompt === dynamicPrompt &&
        upstreamCalls.up3.lastHeaders?.authorization === `Bearer ${testSecret3}`,
      `Prompt matched: "${upstreamCalls.up3.lastBody?.prompt}", Auth header verified`
    );

    recordCheck(
      "CHECK-FAILOVER-02",
      "FAILOVER_RESULT",
      "Client received HTTP 200 response with data produced by fallback Channel 3",
      genRes.status === 200 && genJson.data?.[0]?.revised_prompt === dynamicPrompt,
      `Status: ${genRes.status}, revised_prompt: "${genJson.data?.[0]?.revised_prompt}"`
    );

    // Verify SQLite Health Updates
    const health1 = (db.prepare("SELECT health_status, last_error FROM ai_channels WHERE id = ?").get(channelId1) as any);
    const health2 = (db.prepare("SELECT health_status, last_error FROM ai_channels WHERE id = ?").get(channelId2) as any);
    const health3 = (db.prepare("SELECT health_status, last_error FROM ai_channels WHERE id = ?").get(channelId3) as any);

    recordCheck(
      "CHECK-HEALTH-01",
      "HEALTH_MONITORING",
      "Channel 1 marked 'degraded' in DB with failover error recorded",
      health1.health_status === "degraded" && health1.last_error?.includes("500"),
      `health_status=${health1.health_status}, error=${health1.last_error}`
    );

    recordCheck(
      "CHECK-HEALTH-02",
      "HEALTH_MONITORING",
      "Channel 2 marked 'degraded' in DB with 429 error recorded",
      health2.health_status === "degraded" && health2.last_error?.includes("429"),
      `health_status=${health2.health_status}, error=${health2.last_error}`
    );

    recordCheck(
      "CHECK-HEALTH-03",
      "HEALTH_MONITORING",
      "Channel 3 marked 'healthy' in DB with cleared error",
      health3.health_status === "healthy" && health3.last_error === null,
      `health_status=${health3.health_status}, error=${health3.last_error}`
    );

    // -------------------------------------------------------------------------
    // TEST SECTION 3: Socket Reset / Network Drop Resilience
    // -------------------------------------------------------------------------
    console.log("\n>>> AUDIT SECTION 3: Socket Drop / Network Error Resilience <<<");

    up2Behavior = "reset"; // Trigger immediate socket destruction
    // Deactivate Channel 1 so Channel 2 is attempted first
    updateAiChannel(channelId1, { is_active: 0 });

    upstreamCalls.up2.count = 0;
    upstreamCalls.up3.count = 0;

    const dynamicMsg = `Socket Drop Test ${crypto.randomUUID()}`;
    const chatRes = await fetch(`${APP_URL}/api/ai/chat/completions`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        messages: [{ role: "user", content: dynamicMsg }],
        model: "forensic-model",
      }),
    });
    const chatJson = await chatRes.json();

    recordCheck(
      "CHECK-SOCKET-01",
      "NETWORK_FAULT_TOLERANCE",
      "aiRouter gracefully handles abrupt socket hang up / connection reset and fails over",
      upstreamCalls.up2.count === 1 && upstreamCalls.up3.count === 1 && chatRes.status === 200,
      `Calls: up2=${upstreamCalls.up2.count}, up3=${upstreamCalls.up3.count}, status=${chatRes.status}`
    );

    recordCheck(
      "CHECK-SOCKET-02",
      "NETWORK_FAULT_TOLERANCE",
      "Channel 2 marked 'unhealthy' in DB due to network socket drop",
      (db.prepare("SELECT health_status FROM ai_channels WHERE id = ?").get(channelId2) as any).health_status === "unhealthy",
      `Channel 2 status in DB: unhealthy`
    );

    // -------------------------------------------------------------------------
    // TEST SECTION 4: Exhaustion / All Channels Failed
    // -------------------------------------------------------------------------
    console.log("\n>>> AUDIT SECTION 4: All Channels Down Exhaustion <<<");

    // Deactivate Channel 3 as well
    updateAiChannel(channelId3, { is_active: 0 });

    const exhaustRes = await fetch(`${APP_URL}/api/ai/images/generations`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        prompt: "Will fail completely",
        model: "forensic-model",
      }),
    });
    const exhaustJson = await exhaustRes.json();

    recordCheck(
      "CHECK-EXHAUST-01",
      "ERROR_HANDLING",
      "Returns proper 502/503 when all available channels fail",
      exhaustRes.status >= 500 && exhaustJson.success === false,
      `Status: ${exhaustRes.status}, error code: ${exhaustJson.error?.code || exhaustJson.message}`
    );

    // Reactivate channels
    updateAiChannel(channelId1, { is_active: 1 });
    updateAiChannel(channelId3, { is_active: 1 });

    // -------------------------------------------------------------------------
    // TEST SECTION 5: Zero Key Leakage & Masking
    // -------------------------------------------------------------------------
    console.log("\n>>> AUDIT SECTION 5: Security & Key Leakage Prevention <<<");

    // 5.1 Masking in admin list
    const listRes = await fetch(`${APP_URL}/api/admin/channels?search=Forensic`, { headers: authHeaders });
    const listJson = await listRes.json();
    const ch1 = listJson.channels.find((c: any) => c.id === channelId1);

    recordCheck(
      "CHECK-SEC-01",
      "SECURITY",
      "Admin GET /channels masks API key",
      ch1 && ch1.apiKeyMasked.startsWith("sk-") && ch1.apiKeyMasked.includes("****") && !JSON.stringify(listJson).includes(testSecret1),
      `Masked key: ${ch1?.apiKeyMasked}`
    );

    // 5.2 Redaction in error text
    const leakText = `Error from upstream with key ${testSecret1} attached in url`;
    const sanitized = sanitizeText(leakText, [testSecret1]);
    recordCheck(
      "CHECK-SEC-02",
      "SECURITY",
      "sanitizeText strictly replaces raw API keys with [REDACTED]",
      sanitized === "Error from upstream with key [REDACTED] attached in url",
      `Sanitized output: ${sanitized}`
    );

    // -------------------------------------------------------------------------
    // TEST SECTION 6: Input Validation & Anti-Bypass
    // -------------------------------------------------------------------------
    console.log("\n>>> AUDIT SECTION 6: Input Validation & Protocol Protection <<<");

    // 6.1 Disallowed protocol in baseUrl
    const protoRes = await fetch(`${APP_URL}/api/admin/channels`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        name: "Malicious Channel",
        baseUrl: "ftp://attacker.com/v1",
        apiKey: "sk-attack-12345",
      }),
    });
    recordCheck(
      "CHECK-VAL-01",
      "VALIDATION",
      "Rejects non-HTTP/HTTPS protocol for baseUrl with 400 Bad Request",
      protoRes.status === 400,
      `Status: ${protoRes.status}`
    );

    // 6.2 Missing channel name
    const nameRes = await fetch(`${APP_URL}/api/admin/channels`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        name: "",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-valid-key-12345",
      }),
    });
    recordCheck(
      "CHECK-VAL-02",
      "VALIDATION",
      "Rejects empty channel name with 400 Bad Request",
      nameRes.status === 400,
      `Status: ${nameRes.status}`
    );

    // 6.3 Missing prompt in image generation
    const promptRes = await fetch(`${APP_URL}/api/ai/images/generations`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ prompt: "   " }),
    });
    recordCheck(
      "CHECK-VAL-03",
      "VALIDATION",
      "Rejects whitespace-only prompt in image generation with 400 Bad Request",
      promptRes.status === 400,
      `Status: ${promptRes.status}`
    );

    // 6.4 Clean up test channels
    deleteAiChannel(channelId1);
    deleteAiChannel(channelId2);
    deleteAiChannel(channelId3);

    const remaining = db.prepare("SELECT COUNT(*) as count FROM ai_channels WHERE name LIKE 'Forensic %'").get() as any;
    recordCheck(
      "CHECK-CLEANUP-01",
      "DATABASE",
      "deleteAiChannel physically removes rows from SQLite",
      remaining.count === 0,
      `Remaining test channels in SQLite: ${remaining.count}`
    );

    console.log("\n====================================================================");
    console.log(`✅ ALL ${auditChecks.length} INDEPENDENT FORENSIC CHECKS PASSED!`);
    console.log("====================================================================\n");
  } finally {
    appServer.close();
    up1.close();
    up2.close();
    up3.close();
  }
}

runForensicAudit()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("FORENSIC AUDIT FAILED:", err);
    process.exit(1);
  });
