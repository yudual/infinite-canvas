import http from "node:http";
import crypto from "node:crypto";
import express, { type Request, type Response } from "express";
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
  getAiChannelById,
  deleteAiChannel,
  updateChannelHealth,
  type ChannelRecord,
} from "../../server/src/db.js";
import { JWT_SECRET } from "../../server/src/config.js";

interface TestReportItem {
  id: string;
  category: string;
  name: string;
  status: "PASS" | "FAIL";
  expected: any;
  actual: any;
  details?: string;
  logs?: string[];
}

const report: TestReportItem[] = [];

function recordTest(item: TestReportItem) {
  report.push(item);
  const icon = item.status === "PASS" ? "✅ PASS" : "❌ FAIL";
  console.log(`${icon} [${item.category}] [${item.id}] ${item.name}`);
  if (item.status === "FAIL") {
    console.error(`     Expected: ${JSON.stringify(item.expected)}`);
    console.error(`     Actual:   ${JSON.stringify(item.actual)}`);
    if (item.details) console.error(`     Details:  ${item.details}`);
  }
}

// Ports for this test run
const MAIN_PORT = 3980;
const UPSTREAM_A_PORT = 3981;
const UPSTREAM_B_PORT = 3982;
const UPSTREAM_C_PORT = 3983;

const MAIN_URL = `http://127.0.0.1:${MAIN_PORT}`;
const UPSTREAM_A_URL = `http://127.0.0.1:${UPSTREAM_A_PORT}`;
const UPSTREAM_B_URL = `http://127.0.0.1:${UPSTREAM_B_PORT}`;
const UPSTREAM_C_URL = `http://127.0.0.1:${UPSTREAM_C_PORT}`;

