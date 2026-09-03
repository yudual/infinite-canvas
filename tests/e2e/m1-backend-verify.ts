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
  toChannelDto,
  listAiChannels,
  getAiChannelById,
  getActiveAiChannels,
  createAiChannel,
  updateAiChannel,
  deleteAiChannel,
  updateChannelHealth,
  type ChannelRecord,
} from "../../server/src/db.js";
import { JWT_SECRET } from "../../server/src/config.js";
import { AiRouter, getCandidateChannels, getAggregatedModels } from "../../server/src/services/ai-router.js";

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

// Helper to create test server
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

// Helper to create mock upstream AI servers
function createMockUpstream(port: number, handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

async function runM1Verification() {
  console.log("================================================================");
  console.log("🚀 STARTING M1 MULTI-CHANNEL BACKEND VERIFICATION");
  console.log("================================================================\n");

  const TEST_SERVER_PORT = 3888;
  const UPSTREAM_A_PORT = 3889; // Primary that fails with 429
  const UPSTREAM_B_PORT = 3890; // Fallback that succeeds with 200

  // 1. Start test backend server
  const server = await startTestServer(TEST_SERVER_PORT);
  const BASE_URL = `http://127.0.0.1:${TEST_SERVER_PORT}`;

  // Upstream state trackers
  let upstreamACalls = 0;
  let upstreamBCalls = 0;
  let upstreamAAuthHeader = "";
  let upstreamBAuthHeader = "";

  // 2. Start mock upstream servers
  const mockUpstreamA = await createMockUpstream(UPSTREAM_A_PORT, (req, res) => {
    upstreamACalls++;
    upstreamAAuthHeader = req.headers["authorization"] || "";
    const url = req.url || "";

    if (url.includes("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "failover-model" }, { id: "dall-e-3" }] }));
      return;
    }

    // Fail all completions / generations with 429
    res.writeHead(429, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Rate limit exceeded on upstream A", code: 429 } }));
  });

  const mockUpstreamB = await createMockUpstream(UPSTREAM_B_PORT, (req, res) => {
    upstreamBCalls++;
    upstreamBAuthHeader = req.headers["authorization"] || "";
    const url = req.url || "";

    if (url.includes("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "failover-model" }, { id: "gpt-4o" }] }));
      return;
    }

    if (url.includes("/images/generations")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ url: "https://mock.cdn/gen1.png" }] }));
      return;
    }

    if (url.includes("/chat/completions")) {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const bodyStr = Buffer.concat(chunks).toString("utf-8");
        const isStream = bodyStr.includes('"stream":true');
        if (isStream) {
          res.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          });
          res.write('data: {"choices":[{"delta":{"content":"Hello from backup channel"}}]}\n\n');
          res.write("data: [DONE]\n\n");
          res.end();
        } else {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ choices: [{ message: { content: "Hello from backup channel" } }] }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  try {
    // Ensure valid admin exists in DB for authenticateToken check
    let adminUser = db.prepare("SELECT * FROM users WHERE role = 'admin' AND status = 'active' LIMIT 1").get() as any;
    if (!adminUser) {
      const id = "admin-test-" + Date.now();
      const now = new Date().toISOString();
      db.prepare("INSERT INTO users (id, username, password_hash, display_name, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
        id, "testadmin_" + Date.now(), "hash", "Admin", "admin", "active", now, now
      );
      adminUser = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    }

    // Generate valid admin token
    const adminToken = jwt.sign(
      { userId: adminUser.id, username: adminUser.username, role: "admin" },
      JWT_SECRET,
      { expiresIn: "1h" }
    );
    const authHeaders = {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    };

    // ========================================================================
    // SECTION 1: Database Schema & Migration & Auto-seeding Verification
    // ========================================================================
    // Clean up any mock channels from previous test runs
    db.prepare("DELETE FROM ai_channels WHERE name LIKE 'Mock %'").run();

    console.log("\n>>> SECTION 1: Schema & DAO Helper Verification <<<");
    const tableRows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ai_channels'").all();
    assert("SCHEMA", "ai_channels table exists", tableRows.length === 1, "ai_channels table found in SQLite master");

    const indexRows = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_ai_channels_active_priority'").all();
    assert("SCHEMA", "idx_ai_channels_active_priority index exists", indexRows.length === 1, "Index found in SQLite master");

    const initialList = listAiChannels();
    assert("SCHEMA", "Initial channels seeded or accessible", initialList.total >= 0, `Total channels count: ${initialList.total}`);

    // ========================================================================
    // SECTION 2: Admin AI Channels CRUD Endpoints
    // ========================================================================
    console.log("\n>>> SECTION 2: Admin AI Channels CRUD API Verification <<<");

    // 2.1 POST /api/admin/channels - Create Channel A (Primary)
    const secretKeyA = "sk-upstream-secret-key-aaaa-1111";
    const createResA = await fetch(`${BASE_URL}/api/admin/channels`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        name: "Mock Primary Provider A",
        providerType: "openai",
        baseUrl: `http://127.0.0.1:${UPSTREAM_A_PORT}/v1`,
        apiKey: secretKeyA,
        models: ["failover-model", "dall-e-3"],
        defaultModel: "failover-model",
        priority: 100, // High priority
        weight: 1,
        isActive: true,
        timeoutMs: 5000,
      }),
    });
    const createDataA = await createResA.json();
    assert("CRUD", "Create Channel A returns 201 Created", createResA.status === 201, `Status: ${createResA.status}`);
    assert("CRUD", "Channel A apiKey is masked in response", createDataA.channel?.apiKeyMasked.includes("****"), `Masked: ${createDataA.channel?.apiKeyMasked}`);
    assert("CRUD", "Channel A raw apiKey is NOT leaked", !JSON.stringify(createDataA).includes(secretKeyA), "Zero key leak in create response");
    const channelIdA = createDataA.channel.id;

    // 2.2 POST /api/admin/channels - Create Channel B (Fallback)
    const secretKeyB = "sk-upstream-secret-key-bbbb-2222";
    const createResB = await fetch(`${BASE_URL}/api/admin/channels`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        name: "Mock Fallback Provider B",
        providerType: "openai",
        baseUrl: `http://127.0.0.1:${UPSTREAM_B_PORT}/v1`,
        apiKey: secretKeyB,
        models: ["failover-model", "gpt-4o"],
        defaultModel: "failover-model",
        priority: 50, // Lower priority
        weight: 1,
        isActive: true,
        timeoutMs: 5000,
      }),
    });
    const createDataB = await createResB.json();
    assert("CRUD", "Create Channel B returns 201 Created", createResB.status === 201, `Status: ${createResB.status}`);
    const channelIdB = createDataB.channel.id;

    // 2.3 GET /api/admin/channels - List with search
    const listRes = await fetch(`${BASE_URL}/api/admin/channels?search=Mock+Primary&status=active`, {
      headers: authHeaders,
    });
    const listData = await listRes.json();
    assert("CRUD", "List channels filters by search term", listData.channels.length >= 1 && listData.channels[0].id === channelIdA, `Found: ${listData.channels.length} channels`);

    // 2.4 GET /api/admin/channels/:id - Single retrieval
    const getRes = await fetch(`${BASE_URL}/api/admin/channels/${channelIdA}`, {
      headers: authHeaders,
    });
    const getData = await getRes.json();
    assert("CRUD", "Get single channel returns channel", getData.success === true && getData.channel.id === channelIdA, `Channel id: ${getData.channel?.id}`);

    // 2.5 PUT /api/admin/channels/:id - Update retaining masked key
    const updateRes = await fetch(`${BASE_URL}/api/admin/channels/${channelIdA}`, {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({
        name: "Mock Primary Provider A (Updated Name)",
        apiKey: "sk-****1111", // Masked key sent back
        priority: 95,
      }),
    });
    const updateData = await updateRes.json();
    assert("CRUD", "Update channel returns 200", updateRes.status === 200, `Status: ${updateRes.status}`);
    assert("CRUD", "Update channel updated name", updateData.channel.name === "Mock Primary Provider A (Updated Name)", `Name: ${updateData.channel.name}`);
    // Verify in database that original secretKeyA was preserved
    const dbRecordA = getAiChannelById(channelIdA)!;
    assert("CRUD", "Preserves existing API key when masked key submitted", dbRecordA.api_key === secretKeyA, "Original key preserved in DB");

    // 2.6 POST /api/admin/channels/:id/test - Connectivity probe
    const testProbeRes = await fetch(`${BASE_URL}/api/admin/channels/${channelIdA}/test`, {
      method: "POST",
      headers: authHeaders,
    });
    const testProbeData = await testProbeRes.json();
    assert("PROBE", "Channel test probe returns success and latencyMs", testProbeData.success === true && typeof testProbeData.latencyMs === "number", `Latency: ${testProbeData.latencyMs}ms, message: ${testProbeData.message}`);

    // 2.7 POST /api/admin/channels/:id/sync-models - Sync models
    const syncRes = await fetch(`${BASE_URL}/api/admin/channels/${channelIdB}/sync-models`, {
      method: "POST",
      headers: authHeaders,
    });
    const syncData = await syncRes.json();
    assert("SYNC", "Sync models categorizes models", syncData.success === true && syncData.total >= 1, `Total synced: ${syncData.total}, imageModels: ${syncData.imageModels?.length}, chatModels: ${syncData.chatModels?.length}`);

    // 2.8 PATCH /api/admin/channels/:id/status - Toggle active
    const patchRes = await fetch(`${BASE_URL}/api/admin/channels/${channelIdA}/status`, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({ isActive: true }),
    });
    const patchData = await patchRes.json();
    assert("CRUD", "Patch status updates active state", patchData.isActive === true, `Active state: ${patchData.isActive}`);

    // ========================================================================
    // SECTION 3: Intelligent Multi-Channel Router & Automatic Failover
    // ========================================================================
    console.log("\n>>> SECTION 3: Multi-Channel Failover Verification <<<");
    upstreamACalls = 0;
    upstreamBCalls = 0;

    // Call /api/ai/images/generations requesting 'failover-model'
    // Channel A is Priority 95, Channel B is Priority 50.
    // Upstream A will return HTTP 429.
    // The router MUST automatically failover to Channel B and succeed with 200 OK!
    const genRes = await fetch(`${BASE_URL}/api/ai/images/generations`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        prompt: "A high-tech digital galaxy on infinite canvas",
        model: "failover-model",
        size: "1024x1024",
      }),
    });
    const genData = await genRes.json();

    assert("FAILOVER", "Image generation succeeds with 200 OK despite Primary failing 429", genRes.status === 200, `Response status: ${genRes.status}`);
    assert("FAILOVER", "Primary Channel A was attempted first", upstreamACalls === 1, `Upstream A calls: ${upstreamACalls}`);
    assert("FAILOVER", "Fallback Channel B was called on failover", upstreamBCalls === 1, `Upstream B calls: ${upstreamBCalls}`);
    assert("FAILOVER", "Response contains image from fallback channel", Array.isArray(genData.data) && genData.data[0].url === "https://mock.cdn/gen1.png", `URL: ${genData.data?.[0]?.url}`);
    assert("SECURITY", "Zero API key leak in failover response", !JSON.stringify(genData).includes(secretKeyA) && !JSON.stringify(genData).includes(secretKeyB), "No secret keys leaked");

    // Verify Channel A health status was marked 'degraded' in DB
    const channelAAfter = getAiChannelById(channelIdA)!;
    assert("ROUTER_HEALTH", "Channel A marked degraded after 429 failure", channelAAfter.health_status === "degraded", `Status: ${channelAAfter.health_status}`);

    // Verify Channel B health status is marked 'healthy'
    const channelBAfter = getAiChannelById(channelIdB)!;
    assert("ROUTER_HEALTH", "Channel B marked healthy after 200 success", channelBAfter.health_status === "healthy", `Status: ${channelBAfter.health_status}`);

    // ========================================================================
    // SECTION 4: Chat Completion with Streaming & Non-Streaming
    // ========================================================================
    console.log("\n>>> SECTION 4: Chat Completion & Streaming Verification <<<");
    upstreamACalls = 0;
    upstreamBCalls = 0;

    // Non-streaming chat completion
    const chatRes = await fetch(`${BASE_URL}/api/ai/chat/completions`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        messages: [{ role: "user", content: "Test message" }],
        model: "failover-model",
        stream: false,
      }),
    });
    const chatData = await chatRes.json();
    assert("CHAT", "Non-streaming chat fails over and returns 200", chatRes.status === 200, `Status: ${chatRes.status}`);
    assert("CHAT", "Non-streaming response from backup", chatData.choices?.[0]?.message?.content === "Hello from backup channel", `Content: ${chatData.choices?.[0]?.message?.content}`);

    // Streaming chat completion (SSE)
    upstreamACalls = 0;
    upstreamBCalls = 0;
    const streamRes = await fetch(`${BASE_URL}/api/ai/chat/completions`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        messages: [{ role: "user", content: "Stream test" }],
        model: "failover-model",
        stream: true,
      }),
    });
    const streamText = await streamRes.text();
    assert("SSE", "Streaming chat returns 200 OK text/event-stream", streamRes.status === 200, `Status: ${streamRes.status}`);
    assert("SSE", "Streaming received SSE chunks from backup channel", streamText.includes("Hello from backup channel"), `Stream chunk received`);
    assert("SECURITY", "Zero key leak in stream output", !streamText.includes(secretKeyA) && !streamText.includes(secretKeyB), "Stream sanitized");

    // ========================================================================
    // SECTION 5: Models Aggregation
    // ========================================================================
    console.log("\n>>> SECTION 5: Aggregated Models Verification <<<");
    const modelsRes = await fetch(`${BASE_URL}/api/ai/models`, {
      headers: authHeaders,
    });
    const modelsData = await modelsRes.json();
    assert("MODELS", "GET /api/ai/models returns 200 OK", modelsRes.status === 200, `Status: ${modelsRes.status}`);
    assert("MODELS", "Aggregated models include failover-model", modelsData.imageModels.includes("failover-model") || modelsData.chatModels.includes("failover-model"), "Discovered model present in models list");

    // ========================================================================
    // SECTION 6: Cleanup & Channel Deletion
    // ========================================================================
    console.log("\n>>> SECTION 6: Channel Deletion Verification <<<");
    const delResA = await fetch(`${BASE_URL}/api/admin/channels/${channelIdA}`, {
      method: "DELETE",
      headers: authHeaders,
    });
    assert("CRUD", "Delete Channel A returns 200", delResA.status === 200, `Status: ${delResA.status}`);
    assert("CRUD", "Channel A is removed from DB", getAiChannelById(channelIdA) === null, "Channel row deleted");

    const delResB = await fetch(`${BASE_URL}/api/admin/channels/${channelIdB}`, {
      method: "DELETE",
      headers: authHeaders,
    });
    assert("CRUD", "Delete Channel B returns 200", delResB.status === 200, `Status: ${delResB.status}`);
    assert("CRUD", "Channel B is removed from DB", getAiChannelById(channelIdB) === null, "Channel row deleted");

    console.log("\n================================================================");
    console.log(`🎉 ALL ${testResults.length} VERIFICATION ASSERTIONS PASSED!`);
    console.log("================================================================\n");
  } finally {
    // Close servers
    server.close();
    mockUpstreamA.close();
    mockUpstreamB.close();
  }
}

runM1Verification()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Verification failed with error:", err);
    process.exit(1);
  });
