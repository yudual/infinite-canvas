import http from "node:http";
import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import { setupRouter } from "../../server/src/routes/setup.js";
import { authRouter } from "../../server/src/routes/auth.js";
import { adminRouter } from "../../server/src/routes/admin.js";
import { aiRouter } from "../../server/src/routes/ai.js";
import {
  db,
  initSchema,
  createAiChannel,
  deleteAiChannel,
  getAiAuditLogById,
  type UserRecord,
} from "../../server/src/db.js";
import { JWT_SECRET } from "../../server/src/config.js";
import { AiAuditService, sanitizeForAudit, summarizeResponse } from "../../server/src/services/ai-audit.js";

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

// Helper to start test backend server
async function startTestServer(port: number): Promise<http.Server> {
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

// Helper to start mock upstream servers
function createMockUpstream(
  port: number,
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

async function runM3Verification() {
  console.log("================================================================");
  console.log("🚀 STARTING M3 AI AUDIT LOGS BACKEND VERIFICATION");
  console.log("================================================================\n");

  const TEST_SERVER_PORT = 4188;
  const MOCK_UPSTREAM_PORT = 4189;
  const MOCK_FAILOVER_PORT = 4190;

  const server = await startTestServer(TEST_SERVER_PORT);
  const BASE_URL = `http://127.0.0.1:${TEST_SERVER_PORT}`;

  let mockUpstreamServer: http.Server | null = null;
  let mockFailoverServer: http.Server | null = null;

  const testChannelsCreated: string[] = [];

  try {
    // -------------------------------------------------------------------------
    // SECTION 1: Database Schema & Indexes Verification
    // -------------------------------------------------------------------------
    console.log("\n>>> SECTION 1: Database Schema & Indexes Verification <<<");

    const tableInfo = db.prepare(`PRAGMA table_info(ai_audit_logs)`).all() as {
      name: string;
      type: string;
      pk: number;
    }[];
    const columnMap = new Map(tableInfo.map((c) => [c.name, c.type]));

    assert("SCHEMA", "ai_audit_logs table exists", tableInfo.length > 0, `Found ${tableInfo.length} columns`);

    const requiredColumns = [
      "id",
      "user_id",
      "username",
      "request_type",
      "model",
      "channel_id",
      "channel_name",
      "status",
      "status_code",
      "duration_ms",
      "prompt_preview",
      "request_body",
      "response_summary",
      "error_message",
      "retry_count",
      "ip_address",
      "created_at",
    ];

    for (const col of requiredColumns) {
      assert("SCHEMA", `Column '${col}' exists`, columnMap.has(col), `Type: ${columnMap.get(col)}`);
    }

    const indexes = db.prepare(`
      SELECT name FROM sqlite_master WHERE tbl_name = 'ai_audit_logs' AND type = 'index'
    `).all() as { name: string }[];
    const indexNames = new Set(indexes.map((i) => i.name));

    const requiredIndexes = [
      "idx_ai_audit_logs_created_at",
      "idx_ai_audit_logs_status",
      "idx_ai_audit_logs_channel_id",
      "idx_ai_audit_logs_user_id",
      "idx_ai_audit_logs_model",
    ];

    for (const idx of requiredIndexes) {
      assert("SCHEMA", `Index '${idx}' exists`, indexNames.has(idx), `Index confirmed in sqlite_master`);
    }

    // -------------------------------------------------------------------------
    // SECTION 2: Auth Guards on Admin Audit Logs
    // -------------------------------------------------------------------------
    console.log("\n>>> SECTION 2: Auth Guards on Admin Audit Logs <<<");

    // Setup admin & user in DB
    const adminUser: UserRecord = {
      id: "admin-m3-test",
      username: "admin_m3",
      password_hash: "$2a$10$xyz",
      display_name: "Admin M3",
      role: "admin",
      status: "active",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const normalUser: UserRecord = {
      id: "user-m3-test",
      username: "user_m3",
      password_hash: "$2a$10$xyz",
      display_name: "User M3",
      role: "user",
      status: "active",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    db.prepare(`INSERT OR REPLACE INTO users (id, username, password_hash, display_name, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      adminUser.id, adminUser.username, adminUser.password_hash, adminUser.display_name, adminUser.role, adminUser.status, adminUser.created_at, adminUser.updated_at
    );
    db.prepare(`INSERT OR REPLACE INTO users (id, username, password_hash, display_name, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      normalUser.id, normalUser.username, normalUser.password_hash, normalUser.display_name, normalUser.role, normalUser.status, normalUser.created_at, normalUser.updated_at
    );

    const adminToken = jwt.sign(
      { userId: adminUser.id, username: adminUser.username, role: adminUser.role },
      JWT_SECRET,
      { expiresIn: "1h" }
    );
    const userToken = jwt.sign(
      { userId: normalUser.id, username: normalUser.username, role: normalUser.role },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    // 1. Unauthenticated request
    const unauthRes = await fetch(`${BASE_URL}/api/admin/audit-logs`);
    assert("AUTH", "Unauthenticated request blocked with 401", unauthRes.status === 401, `Status: ${unauthRes.status}`);

    // 2. Normal user request
    const userRes = await fetch(`${BASE_URL}/api/admin/audit-logs`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert("AUTH", "Normal user blocked with 403 Forbidden", userRes.status === 403, `Status: ${userRes.status}`);

    // 3. Admin user request
    const adminRes = await fetch(`${BASE_URL}/api/admin/audit-logs`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert("AUTH", "Admin user allowed with 200 OK", adminRes.status === 200, `Status: ${adminRes.status}`);
    const adminJson = (await adminRes.json()) as any;
    assert("AUTH", "Admin response contains logs array", Array.isArray(adminJson.logs), `Logs count: ${adminJson.logs?.length}`);

    // -------------------------------------------------------------------------
    // SECTION 3: Mock Upstream AI Setup & Zero Key Leak Definition
    // -------------------------------------------------------------------------
    console.log("\n>>> SECTION 3: Upstream Setup & AI Request Audit Logging <<<");

    const SECRET_KEY = "sk-m3-super-secret-key-1234567890abcdef";

    // Setup primary mock upstream server
    mockUpstreamServer = await createMockUpstream(MOCK_UPSTREAM_PORT, async (req, res) => {
      const url = req.url || "";
      let body = "";
      for await (const chunk of req) {
        body += chunk;
      }

      if (url.includes("/images/generations")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          created: Date.now(),
          data: [{ url: "http://127.0.0.1:4189/generated-1.png" }],
        }));
        return;
      }

      if (url.includes("/images/edits")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          created: Date.now(),
          data: [{ url: "http://127.0.0.1:4189/edited-1.png" }],
        }));
        return;
      }

      if (url.includes("/chat/completions")) {
        if (body.includes('"stream":true') || body.includes('"stream": true')) {
          res.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache",
          });
          res.write('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n');
          res.write('data: {"choices":[{"delta":{"content":" World!"}}]}\n\n');
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          choices: [{ message: { role: "assistant", content: "Chat response from mock AI" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }));
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not Found" }));
    });

    // Create active AI channel pointing to mock upstream
    const testChannel = createAiChannel({
      id: "chan-m3-mock",
      name: "M3 Mock Primary Channel",
      provider_type: "openai",
      base_url: `http://127.0.0.1:${MOCK_UPSTREAM_PORT}`,
      api_key: SECRET_KEY,
      models: JSON.stringify(["m3-image-model", "m3-chat-model", "gpt-image-2", "dall-e-3", "gpt-4o"]),
      default_model: "m3-image-model",
      priority: 200,
      weight: 1,
      is_active: 1,
      timeout_ms: 5000,
      custom_headers: "{}",
      health_status: "healthy",
      last_latency_ms: 10,
      last_checked_at: new Date().toISOString(),
      last_error: null,
    });
    testChannelsCreated.push(testChannel.id);

    // -------------------------------------------------------------------------
    // SECTION 4: Verify Image Generation Audit Log
    // -------------------------------------------------------------------------
    console.log("\n>>> SECTION 4: Image Generation Audit Log Verification <<<");

    const imgGenRes = await fetch(`${BASE_URL}/api/ai/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        prompt: "A beautiful mountain landscape at sunset",
        model: "m3-image-model",
        n: 1,
        size: "1024x1024",
      }),
    });

    assert("IMAGE_GEN", "Image gen returned HTTP 200", imgGenRes.status === 200, `Status: ${imgGenRes.status}`);

    // Check DB for audit log
    const imgGenLog = db.prepare(`
      SELECT * FROM ai_audit_logs WHERE request_type = 'image_generation' ORDER BY created_at DESC LIMIT 1
    `).get() as any;

    assert("IMAGE_GEN", "Audit log created in DB", Boolean(imgGenLog), `Log ID: ${imgGenLog?.id}`);
    assert("IMAGE_GEN", "Log request_type is 'image_generation'", imgGenLog?.request_type === "image_generation", imgGenLog?.request_type);
    assert("IMAGE_GEN", "Log status is 'success'", imgGenLog?.status === "success", imgGenLog?.status);
    assert("IMAGE_GEN", "Log status_code is 200", imgGenLog?.status_code === 200, `${imgGenLog?.status_code}`);
    assert("IMAGE_GEN", "Log model matches requested model", imgGenLog?.model === "m3-image-model", imgGenLog?.model);
    assert("IMAGE_GEN", "Log channel_id matches test channel", imgGenLog?.channel_id === testChannel.id, imgGenLog?.channel_id);
    assert("IMAGE_GEN", "Log channel_name matches test channel", imgGenLog?.channel_name === testChannel.name, imgGenLog?.channel_name);
    assert("IMAGE_GEN", "Log user_id matches user", imgGenLog?.user_id === normalUser.id, imgGenLog?.user_id);
    assert("IMAGE_GEN", "Log username matches user", imgGenLog?.username === normalUser.username, imgGenLog?.username);
    assert("IMAGE_GEN", "Log duration_ms is recorded (>0)", imgGenLog?.duration_ms >= 0, `${imgGenLog?.duration_ms}ms`);
    assert("IMAGE_GEN", "Log prompt_preview contains prompt text", imgGenLog?.prompt_preview?.includes("mountain landscape"), imgGenLog?.prompt_preview);
    assert("IMAGE_GEN", "Log response_summary contains image url", imgGenLog?.response_summary?.includes("generated-1.png"), imgGenLog?.response_summary);

    // -------------------------------------------------------------------------
    // SECTION 5: Verify Image Edit Audit Log
    // -------------------------------------------------------------------------
    console.log("\n>>> SECTION 5: Image Edit Audit Log Verification <<<");

    const imgEditRes = await fetch(`${BASE_URL}/api/ai/images/edits`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        prompt: "Add a red bird to the tree",
        model: "gpt-image-2",
        image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      }),
    });

    assert("IMAGE_EDIT", "Image edit returned HTTP 200", imgEditRes.status === 200, `Status: ${imgEditRes.status}`);

    const imgEditLog = db.prepare(`
      SELECT * FROM ai_audit_logs WHERE request_type = 'image_edit' ORDER BY created_at DESC LIMIT 1
    `).get() as any;

    assert("IMAGE_EDIT", "Image edit audit log created", Boolean(imgEditLog), `Log ID: ${imgEditLog?.id}`);
    assert("IMAGE_EDIT", "Log request_type is 'image_edit'", imgEditLog?.request_type === "image_edit", imgEditLog?.request_type);
    assert("IMAGE_EDIT", "Log status is 'success'", imgEditLog?.status === "success", imgEditLog?.status);
    assert("IMAGE_EDIT", "Log prompt_preview matches", imgEditLog?.prompt_preview?.includes("red bird"), imgEditLog?.prompt_preview);

    // -------------------------------------------------------------------------
    // SECTION 6: Verify Chat Completion Audit Log (Non-stream & Stream)
    // -------------------------------------------------------------------------
    console.log("\n>>> SECTION 6: Chat Completion Audit Log Verification <<<");

    // 6a. Non-streaming chat
    const chatRes = await fetch(`${BASE_URL}/api/ai/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        model: "m3-chat-model",
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "What is Infinite Canvas?" },
        ],
        stream: false,
      }),
    });

    assert("CHAT", "Non-streaming chat returned HTTP 200", chatRes.status === 200, `Status: ${chatRes.status}`);

    const chatLog = db.prepare(`
      SELECT * FROM ai_audit_logs WHERE request_type = 'chat_completion' ORDER BY created_at DESC LIMIT 1
    `).get() as any;

    assert("CHAT", "Chat audit log created", Boolean(chatLog), `Log ID: ${chatLog?.id}`);
    assert("CHAT", "Log request_type is 'chat_completion'", chatLog?.request_type === "chat_completion", chatLog?.request_type);
    assert("CHAT", "Log prompt_preview captures user question", chatLog?.prompt_preview?.includes("Infinite Canvas"), chatLog?.prompt_preview);
    assert("CHAT", "Log response_summary captures content", chatLog?.response_summary?.includes("Chat response from mock AI"), chatLog?.response_summary);

    // 6b. Streaming chat
    const streamRes = await fetch(`${BASE_URL}/api/ai/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        model: "m3-chat-model",
        messages: [{ role: "user", content: "Stream me a poem" }],
        stream: true,
      }),
    });

    assert("CHAT_STREAM", "Streaming chat returned HTTP 200", streamRes.status === 200, `Status: ${streamRes.status}`);
    const streamText = await streamRes.text();
    assert("CHAT_STREAM", "Streamed chunks received", streamText.includes("Hello") && streamText.includes("World!"), "Received SSE chunks");

    const streamLog = db.prepare(`
      SELECT * FROM ai_audit_logs WHERE request_type = 'chat_completion' ORDER BY created_at DESC LIMIT 1
    `).get() as any;

    assert("CHAT_STREAM", "Stream audit log recorded", Boolean(streamLog), `Log ID: ${streamLog?.id}`);
    assert("CHAT_STREAM", "Stream log status is 'success'", streamLog?.status === "success", streamLog?.status);
    assert("CHAT_STREAM", "Stream log response_summary marks streamed", streamLog?.response_summary?.includes("streamed"), streamLog?.response_summary);

    // -------------------------------------------------------------------------
    // SECTION 7: Zero Base64 Bleed Verification
    // -------------------------------------------------------------------------
    console.log("\n>>> SECTION 7: Zero Base64 Bleed Verification <<<");

    // Generate a 10KB base64 string to simulate image payload
    const dummyBase64Data = "A".repeat(10240);
    const base64DataUrl = `data:image/png;base64,${dummyBase64Data}`;

    // Direct sanitizer tests
    const sanitizedObj = sanitizeForAudit({
      prompt: "Draw a cyber city",
      image: base64DataUrl,
      nested: {
        b64_json: dummyBase64Data,
      },
    });

    assert("BLEED", "Sanitizer replaced data URL with tag",
      typeof sanitizedObj.image === "string" && sanitizedObj.image.startsWith("[Base64 Image:"),
      `Got: ${sanitizedObj.image}`
    );
    assert("BLEED", "Sanitizer replaced b64_json field",
      typeof sanitizedObj.nested.b64_json === "string" && sanitizedObj.nested.b64_json.startsWith("[Base64 Image:"),
      `Got: ${sanitizedObj.nested.b64_json}`
    );
    assert("BLEED", "Zero raw base64 remained in sanitized object",
      !JSON.stringify(sanitizedObj).includes(dummyBase64Data),
      "No 10KB base64 leak"
    );

    // Response summary zero bleed test
    const mockB64Response = {
      data: [
        { b64_json: dummyBase64Data },
        { b64_json: dummyBase64Data },
      ],
    };
    const summary = summarizeResponse(mockB64Response);
    assert("BLEED", "summarizeResponse avoids raw base64",
      !summary.includes(dummyBase64Data) && summary.includes("[Base64 Image:"),
      `Summary: ${summary}`
    );

    // Request through Express endpoint with base64 payload
    await fetch(`${BASE_URL}/api/ai/images/edits`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        prompt: "Check base64 bleed resistance",
        model: "gpt-image-2",
        image: base64DataUrl,
      }),
    });

    const bleedCheckLog = db.prepare(`
      SELECT request_body, response_summary FROM ai_audit_logs WHERE prompt_preview LIKE '%bleed resistance%' LIMIT 1
    `).get() as any;

    assert("BLEED", "Audit log in DB does NOT contain 10KB base64 string",
      !bleedCheckLog.request_body.includes(dummyBase64Data),
      "SQLite request_body free of raw base64 bloat"
    );
    assert("BLEED", "Audit log in DB contains [Base64 Image tag",
      bleedCheckLog.request_body.includes("[Base64 Image:"),
      `request_body snippet: ${bleedCheckLog.request_body.slice(0, 100)}`
    );

    // -------------------------------------------------------------------------
    // SECTION 8: Zero Key Leak / API Key Redaction Verification
    // -------------------------------------------------------------------------
    console.log("\n>>> SECTION 8: Zero Key Leak & Key Redaction Verification <<<");

    const directRedact = sanitizeForAudit(
      `Error from upstream: Channel failed with key ${SECRET_KEY} and sk-abcdef1234567890abcdef123456`,
      [SECRET_KEY]
    );

    assert("KEY_LEAK", "Direct sanitizer redacts configured secret key",
      !directRedact.includes(SECRET_KEY) && directRedact.includes("[REDACTED]"),
      `Sanitized: ${directRedact}`
    );
    assert("KEY_LEAK", "Direct sanitizer redacts generic sk- key",
      !directRedact.includes("sk-abcdef1234567890abcdef123456"),
      "Generic sk- key redacted"
    );

    // Record an audit log with intentional key leaks in prompt, body, and error
    await AiAuditService.record({
      userId: userToken,
      username: "key_tester",
      requestType: "chat_completion",
      model: "leak-test-model",
      status: "failed",
      statusCode: 500,
      durationMs: 42,
      promptPreview: `My key is ${SECRET_KEY}`,
      requestBody: { api_secret: SECRET_KEY, note: "Keep safe" },
      errorMessage: `Authorization failed with Bearer ${SECRET_KEY}`,
    });

    const leakCheckLog = db.prepare(`
      SELECT prompt_preview, request_body, error_message FROM ai_audit_logs WHERE model = 'leak-test-model' LIMIT 1
    `).get() as any;

    assert("KEY_LEAK", "prompt_preview in SQLite has key redacted",
      !leakCheckLog.prompt_preview.includes(SECRET_KEY) && leakCheckLog.prompt_preview.includes("[REDACTED]"),
      `prompt_preview: ${leakCheckLog.prompt_preview}`
    );
    assert("KEY_LEAK", "request_body in SQLite has key redacted",
      !leakCheckLog.request_body.includes(SECRET_KEY) && leakCheckLog.request_body.includes("[REDACTED]"),
      `request_body: ${leakCheckLog.request_body}`
    );
    assert("KEY_LEAK", "error_message in SQLite has key redacted",
      !leakCheckLog.error_message.includes(SECRET_KEY) && leakCheckLog.error_message.includes("[REDACTED]"),
      `error_message: ${leakCheckLog.error_message}`
    );

    // -------------------------------------------------------------------------
    // SECTION 9: Failover & Retry Count Audit Log Verification
    // -------------------------------------------------------------------------
    console.log("\n>>> SECTION 9: Failover & Retry Count Verification <<<");

    // Start a secondary mock server for failover
    mockFailoverServer = await createMockUpstream(MOCK_FAILOVER_PORT, (req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        data: [{ url: "http://127.0.0.1:4190/failover-success.png" }],
      }));
    });

    // Create Channel 1: Primary with priority 300 (fails with 429)
    // Create Channel 2: Fallback with priority 250 (succeeds with 200)
    const failoverFailPort = 4191;
    const mockFailingServer = await createMockUpstream(failoverFailPort, (req, res) => {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Rate limit exceeded" } }));
    });

    const primaryFailingChan = createAiChannel({
      id: "chan-fail-primary",
      name: "Failing Primary Channel",
      provider_type: "openai",
      base_url: `http://127.0.0.1:${failoverFailPort}`,
      api_key: "sk-failing-12345",
      models: JSON.stringify(["failover-test-model"]),
      default_model: "failover-test-model",
      priority: 300,
      weight: 1,
      is_active: 1,
      timeout_ms: 3000,
      custom_headers: "{}",
      health_status: "healthy",
      last_latency_ms: null,
      last_checked_at: null,
      last_error: null,
    });
    testChannelsCreated.push(primaryFailingChan.id);

    const backupSuccessChan = createAiChannel({
      id: "chan-success-backup",
      name: "Backup Successful Channel",
      provider_type: "openai",
      base_url: `http://127.0.0.1:${MOCK_FAILOVER_PORT}`,
      api_key: "sk-backup-12345",
      models: JSON.stringify(["failover-test-model"]),
      default_model: "failover-test-model",
      priority: 250,
      weight: 1,
      is_active: 1,
      timeout_ms: 3000,
      custom_headers: "{}",
      health_status: "healthy",
      last_latency_ms: null,
      last_checked_at: null,
      last_error: null,
    });
    testChannelsCreated.push(backupSuccessChan.id);

    const failoverReqRes = await fetch(`${BASE_URL}/api/ai/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        prompt: "A failover test prompt",
        model: "failover-test-model",
      }),
    });

    assert("FAILOVER", "Request succeeded via backup channel (HTTP 200)", failoverReqRes.status === 200, `Status: ${failoverReqRes.status}`);

    const failoverLog = db.prepare(`
      SELECT * FROM ai_audit_logs WHERE model = 'failover-test-model' ORDER BY created_at DESC LIMIT 1
    `).get() as any;

    assert("FAILOVER", "Failover log recorded in SQLite", Boolean(failoverLog), `Log ID: ${failoverLog?.id}`);
    assert("FAILOVER", "Failover log status is 'success'", failoverLog?.status === "success", failoverLog?.status);
    assert("FAILOVER", "Failover log channel_name matches Backup channel",
      failoverLog?.channel_name === backupSuccessChan.name,
      `Hit channel: ${failoverLog?.channel_name}`
    );
    assert("FAILOVER", "Failover log retry_count is 1 (attempted primary first)",
      failoverLog?.retry_count === 1,
      `retry_count: ${failoverLog?.retry_count}`
    );

    mockFailingServer.close();

    // -------------------------------------------------------------------------
    // SECTION 10: Multi-Dimensional Query Filtering & Admin Inspection API
    // -------------------------------------------------------------------------
    console.log("\n>>> SECTION 10: Admin Audit Logs Query & Filtering API <<<");

    // 10a. Pagination
    const pageRes = await fetch(`${BASE_URL}/api/admin/audit-logs?page=1&limit=2`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const pageJson = (await pageRes.json()) as any;
    assert("ADMIN_API", "Pagination returns requested limit", pageJson.logs.length <= 2, `Logs: ${pageJson.logs.length}`);
    assert("ADMIN_API", "Total count returned", pageJson.total >= 5, `Total: ${pageJson.total}`);

    // 10b. Filter by status=success
    const successRes = await fetch(`${BASE_URL}/api/admin/audit-logs?status=success`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const successJson = (await successRes.json()) as any;
    assert("ADMIN_API", "status=success returns only successful logs",
      successJson.logs.every((l: any) => l.status === "success"),
      `Count: ${successJson.logs.length}`
    );

    // 10c. Filter by requestType=image_generation
    const typeRes = await fetch(`${BASE_URL}/api/admin/audit-logs?requestType=image_generation`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const typeJson = (await typeRes.json()) as any;
    assert("ADMIN_API", "requestType filter returns matching logs",
      typeJson.logs.every((l: any) => l.requestType === "image_generation"),
      `Count: ${typeJson.logs.length}`
    );

    // 10d. Filter by model
    const modelRes = await fetch(`${BASE_URL}/api/admin/audit-logs?model=failover-test-model`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const modelJson = (await modelRes.json()) as any;
    assert("ADMIN_API", "model filter returns matching logs",
      modelJson.logs.length > 0 && modelJson.logs.every((l: any) => l.model === "failover-test-model"),
      `Count: ${modelJson.logs.length}`
    );

    // 10e. Search query
    const searchRes = await fetch(`${BASE_URL}/api/admin/audit-logs?search=mountain`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const searchJson = (await searchRes.json()) as any;
    assert("ADMIN_API", "search query finds prompt containing keyword",
      searchJson.logs.length > 0 && searchJson.logs.some((l: any) => l.promptPreview?.includes("mountain")),
      `Found ${searchJson.logs.length} matching logs`
    );

    // 10f. Detail view: GET /api/admin/audit-logs/:id
    const targetId = pageJson.logs[0].id;
    const detailRes = await fetch(`${BASE_URL}/api/admin/audit-logs/${targetId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert("ADMIN_API", "Detail view returns HTTP 200", detailRes.status === 200, `Status: ${detailRes.status}`);
    const detailJson = (await detailRes.json()) as any;
    assert("ADMIN_API", "Detail view returns log with matching ID", detailJson.log?.id === targetId, `ID: ${detailJson.log?.id}`);
    assert("ADMIN_API", "Detail view includes promptPreview", detailJson.log?.promptPreview !== undefined, "promptPreview present");

    // 10g. 404 on invalid ID
    const notFoundRes = await fetch(`${BASE_URL}/api/admin/audit-logs/non-existent-uuid-999`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert("ADMIN_API", "Invalid ID returns 404", notFoundRes.status === 404, `Status: ${notFoundRes.status}`);

    // 10h. Stats endpoint: GET /api/admin/audit-logs/stats
    const statsRes = await fetch(`${BASE_URL}/api/admin/audit-logs/stats`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert("ADMIN_API", "Stats returns HTTP 200", statsRes.status === 200, `Status: ${statsRes.status}`);
    const statsJson = (await statsRes.json()) as any;
    assert("ADMIN_API", "Stats includes totalRequests > 0", statsJson.stats?.totalRequests > 0, `Total: ${statsJson.stats?.totalRequests}`);
    assert("ADMIN_API", "Stats includes successCount > 0", statsJson.stats?.successCount > 0, `Success: ${statsJson.stats?.successCount}`);

    console.log("\n================================================================");
    console.log(`🎉 ALL ${testResults.length} BACKEND VERIFICATION CHECKS PASSED!`);
    console.log("================================================================");
  } finally {
    // Cleanup
    for (const chanId of testChannelsCreated) {
      deleteAiChannel(chanId);
    }
    if (mockUpstreamServer) mockUpstreamServer.close();
    if (mockFailoverServer) mockFailoverServer.close();
    server.close();
  }
}

runM3Verification().catch((err) => {
  console.error("\n❌ M3 Verification failed:", err);
  process.exit(1);
});