function createMockServer(port: number, handlerGetter: () => (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      handlerGetter()(req, res);
    });
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function startAppServer(port: number): Promise<http.Server> {
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

async function runChallenger2Suite() {
  console.log("================================================================================");
  console.log(" 🧪 Challenger 2: Channel CRUD, Masked Keys & WAL Concurrency Stress Test");
  console.log(` Base URL: ${MAIN_URL}`);
  console.log(` Timestamp: ${new Date().toISOString()}`);
  console.log("================================================================================\n");

  initSchema();

  // Setup Admin & Auth
  let adminUser = db.prepare("SELECT * FROM users WHERE role = 'admin' AND status = 'active' LIMIT 1").get() as any;
  if (!adminUser) {
    const now = new Date().toISOString();
    const id = "admin-c2-" + Date.now();
    db.prepare(
      "INSERT INTO users (id, username, password_hash, display_name, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(id, "c2admin_" + Date.now(), "hash", "C2 Admin", "admin", "active", now, now);
    adminUser = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  }

  const adminToken = jwt.sign(
    { userId: adminUser.id, username: adminUser.username, role: adminUser.role },
    JWT_SECRET,
    { expiresIn: "2h" }
  );

  const adminHeaders = {
    Authorization: `Bearer ${adminToken}`,
    "Content-Type": "application/json",
  };

  // Handlers for mock upstreams
  let handlerA: (req: http.IncomingMessage, res: http.ServerResponse) => void = () => {};
  let handlerB: (req: http.IncomingMessage, res: http.ServerResponse) => void = () => {};
  let handlerC: (req: http.IncomingMessage, res: http.ServerResponse) => void = () => {};

  const mockServerA = await createMockServer(UPSTREAM_A_PORT, () => handlerA);
  const mockServerB = await createMockServer(UPSTREAM_B_PORT, () => handlerB);
  const mockServerC = await createMockServer(UPSTREAM_C_PORT, () => handlerC);
  const appServer = await startAppServer(MAIN_PORT);

  // Clean old test channels
  db.prepare("DELETE FROM ai_channels WHERE id LIKE 'c2-test-%'").run();

  const channelAlphaId = "c2-test-alpha";
  const channelBetaId = "c2-test-beta";
  const channelGammaId = "c2-test-gamma";

  try {
    // =========================================================================
    // 1. MASKED KEY PRESERVATION & CRUD TESTS
    // =========================================================================
    console.log(">>> [SECTION 1] Masked Key Preservation & CRUD Integrity <<<\n");

    const channelId1 = "c2-test-masked-key-1";
    const realApiKey1 = "sk-real-super-secret-key-abcdef-1234";

    // 1.1 Create channel with real API key
    const createRes = await fetch(`${MAIN_URL}/api/admin/channels`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        name: "Masked Key Test Channel",
        providerType: "openai",
        baseUrl: UPSTREAM_A_URL,
        apiKey: realApiKey1,
        models: ["mask-test-model"],
        defaultModel: "mask-test-model",
        priority: 100,
      }),
    });
    const createData = (await createRes.json()) as any;
    const createdChannelId = createData.channel?.id;

    recordTest({
      id: "CRUD-CREATE-01",
      category: "Channel CRUD",
      name: "Create channel with real API key returns 201 and masked key",
      status: createRes.status === 201 && createData.channel?.apiKeyMasked === "sk-****1234" && !JSON.stringify(createData).includes(realApiKey1) ? "PASS" : "FAIL",
      expected: { status: 201, apiKeyMasked: "sk-****1234", hasKey: true },
      actual: { status: createRes.status, apiKeyMasked: createData.channel?.apiKeyMasked, hasKey: createData.channel?.hasKey },
      details: "API key must be masked in response and never leak raw key",
    });

    // 1.2 Verify DB holds full real key
    const dbRow1 = db.prepare("SELECT api_key FROM ai_channels WHERE id = ?").get(createdChannelId) as any;
    recordTest({
      id: "CRUD-DB-CHECK-01",
      category: "Channel CRUD",
      name: "Database stores full unmasked API key upon creation",
      status: dbRow1?.api_key === realApiKey1 ? "PASS" : "FAIL",
      expected: realApiKey1,
      actual: dbRow1?.api_key,
    });

    // 1.3 Update channel with masked key `apiKey: "sk-****1234"` (e.g. form resubmitted with masked value)
    const updateWithMaskRes = await fetch(`${MAIN_URL}/api/admin/channels/${createdChannelId}`, {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({
        name: "Renamed Channel With Masked Key",
        baseUrl: UPSTREAM_A_URL,
        apiKey: "sk-****1234",
        models: ["mask-test-model"],
        priority: 110,
      }),
    });
    const updateWithMaskData = (await updateWithMaskRes.json()) as any;

    const dbRowAfterMask = db.prepare("SELECT * FROM ai_channels WHERE id = ?").get(createdChannelId) as any;
    const keyPreserved = dbRowAfterMask?.api_key === realApiKey1;
    const nameUpdated = dbRowAfterMask?.name === "Renamed Channel With Masked Key";
    const priorityUpdated = dbRowAfterMask?.priority === 110;

    recordTest({
      id: "MASKED-KEY-PRESERVE-01",
      category: "Masked Key",
      name: "PUT with masked key 'sk-****1234' preserves real API key in SQLite DB",
      status: updateWithMaskRes.status === 200 && keyPreserved && nameUpdated && priorityUpdated ? "PASS" : "FAIL",
      expected: { status: 200, keyPreserved: true, realKeyInDb: realApiKey1, name: "Renamed Channel With Masked Key" },
      actual: { status: updateWithMaskRes.status, keyPreserved, realKeyInDb: dbRowAfterMask?.api_key, name: dbRowAfterMask?.name },
      details: `Database api_key after PUT with masked value: ${dbRowAfterMask?.api_key}`,
    });

    // 1.4 Test functional usability of preserved key in AI proxy request
    let receivedAuthHeaderA = "";
    handlerA = (req, res) => {
      receivedAuthHeaderA = req.headers["authorization"] || "";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ url: "https://example.com/ok.png" }] }));
    };

    const proxyRes1 = await fetch(`${MAIN_URL}/api/ai/images/generations`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ prompt: "Testing preserved masked key", model: "mask-test-model" }),
    });
    const proxyData1 = (await proxyRes1.json()) as any;

    recordTest({
      id: "MASKED-KEY-FUNCTIONAL-01",
      category: "Masked Key",
      name: "Preserved key is fully functional and sent to upstream Authorization header",
      status: proxyRes1.status === 200 && receivedAuthHeaderA === `Bearer ${realApiKey1}` ? "PASS" : "FAIL",
      expected: { status: 200, header: `Bearer ${realApiKey1}` },
      actual: { status: proxyRes1.status, header: receivedAuthHeaderA },
      details: `Upstream received Authorization: ${receivedAuthHeaderA}`,
    });

    // 1.5 Update channel with omitted apiKey (undefined)
    const updateOmitKeyRes = await fetch(`${MAIN_URL}/api/admin/channels/${createdChannelId}`, {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({
        name: "Renamed Channel With Omitted Key",
        baseUrl: UPSTREAM_A_URL,
        models: ["mask-test-model"],
      }),
    });
    const dbRowAfterOmit = db.prepare("SELECT api_key FROM ai_channels WHERE id = ?").get(createdChannelId) as any;
    recordTest({
      id: "MASKED-KEY-PRESERVE-02",
      category: "Masked Key",
      name: "PUT with omitted apiKey field preserves existing real API key in DB",
      status: updateOmitKeyRes.status === 200 && dbRowAfterOmit?.api_key === realApiKey1 ? "PASS" : "FAIL",
      expected: realApiKey1,
      actual: dbRowAfterOmit?.api_key,
    });

    // 1.6 Update channel with generic masked string `apiKey: "sk-****"`
    const updateGenericMaskRes = await fetch(`${MAIN_URL}/api/admin/channels/${createdChannelId}`, {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({
        name: "Renamed Channel Generic Mask",
        baseUrl: UPSTREAM_A_URL,
        apiKey: "sk-****",
        models: ["mask-test-model"],
      }),
    });
    const dbRowGenericMask = db.prepare("SELECT api_key FROM ai_channels WHERE id = ?").get(createdChannelId) as any;
    recordTest({
      id: "MASKED-KEY-PRESERVE-03",
      category: "Masked Key",
      name: "PUT with generic 'sk-****' preserves existing real API key in DB",
      status: updateGenericMaskRes.status === 200 && dbRowGenericMask?.api_key === realApiKey1 ? "PASS" : "FAIL",
      expected: realApiKey1,
      actual: dbRowGenericMask?.api_key,
    });

    // 1.7 Update channel with a NEW real key `sk-new-super-key-9999`
    const newRealApiKey = "sk-new-super-key-9999";
    const updateNewKeyRes = await fetch(`${MAIN_URL}/api/admin/channels/${createdChannelId}`, {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({
        name: "Renamed Channel New Key",
        baseUrl: UPSTREAM_A_URL,
        apiKey: newRealApiKey,
        models: ["mask-test-model"],
      }),
    });
    const dbRowNewKey = db.prepare("SELECT api_key FROM ai_channels WHERE id = ?").get(createdChannelId) as any;
    recordTest({
      id: "KEY-ROTATION-01",
      category: "Masked Key",
      name: "PUT with a new unmasked API key updates the DB key cleanly",
      status: updateNewKeyRes.status === 200 && dbRowNewKey?.api_key === newRealApiKey ? "PASS" : "FAIL",
      expected: newRealApiKey,
      actual: dbRowNewKey?.api_key,
    });

    // Verify upstream now receives new key
    receivedAuthHeaderA = "";
    await fetch(`${MAIN_URL}/api/ai/images/generations`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ prompt: "Testing rotated key", model: "mask-test-model" }),
    });
    recordTest({
      id: "KEY-ROTATION-FUNCTIONAL-01",
      category: "Masked Key",
      name: "Rotated API key is immediately used in subsequent upstream AI calls",
      status: receivedAuthHeaderA === `Bearer ${newRealApiKey}` ? "PASS" : "FAIL",
      expected: `Bearer ${newRealApiKey}`,
      actual: receivedAuthHeaderA,
    });

    // Clean up channel 1
    db.prepare("DELETE FROM ai_channels WHERE id = ?").run(createdChannelId);

    // =========================================================================
    // 2. VALIDATION EDGE CASES & BOUNDARY TESTS
    // =========================================================================
    console.log("\n>>> [SECTION 2] Validation Edge Cases & Input Hardening <<<\n");

    // 2.1 POST /api/admin/channels - Missing or empty name
    const badNameCases = [
      { body: { baseUrl: UPSTREAM_A_URL, apiKey: "sk-test" }, desc: "Omitted name field" },
      { body: { name: "", baseUrl: UPSTREAM_A_URL, apiKey: "sk-test" }, desc: "Empty string name" },
      { body: { name: "   ", baseUrl: UPSTREAM_A_URL, apiKey: "sk-test" }, desc: "Whitespace name" },
      { body: { name: null, baseUrl: UPSTREAM_A_URL, apiKey: "sk-test" }, desc: "Null name" },
      { body: { name: 12345, baseUrl: UPSTREAM_A_URL, apiKey: "sk-test" }, desc: "Numeric name" },
    ];

    for (let i = 0; i < badNameCases.length; i++) {
      const tc = badNameCases[i];
      const res = await fetch(`${MAIN_URL}/api/admin/channels`, {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify(tc.body),
      });
      const data = (await res.json()) as any;
      recordTest({
        id: `VALIDATION-NAME-${i + 1}`,
        category: "Validation",
        name: `POST channel rejects ${tc.desc} with 400 INVALID_NAME`,
        status: res.status === 400 && data.error?.code === "INVALID_NAME" ? "PASS" : "FAIL",
        expected: { status: 400, code: "INVALID_NAME" },
        actual: { status: res.status, code: data.error?.code },
      });
    }

    // 2.2 POST /api/admin/channels - Invalid Base URLs
    const badUrlCases = [
      { url: "ftp://upstream.example.com/v1", desc: "FTP protocol" },
      { url: "ws://upstream.example.com/v1", desc: "WebSocket protocol" },
      { url: "file:///etc/passwd", desc: "File protocol" },
      { url: "javascript:alert(1)", desc: "Javascript pseudo-protocol" },
      { url: "data:text/plain;base64,SGVsbG8=", desc: "Data URI" },
      { url: "not-a-valid-url", desc: "Arbitrary text without protocol" },
      { url: "://missing-scheme", desc: "Missing scheme" },
      { url: "http://", desc: "Empty host HTTP" },
      { url: "https://", desc: "Empty host HTTPS" },
      { url: "", desc: "Empty string baseUrl" },
      { url: "   ", desc: "Whitespace baseUrl" },
    ];

    for (let i = 0; i < badUrlCases.length; i++) {
      const tc = badUrlCases[i];
      const res = await fetch(`${MAIN_URL}/api/admin/channels`, {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
          name: `Bad URL Channel ${i}`,
          baseUrl: tc.url,
          apiKey: "sk-test",
        }),
      });
      const data = (await res.json()) as any;
      recordTest({
        id: `VALIDATION-URL-${i + 1}`,
        category: "Validation",
        name: `POST channel rejects invalid baseUrl (${tc.desc}) with 400 INVALID_BASE_URL`,
        status: res.status === 400 && data.error?.code === "INVALID_BASE_URL" ? "PASS" : "FAIL",
        expected: { status: 400, code: "INVALID_BASE_URL" },
        actual: { status: res.status, code: data.error?.code },
      });
    }

    // 2.3 POST /api/admin/channels - Missing or empty apiKey
    const badKeyCases = [
      { body: { name: "Test", baseUrl: UPSTREAM_A_URL }, desc: "Omitted apiKey" },
      { body: { name: "Test", baseUrl: UPSTREAM_A_URL, apiKey: "" }, desc: "Empty apiKey" },
      { body: { name: "Test", baseUrl: UPSTREAM_A_URL, apiKey: "   " }, desc: "Whitespace apiKey" },
      { body: { name: "Test", baseUrl: UPSTREAM_A_URL, apiKey: null }, desc: "Null apiKey" },
    ];

    for (let i = 0; i < badKeyCases.length; i++) {
      const tc = badKeyCases[i];
      const res = await fetch(`${MAIN_URL}/api/admin/channels`, {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify(tc.body),
      });
      const data = (await res.json()) as any;
      recordTest({
        id: `VALIDATION-KEY-${i + 1}`,
        category: "Validation",
        name: `POST channel rejects ${tc.desc} with 400 MISSING_API_KEY`,
        status: res.status === 400 && data.error?.code === "MISSING_API_KEY" ? "PASS" : "FAIL",
        expected: { status: 400, code: "MISSING_API_KEY" },
        actual: { status: res.status, code: data.error?.code },
      });
    }

    // 2.4 PUT /api/admin/channels/:id - Invalid baseUrl on update
    const dummyChan = createAiChannel({
      id: "c2-test-validate-dummy",
      name: "Dummy Channel",
      provider_type: "openai",
      base_url: UPSTREAM_A_URL,
      api_key: "sk-dummy-123",
      models: JSON.stringify(["dummy"]),
      default_model: "dummy",
      priority: 0,
      weight: 1,
      is_active: 1,
      timeout_ms: 10000,
      custom_headers: "{}",
      health_status: "unknown",
      last_latency_ms: null,
      last_checked_at: null,
      last_error: null,
    });

    const putBadUrlRes = await fetch(`${MAIN_URL}/api/admin/channels/${dummyChan.id}`, {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({ baseUrl: "ftp://bad-upstream.org" }),
    });
    const putBadUrlData = (await putBadUrlRes.json()) as any;
    recordTest({
      id: "VALIDATION-PUT-URL-01",
      category: "Validation",
      name: "PUT channel rejects invalid baseUrl with 400 INVALID_BASE_URL",
      status: putBadUrlRes.status === 400 && putBadUrlData.error?.code === "INVALID_BASE_URL" ? "PASS" : "FAIL",
      expected: { status: 400, code: "INVALID_BASE_URL" },
      actual: { status: putBadUrlRes.status, code: putBadUrlData.error?.code },
    });

    // 2.5 Non-existent channel operations
    const notFoundEndpoints = [
      { method: "GET", path: "/api/admin/channels/non-existent-id", body: undefined, desc: "GET non-existent channel" },
      { method: "PUT", path: "/api/admin/channels/non-existent-id", body: { name: "x" }, desc: "PUT non-existent channel" },
      { method: "PATCH", path: "/api/admin/channels/non-existent-id/status", body: { isActive: false }, desc: "PATCH status on non-existent channel" },
      { method: "DELETE", path: "/api/admin/channels/non-existent-id", body: undefined, desc: "DELETE non-existent channel" },
      { method: "POST", path: "/api/admin/channels/non-existent-id/test", body: {}, desc: "POST test probe on non-existent channel" },
      { method: "POST", path: "/api/admin/channels/non-existent-id/sync-models", body: {}, desc: "POST sync models on non-existent channel" },
    ];

    for (let i = 0; i < notFoundEndpoints.length; i++) {
      const ep = notFoundEndpoints[i];
      const res = await fetch(`${MAIN_URL}${ep.path}`, {
        method: ep.method,
        headers: adminHeaders,
        body: ep.body ? JSON.stringify(ep.body) : undefined,
      });
      const data = (await res.json()) as any;
      recordTest({
        id: `VALIDATION-404-${i + 1}`,
        category: "Validation",
        name: `${ep.desc} returns 404 CHANNEL_NOT_FOUND`,
        status: res.status === 404 && data.error?.code === "CHANNEL_NOT_FOUND" ? "PASS" : "FAIL",
        expected: { status: 404, code: "CHANNEL_NOT_FOUND" },
        actual: { status: res.status, code: data.error?.code },
      });
    }

    db.prepare("DELETE FROM ai_channels WHERE id = ?").run(dummyChan.id);

    // =========================================================================
    // 3. CONCURRENCY & WAL STRESS TESTING ON aiRouter
    // =========================================================================
    console.log("\n>>> [SECTION 3] Concurrency & WAL Stress Testing on aiRouter <<<\n");

    function resetConcurrencyChannels() {
      db.prepare("DELETE FROM ai_channels WHERE id IN (?, ?, ?)").run(channelAlphaId, channelBetaId, channelGammaId);

      // Channel Alpha: High priority (200) -> UPSTREAM_A
      createAiChannel({
        id: channelAlphaId,
        name: "Channel Alpha (High Priority 200)",
        provider_type: "openai",
        base_url: UPSTREAM_A_URL,
        api_key: "sk-alpha-key-1111",
        models: JSON.stringify(["stress-model", "dall-e-3", "gpt-4o"]),
        default_model: "stress-model",
        priority: 200,
        weight: 1,
        is_active: 1,
        timeout_ms: 10000,
        custom_headers: "{}",
        health_status: "healthy",
        last_latency_ms: 25,
        last_checked_at: null,
        last_error: null,
      });

      // Channel Beta: Medium priority (100) -> UPSTREAM_B
      createAiChannel({
        id: channelBetaId,
        name: "Channel Beta (Med Priority 100)",
        provider_type: "openai",
        base_url: UPSTREAM_B_URL,
        api_key: "sk-beta-key-2222",
        models: JSON.stringify(["stress-model", "dall-e-3", "gpt-4o"]),
        default_model: "stress-model",
        priority: 100,
        weight: 1,
        is_active: 1,
        timeout_ms: 10000,
        custom_headers: "{}",
        health_status: "healthy",
        last_latency_ms: 50,
        last_checked_at: null,
        last_error: null,
      });

      // Channel Gamma: Low priority (50) -> UPSTREAM_C
      createAiChannel({
        id: channelGammaId,
        name: "Channel Gamma (Low Priority 50)",
        provider_type: "openai",
        base_url: UPSTREAM_C_URL,
        api_key: "sk-gamma-key-3333",
        models: JSON.stringify(["stress-model", "dall-e-3", "gpt-4o"]),
        default_model: "stress-model",
        priority: 50,
        weight: 1,
        is_active: 1,
        timeout_ms: 10000,
        custom_headers: "{}",
        health_status: "healthy",
        last_latency_ms: 80,
        last_checked_at: null,
        last_error: null,
      });
    }

    // -------------------------------------------------------------------------
    // 3.1: 50 Simultaneous Parallel Requests to aiRouter under Healthy Conditions
    // -------------------------------------------------------------------------
    console.log("--- 3.1: 50 Concurrent Requests selecting High-Priority Channel ---");
    resetConcurrencyChannels();

    let callsA = 0;
    let callsB = 0;
    let callsC = 0;

    handlerA = (_req, res) => {
      callsA++;
      const simulatedLatency = Math.floor(Math.random() * 20) + 5; // 5-25ms
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [{ url: `https://example.com/img_${Date.now()}.png` }] }));
      }, simulatedLatency);
    };

    handlerB = (_req, res) => {
      callsB++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ url: "https://example.com/b.png" }] }));
    };

    handlerC = (_req, res) => {
      callsC++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ url: "https://example.com/c.png" }] }));
    };

    const CONCURRENCY_N = 50;
    const startConcur1 = Date.now();

    const promises50 = Array.from({ length: CONCURRENCY_N }, (_, idx) =>
      fetch(`${MAIN_URL}/api/ai/images/generations`, {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ prompt: `Concurrent test prompt #${idx}`, model: "stress-model" }),
      }).then(async (r) => {
        const text = await r.text();
        let data: any = text;
        try { data = JSON.parse(text); } catch {}
        return { status: r.status, data };
      })
    );

    const results50 = await Promise.all(promises50);
    const elapsed50 = Date.now() - startConcur1;

    const all200 = results50.every((r) => r.status === 200);
    const non200Count = results50.filter((r) => r.status !== 200).length;

    // Check DB state after 50 concurrent writes in WAL mode
    const chanAlphaPost50 = getAiChannelById(channelAlphaId);
    const walCheckAlpha = chanAlphaPost50?.health_status === "healthy" && (chanAlphaPost50?.last_latency_ms ?? 0) > 0;

    recordTest({
      id: "CONCURRENCY-HEALTHY-50",
      category: "Concurrency WAL",
      name: "50 simultaneous requests select Alpha by priority and update health in WAL mode without collision",
      status: all200 && callsA === CONCURRENCY_N && callsB === 0 && callsC === 0 && walCheckAlpha ? "PASS" : "FAIL",
      expected: { all200: true, callsA: CONCURRENCY_N, callsB: 0, callsC: 0, alphaHealthy: true },
      actual: { all200, callsA, callsB, callsC, alphaHealthy: chanAlphaPost50?.health_status === "healthy", non200Count },
      details: `Completed in ${elapsed50}ms. Channel Alpha last latency: ${chanAlphaPost50?.last_latency_ms}ms`,
    });

    // -------------------------------------------------------------------------
    // 3.2: 50 Concurrent Failover Storm: Alpha returns 429 -> Beta returns 200
    // -------------------------------------------------------------------------
    console.log("--- 3.2: 50 Concurrent Failover Storm (Alpha 429 -> Beta 200) ---");
    resetConcurrencyChannels();
    callsA = 0;
    callsB = 0;
    callsC = 0;

    handlerA = (_req, res) => {
      callsA++;
      const simDelay = Math.floor(Math.random() * 15) + 5;
      setTimeout(() => {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Alpha Rate Limited 429" } }));
      }, simDelay);
    };

    handlerB = (_req, res) => {
      callsB++;
      const simDelay = Math.floor(Math.random() * 15) + 5;
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [{ url: `https://example.com/beta_${Date.now()}.png` }] }));
      }, simDelay);
    };

    const startConcur2 = Date.now();
    const failoverPromises50 = Array.from({ length: CONCURRENCY_N }, (_, idx) =>
      fetch(`${MAIN_URL}/api/ai/images/generations`, {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ prompt: `Failover storm prompt #${idx}`, model: "stress-model" }),
      }).then(async (r) => {
        const text = await r.text();
        let data: any = text;
        try { data = JSON.parse(text); } catch {}
        return { status: r.status, data };
      })
    );

    const failoverResults50 = await Promise.all(failoverPromises50);
    const elapsedFailover = Date.now() - startConcur2;

    const allFailover200 = failoverResults50.every((r) => r.status === 200);
    const postAlpha = getAiChannelById(channelAlphaId);
    const postBeta = getAiChannelById(channelBetaId);

    recordTest({
      id: "CONCURRENCY-FAILOVER-STORM",
      category: "Concurrency WAL",
      name: "50 concurrent failover requests: Alpha 429 -> Beta 200 with concurrent WAL health updates",
      status: allFailover200 && callsA === CONCURRENCY_N && callsB === CONCURRENCY_N && callsC === 0 && postAlpha?.health_status === "degraded" && postBeta?.health_status === "healthy" ? "PASS" : "FAIL",
      expected: { all200: true, callsA: CONCURRENCY_N, callsB: CONCURRENCY_N, callsC: 0, alphaHealth: "degraded", betaHealth: "healthy" },
      actual: { all200: allFailover200, callsA, callsB, callsC, alphaHealth: postAlpha?.health_status, betaHealth: postBeta?.health_status },
      details: `Completed in ${elapsedFailover}ms. All 50 cleanly transitioned to Beta without SQLite locking errors.`,
    });

    // -------------------------------------------------------------------------
    // 3.3: Extreme 30-Client 3-Tier Failover Cascade: Alpha 500 -> Beta 429 -> Gamma 200
    // -------------------------------------------------------------------------
    console.log("--- 3.3: 30 Concurrent 3-Tier Cascading Failover (Alpha 500 -> Beta 429 -> Gamma 200) ---");
    resetConcurrencyChannels();
    callsA = 0;
    callsB = 0;
    callsC = 0;

    handlerA = (_req, res) => {
      callsA++;
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Alpha 500 Internal Error" } }));
    };

    handlerB = (_req, res) => {
      callsB++;
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Beta 429 Rate Limit" } }));
    };

    handlerC = (_req, res) => {
      callsC++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ url: `https://example.com/gamma_${Date.now()}.png` }] }));
    };

    const TIER_COUNT = 30;
    const tierPromises = Array.from({ length: TIER_COUNT }, (_, idx) =>
      fetch(`${MAIN_URL}/api/ai/images/generations`, {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ prompt: `3-Tier cascade prompt #${idx}`, model: "stress-model" }),
      }).then(async (r) => {
        const text = await r.text();
        let data: any = text;
        try { data = JSON.parse(text); } catch {}
        return { status: r.status, data };
      })
    );

    const tierResults = await Promise.all(tierPromises);
    const allTier200 = tierResults.every((r) => r.status === 200);

    const finalAlpha = getAiChannelById(channelAlphaId);
    const finalBeta = getAiChannelById(channelBetaId);
    const finalGamma = getAiChannelById(channelGammaId);

    recordTest({
      id: "CONCURRENCY-3TIER-CASCADE",
      category: "Concurrency WAL",
      name: "30 concurrent requests traverse 3-tier cascade: Alpha(500) -> Beta(429) -> Gamma(200)",
      status: allTier200 && callsA === TIER_COUNT && callsB === TIER_COUNT && callsC === TIER_COUNT && finalAlpha?.health_status === "degraded" && finalBeta?.health_status === "degraded" && finalGamma?.health_status === "healthy" ? "PASS" : "FAIL",
      expected: { all200: true, callsA: TIER_COUNT, callsB: TIER_COUNT, callsC: TIER_COUNT, alpha: "degraded", beta: "degraded", gamma: "healthy" },
      actual: { all200: allTier200, callsA, callsB, callsC, alpha: finalAlpha?.health_status, beta: finalBeta?.health_status, gamma: finalGamma?.health_status },
      details: "Total of 90 upstream calls across 3 tiers with concurrent WAL updates completed with zero errors.",
    });

    // -------------------------------------------------------------------------
    // 3.4: Concurrent Read-Write Contention: Channel Admin CRUD during Active AI Traffic
    // -------------------------------------------------------------------------
    console.log("--- 3.4: Concurrent Channel CRUD Writes alongside Heavy AI Proxy Load ---");
    resetConcurrencyChannels();
    callsA = 0;
    callsB = 0;
    callsC = 0;

    handlerA = (_req, res) => {
      callsA++;
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [{ url: "https://example.com/rw.png" }] }));
      }, 10);
    };

    // Launch 30 AI proxy requests
    const aiLoadPromises = Array.from({ length: 30 }, (_, idx) =>
      fetch(`${MAIN_URL}/api/ai/images/generations`, {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ prompt: `Contention test prompt #${idx}`, model: "stress-model" }),
      }).then((r) => r.status)
    );

    // Concurrently launch Admin CRUD operations: create, update priority, toggle status, list
    const adminCrudPromises = [
      // Create new channel
      fetch(`${MAIN_URL}/api/admin/channels`, {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
          name: "Concurrent Injected Channel",
          baseUrl: UPSTREAM_C_URL,
          apiKey: "sk-injected-999",
          models: ["stress-model"],
          priority: 300,
        }),
      }).then((r) => r.status),
      // Update Alpha priority
      fetch(`${MAIN_URL}/api/admin/channels/${channelAlphaId}`, {
        method: "PUT",
        headers: adminHeaders,
        body: JSON.stringify({
          priority: 150,
          name: "Channel Alpha (Updated Concurrently)",
        }),
      }).then((r) => r.status),
      // Toggle Beta status
      fetch(`${MAIN_URL}/api/admin/channels/${channelBetaId}/status`, {
        method: "PATCH",
        headers: adminHeaders,
        body: JSON.stringify({ isActive: false }),
      }).then((r) => r.status),
      // List channels
      fetch(`${MAIN_URL}/api/admin/channels`, {
        method: "GET",
        headers: adminHeaders,
      }).then((r) => r.status),
      // Toggle Beta back to true
      fetch(`${MAIN_URL}/api/admin/channels/${channelBetaId}/status`, {
        method: "PATCH",
        headers: adminHeaders,
        body: JSON.stringify({ isActive: true }),
      }).then((r) => r.status),
    ];

    const [aiStatuses, crudStatuses] = await Promise.all([
      Promise.all(aiLoadPromises),
      Promise.all(adminCrudPromises),
    ]);

    const allAiOk = aiStatuses.every((s) => s === 200);
    const allCrudOk = crudStatuses.every((s) => s === 200 || s === 201);

    // Clean injected channel
    db.prepare("DELETE FROM ai_channels WHERE name = 'Concurrent Injected Channel'").run();

    recordTest({
      id: "CONCURRENCY-RW-CONTENTION",
      category: "Concurrency WAL",
      name: "Concurrent Admin CRUD writes during active AI proxy load succeed without database lock or corruption",
      status: allAiOk && allCrudOk ? "PASS" : "FAIL",
      expected: { allAiOk: true, allCrudOk: true },
      actual: { allAiOk, allCrudOk, aiStatuses: `${aiStatuses.filter((s) => s === 200).length}/30 OK`, crudStatuses },
      details: "Simultaneous admin schema/table updates and proxy channel selection / health logging in SQLite WAL mode.",
    });

    // -------------------------------------------------------------------------
    // 3.5: Chat Completions Concurrency: Streaming and Non-Streaming Concurrent Calls
    // -------------------------------------------------------------------------
    console.log("--- 3.5: Concurrent Chat Completions with Failover ---");
    resetConcurrencyChannels();
    callsA = 0;
    callsB = 0;

    handlerA = (_req, res) => {
      callsA++;
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Alpha Chat Overloaded 503" } }));
    };

    handlerB = (_req, res) => {
      callsB++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Chat fallback ok" } }] }));
    };

    const chatPromises = Array.from({ length: 20 }, (_, idx) =>
      fetch(`${MAIN_URL}/api/ai/chat/completions`, {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
          messages: [{ role: "user", content: `Concurrent chat #${idx}` }],
          model: "stress-model",
          stream: false,
        }),
      }).then(async (r) => {
        const text = await r.text();
        let data: any = text;
        try { data = JSON.parse(text); } catch {}
        return { status: r.status, data };
      })
    );

    const chatResults = await Promise.all(chatPromises);
    const allChat200 = chatResults.every((r) => r.status === 200 && r.data?.choices?.[0]?.message?.content === "Chat fallback ok");

    recordTest({
      id: "CONCURRENCY-CHAT-FAILOVER",
      category: "Concurrency WAL",
      name: "20 concurrent chat completions fail over from Alpha 503 to Beta 200 concurrently",
      status: allChat200 && callsA === 20 && callsB === 20 ? "PASS" : "FAIL",
      expected: { all200: true, callsA: 20, callsB: 20 },
      actual: { all200: allChat200, callsA, callsB },
      details: "All 20 concurrent chat requests cleanly failed over and updated WAL health stats without deadlock.",
    });

  } finally {
    // Teardown
    db.prepare("DELETE FROM ai_channels WHERE id IN (?, ?, ?)").run(channelAlphaId, channelBetaId, channelGammaId);
    mockServerA.close();
    mockServerB.close();
    mockServerC.close();
    appServer.close();
  }

  // ===========================================================================
  // SUMMARY REPORT
  // ===========================================================================
  console.log("\n================================================================================");
  console.log("                        EMPIRICAL RESULTS SUMMARY                               ");
  console.log("================================================================================");

  let totalPass = 0;
  let totalFail = 0;

  for (const r of report) {
    if (r.status === "PASS") totalPass++;
    else totalFail++;
  }

  console.log(`Total Assertions Run: ${report.length}`);
  console.log(`  Passed:  ${totalPass}`);
  console.log(`  Failed:  ${totalFail}`);
  const verdict = totalFail === 0 ? "APPROVE" : "REQUEST_CHANGES";
  console.log(`\nOVERALL VERDICT: ${verdict}`);
  console.log("================================================================================\n");

  return { totalPass, totalFail, verdict, report };
}

runChallenger2Suite()
  .then(({ totalFail }) => {
    if (totalFail > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  })
  .catch((err) => {
    console.error("Fatal test execution error:", err);
    process.exit(2);
  });
