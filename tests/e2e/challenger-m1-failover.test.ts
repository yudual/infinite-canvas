import http from "node:http";
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
  expectedStatus: number | number[];
  actualStatus: number;
  expectedChannelHealth?: Record<string, string>;
  actualChannelHealth?: Record<string, string>;
  upstreamACalls: number;
  upstreamBCalls: number;
  keyLeakDetected: boolean;
  notes: string;
  logs: string[];
}

const testReports: TestReportItem[] = [];

// Ports for this test run
const MAIN_SERVER_PORT = 3890;
const UPSTREAM_A_PORT = 3891;
const UPSTREAM_B_PORT = 3892;

const MAIN_URL = `http://127.0.0.1:${MAIN_SERVER_PORT}`;
const UPSTREAM_A_URL = `http://127.0.0.1:${UPSTREAM_A_PORT}`;
const UPSTREAM_B_URL = `http://127.0.0.1:${UPSTREAM_B_PORT}`;

const SECRET_KEY_A = "sk-mock-primary-super-secret-key-11111111";
const SECRET_KEY_B = "sk-mock-secondary-super-secret-key-22222222";

let upstreamAHandler: (req: http.IncomingMessage, res: http.ServerResponse) => void = () => {};
let upstreamBHandler: (req: http.IncomingMessage, res: http.ServerResponse) => void = () => {};

let upstreamACallCount = 0;
let upstreamBCallCount = 0;

function createMockServer(port: number, handlerSelector: () => (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      handlerSelector()(req, res);
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

function checkKeyLeak(text: string): boolean {
  if (!text) return false;
  return text.includes(SECRET_KEY_A) || text.includes(SECRET_KEY_B);
}

async function runAdversarialSuite() {
  console.log("================================================================================");
  console.log("       🔥 Adversarial Failover Stress-Test Harness — Milestone M1               ");
  console.log("================================================================================\n");

  initSchema();

  // Clean old test channels
  db.prepare("DELETE FROM ai_channels WHERE id LIKE 'mock-adv-%'").run();

  // Setup Admin / User for auth
  let adminUser = db.prepare("SELECT * FROM users WHERE role = 'admin' AND status = 'active' LIMIT 1").get() as any;
  if (!adminUser) {
    const now = new Date().toISOString();
    const id = "admin-adv-" + Date.now();
    db.prepare(
      "INSERT INTO users (id, username, password_hash, display_name, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(id, "advadmin_" + Date.now(), "hash", "Adversarial Admin", "admin", "active", now, now);
    adminUser = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  }

  const token = jwt.sign(
    { userId: adminUser.id, username: adminUser.username, role: adminUser.role },
    JWT_SECRET,
    { expiresIn: "1h" }
  );

  const authHeaders = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  // Start servers
  const mockA = await createMockServer(UPSTREAM_A_PORT, () => upstreamAHandler);
  const mockB = await createMockServer(UPSTREAM_B_PORT, () => upstreamBHandler);
  const mainApp = await startAppServer(MAIN_SERVER_PORT);

  const channelAId = "mock-adv-chan-a";
  const channelBId = "mock-adv-chan-b";

  try {
    // -------------------------------------------------------------------------
    // Helper to configure channels A & B
    // -------------------------------------------------------------------------
    function setupChannels(opts: { timeoutMsA?: number; timeoutMsB?: number } = {}) {
      db.prepare("DELETE FROM ai_channels WHERE id IN (?, ?)").run(channelAId, channelBId);
      
      createAiChannel({
        id: channelAId,
        name: "Mock Primary Channel A",
        provider_type: "openai",
        base_url: UPSTREAM_A_URL,
        api_key: SECRET_KEY_A,
        models: JSON.stringify(["adv-model", "dall-e-3", "gpt-4o"]),
        default_model: "adv-model",
        priority: 100, // higher priority
        weight: 1,
        is_active: 1,
        timeout_ms: opts.timeoutMsA || 5000,
        custom_headers: "{}",
      });

      createAiChannel({
        id: channelBId,
        name: "Mock Secondary Channel B",
        provider_type: "openai",
        base_url: UPSTREAM_B_URL,
        api_key: SECRET_KEY_B,
        models: JSON.stringify(["adv-model", "dall-e-3", "gpt-4o"]),
        default_model: "adv-model",
        priority: 50, // lower priority
        weight: 1,
        is_active: 1,
        timeout_ms: opts.timeoutMsB || 5000,
        custom_headers: "{}",
      });
    }

    // =========================================================================
    // TEST 1: Primary Channel returning HTTP 429 -> Failover to Secondary 200
    // =========================================================================
    console.log(">>> [TEST 1] Primary HTTP 429 -> Secondary HTTP 200 <<<");
    setupChannels();
    upstreamACallCount = 0;
    upstreamBCallCount = 0;

    upstreamAHandler = (req, res) => {
      upstreamACallCount++;
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Rate limit reached on Primary", code: "rate_limit_exceeded" } }));
    };

    upstreamBHandler = (req, res) => {
      upstreamBCallCount++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ url: "https://mock.cdn/image_secondary_200.png" }] }));
    };

    const res1 = await fetch(`${MAIN_URL}/api/ai/images/generations`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ prompt: "A test prompt", model: "adv-model" }),
    });
    const text1 = await res1.text();
    let data1: any = text1;
    try { data1 = JSON.parse(text1); } catch {}

    const chanA_1 = getAiChannelById(channelAId);
    const chanB_1 = getAiChannelById(channelBId);
    const leaked1 = checkKeyLeak(text1);

    const pass1 = res1.status === 200 &&
      upstreamACallCount === 1 &&
      upstreamBCallCount === 1 &&
      data1?.data?.[0]?.url === "https://mock.cdn/image_secondary_200.png" &&
      chanA_1?.health_status === "degraded" &&
      chanB_1?.health_status === "healthy" &&
      !leaked1;

    testReports.push({
      id: "FAILOVER-429",
      category: "Failover 429",
      name: "Primary 429 RateLimit triggers failover to Secondary 200",
      status: pass1 ? "PASS" : "FAIL",
      expectedStatus: 200,
      actualStatus: res1.status,
      expectedChannelHealth: { [channelAId]: "degraded", [channelBId]: "healthy" },
      actualChannelHealth: { [channelAId]: chanA_1?.health_status || "unknown", [channelBId]: chanB_1?.health_status || "unknown" },
      upstreamACalls: upstreamACallCount,
      upstreamBCalls: upstreamBCallCount,
      keyLeakDetected: leaked1,
      notes: pass1 ? "Successfully failed over from 429 to 200, health status updated" : "Failover or health update failed",
      logs: [`Status: ${res1.status}`, `Body: ${text1}`],
    });
    console.log(`Result: ${pass1 ? "PASS" : "FAIL"} | Status: ${res1.status} | Upstream A: ${upstreamACallCount} | Upstream B: ${upstreamBCallCount}\n`);

    // =========================================================================
    // TEST 2A: Primary Channel returning HTTP 500 -> Failover to Secondary 200
    // =========================================================================
    console.log(">>> [TEST 2A] Primary HTTP 500 -> Secondary HTTP 200 <<<");
    setupChannels();
    upstreamACallCount = 0;
    upstreamBCallCount = 0;

    upstreamAHandler = (req, res) => {
      upstreamACallCount++;
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Internal server error on Primary", code: 500 } }));
    };

    upstreamBHandler = (req, res) => {
      upstreamBCallCount++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ url: "https://mock.cdn/image_secondary_after_500.png" }] }));
    };

    const res2a = await fetch(`${MAIN_URL}/api/ai/images/generations`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ prompt: "A test prompt for 500 failover", model: "adv-model" }),
    });
    const text2a = await res2a.text();
    let data2a: any = text2a;
    try { data2a = JSON.parse(text2a); } catch {}

    const chanA_2a = getAiChannelById(channelAId);
    const chanB_2a = getAiChannelById(channelBId);
    const leaked2a = checkKeyLeak(text2a);

    const pass2a = res2a.status === 200 &&
      upstreamACallCount === 1 &&
      upstreamBCallCount === 1 &&
      data2a?.data?.[0]?.url === "https://mock.cdn/image_secondary_after_500.png" &&
      chanA_2a?.health_status === "degraded" &&
      chanB_2a?.health_status === "healthy" &&
      !leaked2a;

    testReports.push({
      id: "FAILOVER-500",
      category: "Failover 500",
      name: "Primary 500 ServerError triggers failover to Secondary 200",
      status: pass2a ? "PASS" : "FAIL",
      expectedStatus: 200,
      actualStatus: res2a.status,
      expectedChannelHealth: { [channelAId]: "degraded", [channelBId]: "healthy" },
      actualChannelHealth: { [channelAId]: chanA_2a?.health_status || "unknown", [channelBId]: chanB_2a?.health_status || "unknown" },
      upstreamACalls: upstreamACallCount,
      upstreamBCalls: upstreamBCallCount,
      keyLeakDetected: leaked2a,
      notes: pass2a ? "Successfully failed over from 500 to 200" : "500 failover failed",
      logs: [`Status: ${res2a.status}`, `Body: ${text2a}`],
    });
    console.log(`Result: ${pass2a ? "PASS" : "FAIL"} | Status: ${res2a.status} | Upstream A: ${upstreamACallCount} | Upstream B: ${upstreamBCallCount}\n`);

    // =========================================================================
    // TEST 2B: Primary Channel returning HTTP 502 -> Failover to Secondary 200
    // =========================================================================
    console.log(">>> [TEST 2B] Primary HTTP 502 -> Secondary HTTP 200 <<<");
    setupChannels();
    upstreamACallCount = 0;
    upstreamBCallCount = 0;

    upstreamAHandler = (req, res) => {
      upstreamACallCount++;
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Bad Gateway on Primary", code: 502 } }));
    };

    upstreamBHandler = (req, res) => {
      upstreamBCallCount++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ url: "https://mock.cdn/image_secondary_after_502.png" }] }));
    };

    const res2b = await fetch(`${MAIN_URL}/api/ai/images/generations`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ prompt: "A test prompt for 502 failover", model: "adv-model" }),
    });
    const text2b = await res2b.text();
    let data2b: any = text2b;
    try { data2b = JSON.parse(text2b); } catch {}

    const chanA_2b = getAiChannelById(channelAId);
    const chanB_2b = getAiChannelById(channelBId);
    const leaked2b = checkKeyLeak(text2b);

    const pass2b = res2b.status === 200 &&
      upstreamACallCount === 1 &&
      upstreamBCallCount === 1 &&
      data2b?.data?.[0]?.url === "https://mock.cdn/image_secondary_after_502.png" &&
      chanA_2b?.health_status === "degraded" &&
      chanB_2b?.health_status === "healthy" &&
      !leaked2b;

    testReports.push({
      id: "FAILOVER-502",
      category: "Failover 502",
      name: "Primary 502 BadGateway triggers failover to Secondary 200",
      status: pass2b ? "PASS" : "FAIL",
      expectedStatus: 200,
      actualStatus: res2b.status,
      expectedChannelHealth: { [channelAId]: "degraded", [channelBId]: "healthy" },
      actualChannelHealth: { [channelAId]: chanA_2b?.health_status || "unknown", [channelBId]: chanB_2b?.health_status || "unknown" },
      upstreamACalls: upstreamACallCount,
      upstreamBCalls: upstreamBCallCount,
      keyLeakDetected: leaked2b,
      notes: pass2b ? "Successfully failed over from 502 to 200" : "502 failover failed",
      logs: [`Status: ${res2b.status}`, `Body: ${text2b}`],
    });
    console.log(`Result: ${pass2b ? "PASS" : "FAIL"} | Status: ${res2b.status} | Upstream A: ${upstreamACallCount} | Upstream B: ${upstreamBCallCount}\n`);

    // =========================================================================
    // TEST 3: Primary Channel timing out / aborting -> Failover to Secondary 200
    // =========================================================================
    console.log(">>> [TEST 3] Primary Timeout / Abort -> Secondary HTTP 200 <<<");
    // Set channel A timeout to 800ms
    setupChannels({ timeoutMsA: 800, timeoutMsB: 5000 });
    upstreamACallCount = 0;
    upstreamBCallCount = 0;

    upstreamAHandler = (req, res) => {
      upstreamACallCount++;
      // Upstream A hangs and does not respond within 800ms
      setTimeout(() => {
        if (!res.writableEnded) {
          res.writeHead(200);
          res.end("too late");
        }
      }, 3000);
    };

    upstreamBHandler = (req, res) => {
      upstreamBCallCount++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ url: "https://mock.cdn/image_secondary_after_timeout.png" }] }));
    };

    const start3 = Date.now();
    const res3 = await fetch(`${MAIN_URL}/api/ai/images/generations`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ prompt: "A test prompt for timeout failover", model: "adv-model" }),
    });
    const elapsed3 = Date.now() - start3;
    const text3 = await res3.text();
    let data3: any = text3;
    try { data3 = JSON.parse(text3); } catch {}

    const chanA_3 = getAiChannelById(channelAId);
    const chanB_3 = getAiChannelById(channelBId);
    const leaked3 = checkKeyLeak(text3);

    const pass3 = res3.status === 200 &&
      upstreamACallCount === 1 &&
      upstreamBCallCount === 1 &&
      data3?.data?.[0]?.url === "https://mock.cdn/image_secondary_after_timeout.png" &&
      chanA_3?.health_status === "degraded" &&
      chanB_3?.health_status === "healthy" &&
      elapsed3 >= 700 && elapsed3 < 2500 &&
      !leaked3;

    testReports.push({
      id: "FAILOVER-TIMEOUT",
      category: "Failover Timeout",
      name: "Primary timeout abort triggers failover to Secondary 200",
      status: pass3 ? "PASS" : "FAIL",
      expectedStatus: 200,
      actualStatus: res3.status,
      expectedChannelHealth: { [channelAId]: "degraded", [channelBId]: "healthy" },
      actualChannelHealth: { [channelAId]: chanA_3?.health_status || "unknown", [channelBId]: chanB_3?.health_status || "unknown" },
      upstreamACalls: upstreamACallCount,
      upstreamBCalls: upstreamBCallCount,
      keyLeakDetected: leaked3,
      notes: pass3 ? `Failed over after timeout (${elapsed3}ms)` : `Timeout failover failed (${elapsed3}ms)`,
      logs: [`Status: ${res3.status}`, `Elapsed: ${elapsed3}ms`, `Body: ${text3}`],
    });
    console.log(`Result: ${pass3 ? "PASS" : "FAIL"} | Status: ${res3.status} | Elapsed: ${elapsed3}ms | Upstream A: ${upstreamACallCount} | Upstream B: ${upstreamBCallCount}\n`);

    // =========================================================================
    // TEST 4A: Client-side error (Empty Prompt) -> 400 Bad Request, NO FAILOVER
    // =========================================================================
    console.log(">>> [TEST 4A] Client error (Empty Prompt) -> 400, Zero Upstream Calls <<<");
    setupChannels();
    upstreamACallCount = 0;
    upstreamBCallCount = 0;

    const res4a = await fetch(`${MAIN_URL}/api/ai/images/generations`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ prompt: "   ", model: "adv-model" }),
    });
    const text4a = await res4a.text();
    const leaked4a = checkKeyLeak(text4a);

    const pass4a = res4a.status === 400 &&
      upstreamACallCount === 0 &&
      upstreamBCallCount === 0 &&
      !leaked4a;

    testReports.push({
      id: "CLIENT-400-VALIDATION",
      category: "Client Error 400",
      name: "Empty prompt rejected at API boundary with 400 and NO upstream calls",
      status: pass4a ? "PASS" : "FAIL",
      expectedStatus: 400,
      actualStatus: res4a.status,
      upstreamACalls: upstreamACallCount,
      upstreamBCalls: upstreamBCallCount,
      keyLeakDetected: leaked4a,
      notes: pass4a ? "Rejected at boundary with zero upstream calls" : "Validation failed or upstream called",
      logs: [`Status: ${res4a.status}`, `Body: ${text4a}`],
    });
    console.log(`Result: ${pass4a ? "PASS" : "FAIL"} | Status: ${res4a.status} | Upstream A: ${upstreamACallCount} | Upstream B: ${upstreamBCallCount}\n`);

    // =========================================================================
    // TEST 4B: Upstream returns HTTP 400 Bad Request -> Return 400, NO FAILOVER
    // =========================================================================
    console.log(">>> [TEST 4B] Upstream returns HTTP 400 -> Return 400, NO FAILOVER Attempted <<<");
    setupChannels();
    upstreamACallCount = 0;
    upstreamBCallCount = 0;

    upstreamAHandler = (req, res) => {
      upstreamACallCount++;
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Invalid parameter: width must be divisible by 8", type: "invalid_request_error" } }));
    };

    upstreamBHandler = (req, res) => {
      upstreamBCallCount++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ url: "https://mock.cdn/should_never_reach_here.png" }] }));
    };

    const res4b = await fetch(`${MAIN_URL}/api/ai/images/generations`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ prompt: "Valid prompt", model: "adv-model", width: 999 }),
    });
    const text4b = await res4b.text();
    let data4b: any = text4b;
    try { data4b = JSON.parse(text4b); } catch {}
    const leaked4b = checkKeyLeak(text4b);

    const pass4b = res4b.status === 400 &&
      upstreamACallCount === 1 &&
      upstreamBCallCount === 0 &&
      !leaked4b;

    testReports.push({
      id: "UPSTREAM-400-NO-FAILOVER",
      category: "Client Error 400",
      name: "Upstream 400 Bad Request returned directly without triggering failover",
      status: pass4b ? "PASS" : "FAIL",
      expectedStatus: 400,
      actualStatus: res4b.status,
      upstreamACalls: upstreamACallCount,
      upstreamBCalls: upstreamBCallCount,
      keyLeakDetected: leaked4b,
      notes: pass4b ? "Correctly identified 400 as non-retriable, secondary was NOT called" : "Failover mistakenly triggered or wrong status returned",
      logs: [`Status: ${res4b.status}`, `Body: ${text4b}`, `Upstream A calls: ${upstreamACallCount}`, `Upstream B calls: ${upstreamBCallCount}`],
    });
    console.log(`Result: ${pass4b ? "PASS" : "FAIL"} | Status: ${res4b.status} | Upstream A: ${upstreamACallCount} | Upstream B: ${upstreamBCallCount}\n`);

    // =========================================================================
    // TEST 5A: All Channels Failing with 500 / 502 -> Verify Status & Zero Key Leak
    // =========================================================================
    console.log(">>> [TEST 5A] All Channels Failing with 500/502 (Hostile Key Echo) <<<");
    setupChannels();
    upstreamACallCount = 0;
    upstreamBCallCount = 0;

    // Upstream A deliberately echoes secret key A in error
    upstreamAHandler = (req, res) => {
      upstreamACallCount++;
      const auth = req.headers["authorization"] || "";
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        error: {
          message: `Internal error processing with auth ${auth} on Channel A`,
          exposed_key: SECRET_KEY_A,
        },
      }));
    };

    // Upstream B also fails with 502 and deliberately echoes secret key B
    upstreamBHandler = (req, res) => {
      upstreamBCallCount++;
      const auth = req.headers["authorization"] || "";
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        error: {
          message: `Bad Gateway with auth ${auth} on Channel B`,
          exposed_key: SECRET_KEY_B,
        },
      }));
    };

    const res5a = await fetch(`${MAIN_URL}/api/ai/images/generations`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ prompt: "Prompt when all channels fail", model: "adv-model" }),
    });
    const text5a = await res5a.text();
    let data5a: any = text5a;
    try { data5a = JSON.parse(text5a); } catch {}
    const leaked5a = checkKeyLeak(text5a);

    const chanA_5a = getAiChannelById(channelAId);
    const chanB_5a = getAiChannelById(channelBId);

    // Requirement from user: All channels failing -> verify HTTP 502 Bad Gateway returned with zero API keys leaked.
    const pass5a = (res5a.status === 502) &&
      upstreamACallCount === 1 &&
      upstreamBCallCount === 1 &&
      !leaked5a;

    testReports.push({
      id: "ALL-CHANNELS-500-502",
      category: "All Channels Failing",
      name: "All channels failing with 5xx: verify 502 Bad Gateway and zero key leak",
      status: pass5a ? "PASS" : "FAIL",
      expectedStatus: 502,
      actualStatus: res5a.status,
      expectedChannelHealth: { [channelAId]: "degraded/unhealthy", [channelBId]: "degraded/unhealthy" },
      actualChannelHealth: { [channelAId]: chanA_5a?.health_status || "unknown", [channelBId]: chanB_5a?.health_status || "unknown" },
      upstreamACalls: upstreamACallCount,
      upstreamBCalls: upstreamBCallCount,
      keyLeakDetected: leaked5a,
      notes: pass5a
        ? "Returned 502 with zero leaked keys despite upstream echoing raw secret keys"
        : `Status mismatch or failure: Expected 502, got ${res5a.status}. Key leak: ${leaked5a}. Channel B health: ${chanB_5a?.health_status}`,
      logs: [
        `Status: ${res5a.status}`,
        `Body: ${text5a}`,
        `Channel A health: ${chanA_5a?.health_status}`,
        `Channel B health: ${chanB_5a?.health_status}`,
        `Key leak detected: ${leaked5a}`,
      ],
    });
    console.log(`Result: ${pass5a ? "PASS" : "FAIL"} | Status: ${res5a.status} | Key Leak: ${leaked5a} | Upstream A: ${upstreamACallCount} | Upstream B: ${upstreamBCallCount}\n`);

    // =========================================================================
    // TEST 5B: All Channels Failing with Connection Abort / Refuse -> 502 Bad Gateway
    // =========================================================================
    console.log(">>> [TEST 5B] All Channels Network Abort / Connection Refused <<<");
    setupChannels({ timeoutMsA: 500, timeoutMsB: 500 });
    upstreamACallCount = 0;
    upstreamBCallCount = 0;

    upstreamAHandler = (req, res) => {
      upstreamACallCount++;
      // Abort connection abruptly
      req.destroy();
    };

    upstreamBHandler = (req, res) => {
      upstreamBCallCount++;
      // Abort connection abruptly
      req.destroy();
    };

    const res5b = await fetch(`${MAIN_URL}/api/ai/images/generations`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ prompt: "Prompt when network crashes", model: "adv-model" }),
    });
    const text5b = await res5b.text();
    let data5b: any = text5b;
    try { data5b = JSON.parse(text5b); } catch {}
    const leaked5b = checkKeyLeak(text5b);

    const chanA_5b = getAiChannelById(channelAId);
    const chanB_5b = getAiChannelById(channelBId);

    const pass5b = res5b.status === 502 &&
      upstreamACallCount === 1 &&
      upstreamBCallCount === 1 &&
      !leaked5b;

    testReports.push({
      id: "ALL-CHANNELS-NETWORK-ABORT",
      category: "All Channels Failing",
      name: "All channels connection abort: verify 502 BAD_GATEWAY and zero key leak",
      status: pass5b ? "PASS" : "FAIL",
      expectedStatus: 502,
      actualStatus: res5b.status,
      expectedChannelHealth: { [channelAId]: "unhealthy", [channelBId]: "unhealthy" },
      actualChannelHealth: { [channelAId]: chanA_5b?.health_status || "unknown", [channelBId]: chanB_5b?.health_status || "unknown" },
      upstreamACalls: upstreamACallCount,
      upstreamBCalls: upstreamBCallCount,
      keyLeakDetected: leaked5b,
      notes: pass5b ? "Returned 502 BAD_GATEWAY with zero key leak" : `Failed with status ${res5b.status}`,
      logs: [
        `Status: ${res5b.status}`,
        `Body: ${text5b}`,
        `Channel A health: ${chanA_5b?.health_status}`,
        `Channel B health: ${chanB_5b?.health_status}`,
      ],
    });
    console.log(`Result: ${pass5b ? "PASS" : "FAIL"} | Status: ${res5b.status} | Key Leak: ${leaked5b} | Upstream A: ${upstreamACallCount} | Upstream B: ${upstreamBCallCount}\n`);

    // =========================================================================
    // TEST 6: Streaming Chat Completion Failover (429 -> 200 SSE)
    // =========================================================================
    console.log(">>> [TEST 6] Chat Completion Streaming Failover (429 -> 200 SSE) <<<");
    setupChannels();
    upstreamACallCount = 0;
    upstreamBCallCount = 0;

    upstreamAHandler = (req, res) => {
      upstreamACallCount++;
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Primary chat rate limit", code: 429 } }));
    };

    upstreamBHandler = (req, res) => {
      upstreamBCallCount++;
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });
      res.write('data: {"choices":[{"delta":{"content":"Chunk from fallback"}}]}\n\n');
      res.write("data: [DONE]\n\n");
      res.end();
    };

    const res6 = await fetch(`${MAIN_URL}/api/ai/chat/completions`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        messages: [{ role: "user", content: "Hi" }],
        model: "adv-model",
        stream: true,
      }),
    });
    const text6 = await res6.text();
    const leaked6 = checkKeyLeak(text6);

    const pass6 = res6.status === 200 &&
      upstreamACallCount === 1 &&
      upstreamBCallCount === 1 &&
      text6.includes("Chunk from fallback") &&
      !leaked6;

    testReports.push({
      id: "STREAMING-CHAT-FAILOVER",
      category: "Chat Failover",
      name: "Streaming chat 429 fails over to Secondary SSE 200 stream",
      status: pass6 ? "PASS" : "FAIL",
      expectedStatus: 200,
      actualStatus: res6.status,
      upstreamACalls: upstreamACallCount,
      upstreamBCalls: upstreamBCallCount,
      keyLeakDetected: leaked6,
      notes: pass6 ? "Streaming failover succeeded" : "Streaming failover failed",
      logs: [`Status: ${res6.status}`, `Body snippet: ${text6.slice(0, 120)}`],
    });
    console.log(`Result: ${pass6 ? "PASS" : "FAIL"} | Status: ${res6.status} | Upstream A: ${upstreamACallCount} | Upstream B: ${upstreamBCallCount}\n`);

  } finally {
    // Teardown
    db.prepare("DELETE FROM ai_channels WHERE id IN (?, ?)").run(channelAId, channelBId);
    mockA.close();
    mockB.close();
    mainApp.close();
  }

  // Print Summary Table
  console.log("\n================================================================================");
  console.log("                        EMPIRICAL RESULTS SUMMARY                               ");
  console.log("================================================================================");
  let totalPass = 0;
  let totalFail = 0;
  for (const r of testReports) {
    const icon = r.status === "PASS" ? "✅ PASS" : "❌ FAIL";
    console.log(`${icon} [${r.id}] ${r.name}`);
    console.log(`     Status: ${r.actualStatus} (Expected: ${r.expectedStatus}) | Upstream Calls: A=${r.upstreamACalls}, B=${r.upstreamBCalls} | Key Leak: ${r.keyLeakDetected}`);
    if (r.status === "PASS") totalPass++;
    else totalFail++;
  }
  console.log(`\nTotal Passed: ${totalPass} / ${testReports.length}`);
  console.log(`Total Failed: ${totalFail} / ${testReports.length}`);
  console.log("================================================================================\n");

  return { totalPass, totalFail, reports: testReports };
}

runAdversarialSuite().then(({ totalFail }) => {
  if (totalFail > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}).catch((err) => {
  console.error("Test execution fatal error:", err);
  process.exit(2);
});
