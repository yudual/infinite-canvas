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
} from "../../server/src/db.js";
import { JWT_SECRET } from "../../server/src/config.js";

export interface AdversarialTestResult {
  id: string;
  name: string;
  passed: boolean;
  expectedStatus: number | number[];
  actualStatus: number;
  expectedChannelHealth?: Record<string, string>;
  actualChannelHealth?: Record<string, string>;
  upstreamACalls: number;
  upstreamBCalls: number;
  keyLeakDetected: boolean;
  details: string;
  logs: string[];
}

const results: AdversarialTestResult[] = [];

const MAIN_PORT = 3895;
const UPSTREAM_A_PORT = 3896;
const UPSTREAM_B_PORT = 3897;

const MAIN_URL = `http://127.0.0.1:${MAIN_PORT}`;
const UPSTREAM_A_URL = `http://127.0.0.1:${UPSTREAM_A_PORT}`;
const UPSTREAM_B_URL = `http://127.0.0.1:${UPSTREAM_B_PORT}`;

const SECRET_KEY_A = "sk-mock-adversarial-primary-key-aaaa1111";
const SECRET_KEY_B = "sk-mock-adversarial-secondary-key-bbbb2222";

let handlerA: (req: http.IncomingMessage, res: http.ServerResponse) => void = () => {};
let handlerB: (req: http.IncomingMessage, res: http.ServerResponse) => void = () => {};

let countA = 0;
let countB = 0;

function createMockServer(port: number, handlerGetter: () => (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      handlerGetter()(req, res);
    });
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function startMainServer(port: number): Promise<http.Server> {
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

function checkKeyLeak(payload: string): boolean {
  if (!payload) return false;
  return payload.includes(SECRET_KEY_A) || payload.includes(SECRET_KEY_B);
}

async function run() {
  console.log("================================================================================");
  console.log("       🔥 Comprehensive Adversarial Failover Stress Harness — Challenger 1      ");
  console.log("================================================================================\n");

  initSchema();

  const channelAId = "mock-adv-chan-a";
  const channelBId = "mock-adv-chan-b";

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

  const mockServerA = await createMockServer(UPSTREAM_A_PORT, () => handlerA);
  const mockServerB = await createMockServer(UPSTREAM_B_PORT, () => handlerB);
  const mainServer = await startMainServer(MAIN_PORT);

  function resetChannels(opts: { timeoutMsA?: number; timeoutMsB?: number; singleChannel?: boolean } = {}) {
    db.prepare("DELETE FROM ai_channels WHERE id IN (?, ?)").run(channelAId, channelBId);

    createAiChannel({
      id: channelAId,
      name: "Mock Primary Channel A",
      provider_type: "openai",
      base_url: UPSTREAM_A_URL,
      api_key: SECRET_KEY_A,
      models: JSON.stringify(["adv-model", "dall-e-3", "gpt-4o"]),
      default_model: "adv-model",
      priority: 100,
      weight: 1,
      is_active: 1,
      timeout_ms: opts.timeoutMsA || 5000,
      custom_headers: "{}",
    });

    if (!opts.singleChannel) {
      createAiChannel({
        id: channelBId,
        name: "Mock Secondary Channel B",
        provider_type: "openai",
        base_url: UPSTREAM_B_URL,
        api_key: SECRET_KEY_B,
        models: JSON.stringify(["adv-model", "dall-e-3", "gpt-4o"]),
        default_model: "adv-model",
        priority: 50,
        weight: 1,
        is_active: 1,
        timeout_ms: opts.timeoutMsB || 5000,
        custom_headers: "{}",
      });
    }
  }

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Primary HTTP 429 -> Secondary HTTP 200
    // -------------------------------------------------------------------------
    console.log(">>> [ADV-1] Primary 429 -> Failover to Secondary 200 <<<");
    resetChannels();
    countA = 0;
    countB = 0;

    handlerA = (req, res) => {
      countA++;
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Rate limit reached on Primary", code: "rate_limit_exceeded" } }));
    };

    handlerB = (req, res) => {
      countB++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ url: "https://mock.cdn/image_secondary_200.png" }] }));
    };

    const res1 = await fetch(`${MAIN_URL}/api/ai/images/generations`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ prompt: "Test prompt 1", model: "adv-model" }),
    });
    const text1 = await res1.text();
    let data1: any = text1;
    try { data1 = JSON.parse(text1); } catch {}
    const chanA_1 = getAiChannelById(channelAId);
    const chanB_1 = getAiChannelById(channelBId);
    const leaked1 = checkKeyLeak(text1);

    const pass1 = res1.status === 200 &&
      countA === 1 && countB === 1 &&
      data1?.data?.[0]?.url === "https://mock.cdn/image_secondary_200.png" &&
      chanA_1?.health_status === "degraded" &&
      chanB_1?.health_status === "healthy" &&
      !leaked1;

    results.push({
      id: "ADV-1-FAILOVER-429",
      name: "Primary 429 failover to Secondary 200 with health update and zero key leaks",
      passed: pass1,
      expectedStatus: 200,
      actualStatus: res1.status,
      expectedChannelHealth: { [channelAId]: "degraded", [channelBId]: "healthy" },
      actualChannelHealth: { [channelAId]: chanA_1?.health_status || "unknown", [channelBId]: chanB_1?.health_status || "unknown" },
      upstreamACalls: countA,
      upstreamBCalls: countB,
      keyLeakDetected: leaked1,
      details: pass1 ? "Passed: Primary degraded, Secondary healthy, 200 returned" : "Failed",
      logs: [`Status: ${res1.status}`, `Body: ${text1}`],
    });
    console.log(`  Result: ${pass1 ? "PASS" : "FAIL"} (Status: ${res1.status}, A: ${countA}, B: ${countB})\n`);

    // -------------------------------------------------------------------------
    // TEST 2A: Primary HTTP 500 -> Secondary HTTP 200
    // -------------------------------------------------------------------------
    console.log(">>> [ADV-2A] Primary 500 -> Failover to Secondary 200 <<<");
    resetChannels();
    countA = 0;
    countB = 0;

    handlerA = (req, res) => {
      countA++;
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Internal server error on Primary" } }));
    };

    handlerB = (req, res) => {
      countB++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ url: "https://mock.cdn/image_secondary_500_failover.png" }] }));
    };

    const res2a = await fetch(`${MAIN_URL}/api/ai/images/generations`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ prompt: "Test prompt 2a", model: "adv-model" }),
    });
    const text2a = await res2a.text();
    let data2a: any = text2a;
    try { data2a = JSON.parse(text2a); } catch {}
    const chanA_2a = getAiChannelById(channelAId);
    const chanB_2a = getAiChannelById(channelBId);
    const leaked2a = checkKeyLeak(text2a);

    const pass2a = res2a.status === 200 &&
      countA === 1 && countB === 1 &&
      data2a?.data?.[0]?.url === "https://mock.cdn/image_secondary_500_failover.png" &&
      chanA_2a?.health_status === "degraded" &&
      chanB_2a?.health_status === "healthy" &&
      !leaked2a;

    results.push({
      id: "ADV-2A-FAILOVER-500",
      name: "Primary 500 failover to Secondary 200 with health update and zero key leaks",
      passed: pass2a,
      expectedStatus: 200,
      actualStatus: res2a.status,
      expectedChannelHealth: { [channelAId]: "degraded", [channelBId]: "healthy" },
      actualChannelHealth: { [channelAId]: chanA_2a?.health_status || "unknown", [channelBId]: chanB_2a?.health_status || "unknown" },
      upstreamACalls: countA,
      upstreamBCalls: countB,
      keyLeakDetected: leaked2a,
      details: pass2a ? "Passed: Primary degraded, Secondary healthy, 200 returned" : "Failed",
      logs: [`Status: ${res2a.status}`, `Body: ${text2a}`],
    });
    console.log(`  Result: ${pass2a ? "PASS" : "FAIL"} (Status: ${res2a.status}, A: ${countA}, B: ${countB})\n`);

    // -------------------------------------------------------------------------
    // TEST 2B: Primary HTTP 502 -> Secondary HTTP 200
    // -------------------------------------------------------------------------
    console.log(">>> [ADV-2B] Primary 502 -> Failover to Secondary 200 <<<");
    resetChannels();
    countA = 0;
    countB = 0;

    handlerA = (req, res) => {
      countA++;
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Bad Gateway on Primary" } }));
    };

    handlerB = (req, res) => {
      countB++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ url: "https://mock.cdn/image_secondary_502_failover.png" }] }));
    };

    const res2b = await fetch(`${MAIN_URL}/api/ai/images/generations`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ prompt: "Test prompt 2b", model: "adv-model" }),
    });
    const text2b = await res2b.text();
    let data2b: any = text2b;
    try { data2b = JSON.parse(text2b); } catch {}
    const chanA_2b = getAiChannelById(channelAId);
    const chanB_2b = getAiChannelById(channelBId);
    const leaked2b = checkKeyLeak(text2b);

    const pass2b = res2b.status === 200 &&
      countA === 1 && countB === 1 &&
      data2b?.data?.[0]?.url === "https://mock.cdn/image_secondary_502_failover.png" &&
      chanA_2b?.health_status === "degraded" &&
      chanB_2b?.health_status === "healthy" &&
      !leaked2b;

    results.push({
      id: "ADV-2B-FAILOVER-502",
      name: "Primary 502 failover to Secondary 200 with health update and zero key leaks",
      passed: pass2b,
      expectedStatus: 200,
      actualStatus: res2b.status,
      expectedChannelHealth: { [channelAId]: "degraded", [channelBId]: "healthy" },
      actualChannelHealth: { [channelAId]: chanA_2b?.health_status || "unknown", [channelBId]: chanB_2b?.health_status || "unknown" },
      upstreamACalls: countA,
      upstreamBCalls: countB,
      keyLeakDetected: leaked2b,
      details: pass2b ? "Passed: Primary degraded, Secondary healthy, 200 returned" : "Failed",
      logs: [`Status: ${res2b.status}`, `Body: ${text2b}`],
    });
    console.log(`  Result: ${pass2b ? "PASS" : "FAIL"} (Status: ${res2b.status}, A: ${countA}, B: ${countB})\n`);

    // -------------------------------------------------------------------------
    // TEST 3: Primary Timeout / Abort -> Secondary HTTP 200
    // -------------------------------------------------------------------------
    console.log(">>> [ADV-3] Primary Timeout / Abort -> Failover to Secondary 200 <<<");
    resetChannels({ timeoutMsA: 800, timeoutMsB: 5000 });
    countA = 0;
    countB = 0;

    handlerA = (req, res) => {
      countA++;
      setTimeout(() => {
        if (!res.writableEnded) {
          res.writeHead(200);
          res.end("late");
        }
      }, 3000);
    };

    handlerB = (req, res) => {
      countB++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ url: "https://mock.cdn/image_secondary_timeout_failover.png" }] }));
    };

    const start3 = Date.now();
    const res3 = await fetch(`${MAIN_URL}/api/ai/images/generations`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ prompt: "Test prompt 3", model: "adv-model" }),
    });
    const elapsed3 = Date.now() - start3;
    const text3 = await res3.text();
    let data3: any = text3;
    try { data3 = JSON.parse(text3); } catch {}
    const chanA_3 = getAiChannelById(channelAId);
    const chanB_3 = getAiChannelById(channelBId);
    const leaked3 = checkKeyLeak(text3);

    const pass3 = res3.status === 200 &&
      countA === 1 && countB === 1 &&
      data3?.data?.[0]?.url === "https://mock.cdn/image_secondary_timeout_failover.png" &&
      chanA_3?.health_status === "degraded" &&
      chanB_3?.health_status === "healthy" &&
      elapsed3 >= 700 && elapsed3 < 2500 &&
      !leaked3;

    results.push({
      id: "ADV-3-FAILOVER-TIMEOUT",
      name: "Primary timeout abort triggers failover to Secondary 200",
      passed: pass3,
      expectedStatus: 200,
      actualStatus: res3.status,
      expectedChannelHealth: { [channelAId]: "degraded", [channelBId]: "healthy" },
      actualChannelHealth: { [channelAId]: chanA_3?.health_status || "unknown", [channelBId]: chanB_3?.health_status || "unknown" },
      upstreamACalls: countA,
      upstreamBCalls: countB,
      keyLeakDetected: leaked3,
      details: pass3 ? `Passed: Failed over after timeout in ${elapsed3}ms` : `Failed (${elapsed3}ms)`,
      logs: [`Status: ${res3.status}`, `Elapsed: ${elapsed3}ms`, `Body: ${text3}`],
    });
    console.log(`  Result: ${pass3 ? "PASS" : "FAIL"} (Status: ${res3.status}, Elapsed: ${elapsed3}ms, A: ${countA}, B: ${countB})\n`);

    // -------------------------------------------------------------------------
    // TEST 4A: Client-side Error (Empty Prompt) -> 400 Bad Request, Zero Upstream Calls
    // -------------------------------------------------------------------------
    console.log(">>> [ADV-4A] Client-side Error (Empty Prompt) -> 400 Bad Request, Zero Upstream Calls <<<");
    resetChannels();
    countA = 0;
    countB = 0;

    const res4a = await fetch(`${MAIN_URL}/api/ai/images/generations`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ prompt: "    ", model: "adv-model" }),
    });
    const text4a = await res4a.text();
    const leaked4a = checkKeyLeak(text4a);

    const pass4a = res4a.status === 400 && countA === 0 && countB === 0 && !leaked4a;

    results.push({
      id: "ADV-4A-CLIENT-400-BOUNDARY",
      name: "Empty prompt rejected at API boundary with 400 and zero upstream calls",
      passed: pass4a,
      expectedStatus: 400,
      actualStatus: res4a.status,
      upstreamACalls: countA,
      upstreamBCalls: countB,
      keyLeakDetected: leaked4a,
      details: pass4a ? "Passed: 400 Bad Request returned with 0 upstream calls" : "Failed",
      logs: [`Status: ${res4a.status}`, `Body: ${text4a}`],
    });
    console.log(`  Result: ${pass4a ? "PASS" : "FAIL"} (Status: ${res4a.status}, A: ${countA}, B: ${countB})\n`);

    // -------------------------------------------------------------------------
    // TEST 4B: Upstream HTTP 400 Bad Request -> 400 Returned, Secondary NOT Called
    // -------------------------------------------------------------------------
    console.log(">>> [ADV-4B] Upstream HTTP 400 Bad Request -> 400 Returned, Secondary NOT Called <<<");
    resetChannels();
    countA = 0;
    countB = 0;

    handlerA = (req, res) => {
      countA++;
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Upstream rejected parameter: invalid aspect ratio", type: "invalid_request_error" } }));
    };

    handlerB = (req, res) => {
      countB++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ url: "https://mock.cdn/should_never_be_called.png" }] }));
    };

    const res4b = await fetch(`${MAIN_URL}/api/ai/images/generations`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ prompt: "A valid prompt", model: "adv-model", aspect_ratio: "invalid_ratio" }),
    });
    const text4b = await res4b.text();
    const leaked4b = checkKeyLeak(text4b);

    const pass4b = res4b.status === 400 && countA === 1 && countB === 0 && !leaked4b;

    results.push({
      id: "ADV-4B-UPSTREAM-400-NO-FAILOVER",
      name: "Upstream 400 Bad Request returned directly without triggering failover to secondary",
      passed: pass4b,
      expectedStatus: 400,
      actualStatus: res4b.status,
      upstreamACalls: countA,
      upstreamBCalls: countB,
      keyLeakDetected: leaked4b,
      details: pass4b ? "Passed: Upstream 400 returned directly, secondary not invoked" : "Failed",
      logs: [`Status: ${res4b.status}`, `Body: ${text4b}`],
    });
    console.log(`  Result: ${pass4b ? "PASS" : "FAIL"} (Status: ${res4b.status}, A: ${countA}, B: ${countB})\n`);

    // -------------------------------------------------------------------------
    // TEST 5A: All Channels Failing with 500 -> Check 502 Bad Gateway, Health & Zero Leak
    // -------------------------------------------------------------------------
    console.log(">>> [ADV-5A] All Channels Failing with 500 -> Check 502 Bad Gateway, Health & Zero Leak <<<");
    resetChannels();
    countA = 0;
    countB = 0;

    handlerA = (req, res) => {
      countA++;
      const auth = req.headers["authorization"] || "";
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        error: {
          message: `Internal server error on Channel A with auth ${auth}`,
          leaked_secret: SECRET_KEY_A,
        },
      }));
    };

    handlerB = (req, res) => {
      countB++;
      const auth = req.headers["authorization"] || "";
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        error: {
          message: `Internal server error on Channel B with auth ${auth}`,
          leaked_secret: SECRET_KEY_B,
        },
      }));
    };

    const res5a = await fetch(`${MAIN_URL}/api/ai/images/generations`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ prompt: "Test prompt 5a", model: "adv-model" }),
    });
    const text5a = await res5a.text();
    let data5a: any = text5a;
    try { data5a = JSON.parse(text5a); } catch {}
    const leaked5a = checkKeyLeak(text5a);

    const chanA_5a = getAiChannelById(channelAId);
    const chanB_5a = getAiChannelById(channelBId);

    const statusIs502 = res5a.status === 502;
    const channelBIsDegraded = chanB_5a?.health_status === "degraded" || chanB_5a?.health_status === "unhealthy";
    const pass5a = statusIs502 && !leaked5a && countA === 1 && countB === 1 && channelBIsDegraded;

    results.push({
      id: "ADV-5A-ALL-FAIL-500",
      name: "All channels fail with 500: verify 502 Bad Gateway returned and failing channels degraded (not healthy)",
      passed: pass5a,
      expectedStatus: 502,
      actualStatus: res5a.status,
      expectedChannelHealth: { [channelAId]: "degraded", [channelBId]: "degraded" },
      actualChannelHealth: { [channelAId]: chanA_5a?.health_status || "unknown", [channelBId]: chanB_5a?.health_status || "unknown" },
      upstreamACalls: countA,
      upstreamBCalls: countB,
      keyLeakDetected: leaked5a,
      details: pass5a
        ? "Passed: 502 returned, both channels degraded, zero key leaks"
        : `BUG CONFIRMED: Server returned HTTP ${res5a.status} (expected 502). Channel B health marked '${chanB_5a?.health_status}' (expected degraded). Key leak: ${leaked5a}.`,
      logs: [
        `Status: ${res5a.status}`,
        `Body: ${text5a}`,
        `Channel A health: ${chanA_5a?.health_status}`,
        `Channel B health: ${chanB_5a?.health_status}`,
      ],
    });
    console.log(`  Result: ${pass5a ? "PASS" : "FAIL"} (Status: ${res5a.status}, ChanB Health: ${chanB_5a?.health_status}, A: ${countA}, B: ${countB})\n`);

    // -------------------------------------------------------------------------
    // TEST 5B: All Channels Failing with 429 -> Check Status, Health & Zero Leak
    // -------------------------------------------------------------------------
    console.log(">>> [ADV-5B] All Channels Failing with 429 -> Check Status, Health & Zero Leak <<<");
    resetChannels();
    countA = 0;
    countB = 0;

    handlerA = (req, res) => {
      countA++;
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Rate limit on Channel A", exposed_key: SECRET_KEY_A } }));
    };

    handlerB = (req, res) => {
      countB++;
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Rate limit on Channel B", exposed_key: SECRET_KEY_B } }));
    };

    const res5b = await fetch(`${MAIN_URL}/api/ai/images/generations`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ prompt: "Test prompt 5b", model: "adv-model" }),
    });
    const text5b = await res5b.text();
    const leaked5b = checkKeyLeak(text5b);
    const chanA_5b = getAiChannelById(channelAId);
    const chanB_5b = getAiChannelById(channelBId);

    const chanB_5b_degraded = chanB_5b?.health_status === "degraded" || chanB_5b?.health_status === "unhealthy";
    const pass5b = (res5b.status === 502) && !leaked5b && countA === 1 && countB === 1 && chanB_5b_degraded;

    results.push({
      id: "ADV-5B-ALL-FAIL-429",
      name: "All channels fail with 429: verify 502 returned and failing channels degraded (not healthy)",
      passed: pass5b,
      expectedStatus: 502,
      actualStatus: res5b.status,
      expectedChannelHealth: { [channelAId]: "degraded", [channelBId]: "degraded" },
      actualChannelHealth: { [channelAId]: chanA_5b?.health_status || "unknown", [channelBId]: chanB_5b?.health_status || "unknown" },
      upstreamACalls: countA,
      upstreamBCalls: countB,
      keyLeakDetected: leaked5b,
      details: pass5b
        ? "Passed"
        : `BUG CONFIRMED: Status is ${res5b.status} (expected 502). Channel B health is '${chanB_5b?.health_status}' (expected degraded). Key leak: ${leaked5b}.`,
      logs: [
        `Status: ${res5b.status}`,
        `Body: ${text5b}`,
        `Channel A health: ${chanA_5b?.health_status}`,
        `Channel B health: ${chanB_5b?.health_status}`,
      ],
    });
    console.log(`  Result: ${pass5b ? "PASS" : "FAIL"} (Status: ${res5b.status}, ChanB Health: ${chanB_5b?.health_status}, A: ${countA}, B: ${countB})\n`);

    // -------------------------------------------------------------------------
    // TEST 5C: All Channels Failing with Connection Refused / Network Abort -> 502
    // -------------------------------------------------------------------------
    console.log(">>> [ADV-5C] All Channels Failing with Connection Abort -> 502 BAD_GATEWAY <<<");
    resetChannels({ timeoutMsA: 500, timeoutMsB: 500 });
    countA = 0;
    countB = 0;

    handlerA = (req, res) => {
      countA++;
      req.destroy();
    };

    handlerB = (req, res) => {
      countB++;
      req.destroy();
    };

    const res5c = await fetch(`${MAIN_URL}/api/ai/images/generations`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ prompt: "Prompt when network crashes", model: "adv-model" }),
    });
    const text5c = await res5c.text();
    const leaked5c = checkKeyLeak(text5c);
    const chanA_5c = getAiChannelById(channelAId);
    const chanB_5c = getAiChannelById(channelBId);

    const pass5c = res5c.status === 502 && countA === 1 && countB === 1 && !leaked5c &&
      chanA_5c?.health_status === "unhealthy" && chanB_5c?.health_status === "unhealthy";

    results.push({
      id: "ADV-5C-NETWORK-ABORT-ALL",
      name: "All channels connection abort: verify 502 BAD_GATEWAY, both channels unhealthy, zero key leak",
      passed: pass5c,
      expectedStatus: 502,
      actualStatus: res5c.status,
      expectedChannelHealth: { [channelAId]: "unhealthy", [channelBId]: "unhealthy" },
      actualChannelHealth: { [channelAId]: chanA_5c?.health_status || "unknown", [channelBId]: chanB_5c?.health_status || "unknown" },
      upstreamACalls: countA,
      upstreamBCalls: countB,
      keyLeakDetected: leaked5c,
      details: pass5c ? "Passed: 502 BAD_GATEWAY and channels marked unhealthy" : `Failed with status ${res5c.status}`,
      logs: [`Status: ${res5c.status}`, `Body: ${text5c}`],
    });
    console.log(`  Result: ${pass5c ? "PASS" : "FAIL"} (Status: ${res5c.status}, ChanA: ${chanA_5c?.health_status}, ChanB: ${chanB_5c?.health_status})\n`);

    // -------------------------------------------------------------------------
    // TEST 5D: Single Active Channel Returning 500 -> Verify Channel Health Updated to Degraded
    // -------------------------------------------------------------------------
    console.log(">>> [ADV-5D] Single Active Channel Returning 500 -> Verify Health Degraded <<<");
    resetChannels({ singleChannel: true });
    countA = 0;
    countB = 0;

    handlerA = (req, res) => {
      countA++;
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Single channel internal outage" } }));
    };

    const res5d = await fetch(`${MAIN_URL}/api/ai/images/generations`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ prompt: "Test prompt 5d", model: "adv-model" }),
    });
    const text5d = await res5d.text();
    const leaked5d = checkKeyLeak(text5d);
    const chanA_5d = getAiChannelById(channelAId);

    const chanA_5d_degraded = chanA_5d?.health_status === "degraded" || chanA_5d?.health_status === "unhealthy";
    const pass5d = !leaked5d && countA === 1 && chanA_5d_degraded && res5d.status === 502;

    results.push({
      id: "ADV-5D-SINGLE-CHANNEL-500-HEALTH",
      name: "Single channel returns 500: verify 502 returned and channel health marked degraded (not falsely healthy)",
      passed: pass5d,
      expectedStatus: 502,
      actualStatus: res5d.status,
      expectedChannelHealth: { [channelAId]: "degraded" },
      actualChannelHealth: { [channelAId]: chanA_5d?.health_status || "unknown" },
      upstreamACalls: countA,
      upstreamBCalls: 0,
      keyLeakDetected: leaked5d,
      details: pass5d
        ? "Passed: Channel marked degraded upon 500 and 502 returned"
        : `BUG CONFIRMED: Status is ${res5d.status} (expected 502). Channel A returned 500 but was marked '${chanA_5d?.health_status}' with lastError='${chanA_5d?.last_error}'.`,
      logs: [
        `Status: ${res5d.status}`,
        `Body: ${text5d}`,
        `Channel A health: ${chanA_5d?.health_status}`,
        `Channel A last_error: ${chanA_5d?.last_error}`,
      ],
    });
    console.log(`  Result: ${pass5d ? "PASS" : "FAIL"} (Status: ${res5d.status}, ChanA Health: ${chanA_5d?.health_status}, LastError: ${chanA_5d?.last_error})\n`);

    // -------------------------------------------------------------------------
    // TEST 6: Streaming Chat Completions Failover (429 -> SSE 200)
    // -------------------------------------------------------------------------
    console.log(">>> [ADV-6] Streaming Chat Completion 429 -> SSE 200 <<<");
    resetChannels();
    countA = 0;
    countB = 0;

    handlerA = (req, res) => {
      countA++;
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Chat rate limit on A" } }));
    };

    handlerB = (req, res) => {
      countB++;
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });
      res.write('data: {"choices":[{"delta":{"content":"Adversarial fallback chunk"}}]}\n\n');
      res.write("data: [DONE]\n\n");
      res.end();
    };

    const res6 = await fetch(`${MAIN_URL}/api/ai/chat/completions`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        messages: [{ role: "user", content: "Hello" }],
        model: "adv-model",
        stream: true,
      }),
    });
    const text6 = await res6.text();
    const leaked6 = checkKeyLeak(text6);

    const pass6 = res6.status === 200 &&
      countA === 1 && countB === 1 &&
      text6.includes("Adversarial fallback chunk") &&
      !leaked6;

    results.push({
      id: "ADV-6-STREAMING-CHAT-FAILOVER",
      name: "Streaming chat 429 failover to secondary SSE 200 stream",
      passed: pass6,
      expectedStatus: 200,
      actualStatus: res6.status,
      upstreamACalls: countA,
      upstreamBCalls: countB,
      keyLeakDetected: leaked6,
      details: pass6 ? "Passed: Streamed SSE chunks received successfully from fallback" : "Failed",
      logs: [`Status: ${res6.status}`, `Body snippet: ${text6.slice(0, 100)}`],
    });
    console.log(`  Result: ${pass6 ? "PASS" : "FAIL"} (Status: ${res6.status}, A: ${countA}, B: ${countB})\n`);

    // -------------------------------------------------------------------------
    // TEST 7: Streaming Chat Completion All Channels Fail 500 -> Verify 502 & Health
    // -------------------------------------------------------------------------
    console.log(">>> [ADV-7] Streaming Chat Completion All Fail 500 -> Verify 502 & Health <<<");
    resetChannels();
    countA = 0;
    countB = 0;

    handlerA = (req, res) => {
      countA++;
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Stream outage on A" } }));
    };

    handlerB = (req, res) => {
      countB++;
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Stream outage on B" } }));
    };

    const res7 = await fetch(`${MAIN_URL}/api/ai/chat/completions`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        messages: [{ role: "user", content: "Hello" }],
        model: "adv-model",
        stream: true,
      }),
    });
    const text7 = await res7.text();
    const leaked7 = checkKeyLeak(text7);
    const chanA_7 = getAiChannelById(channelAId);
    const chanB_7 = getAiChannelById(channelBId);

    const chanB_7_degraded = chanB_7?.health_status === "degraded" || chanB_7?.health_status === "unhealthy";
    const pass7 = res7.status === 502 && countA === 1 && countB === 1 && !leaked7 && chanB_7_degraded;

    results.push({
      id: "ADV-7-STREAMING-CHAT-ALL-FAIL",
      name: "Streaming chat all channels fail 500: verify 502 Bad Gateway and degraded channel health",
      passed: pass7,
      expectedStatus: 502,
      actualStatus: res7.status,
      expectedChannelHealth: { [channelAId]: "degraded", [channelBId]: "degraded" },
      actualChannelHealth: { [channelAId]: chanA_7?.health_status || "unknown", [channelBId]: chanB_7?.health_status || "unknown" },
      upstreamACalls: countA,
      upstreamBCalls: countB,
      keyLeakDetected: leaked7,
      details: pass7
        ? "Passed: 502 returned and Channel B degraded"
        : `BUG CONFIRMED: Status is ${res7.status} (expected 502). Channel B health is '${chanB_7?.health_status}' (expected degraded). Key leak: ${leaked7}.`,
      logs: [`Status: ${res7.status}`, `Body snippet: ${text7.slice(0, 100)}`],
    });
    console.log(`  Result: ${pass7 ? "PASS" : "FAIL"} (Status: ${res7.status}, ChanB Health: ${chanB_7?.health_status}, A: ${countA}, B: ${countB})\n`);

  } finally {
    db.prepare("DELETE FROM ai_channels WHERE id IN (?, ?)").run(channelAId, channelBId);
    mockServerA.close();
    mockServerB.close();
    mainServer.close();
  }

  // Summary
  console.log("================================================================================");
  console.log("                           ADVERSARIAL STRESS SUMMARY                           ");
  console.log("================================================================================");
  let totalPass = 0;
  let totalFail = 0;
  for (const r of results) {
    const icon = r.passed ? "✅ PASS" : "❌ FAIL";
    console.log(`${icon} [${r.id}] ${r.name}`);
    console.log(`     Status: ${r.actualStatus} (Expected: ${JSON.stringify(r.expectedStatus)}) | Upstream: A=${r.upstreamACalls}, B=${r.upstreamBCalls} | Leak: ${r.keyLeakDetected}`);
    if (r.expectedChannelHealth) {
      console.log(`     Expected Health: ${JSON.stringify(r.expectedChannelHealth)} | Actual Health: ${JSON.stringify(r.actualChannelHealth)}`);
    }
    if (!r.passed) {
      console.log(`     Details: ${r.details}`);
    }
    if (r.passed) totalPass++;
    else totalFail++;
  }
  console.log(`\nTotal Passed: ${totalPass} / ${results.length}`);
  console.log(`Total Failed: ${totalFail} / ${results.length}`);
  console.log("================================================================================\n");

  return { totalPass, totalFail, results };
}

run().then(({ totalFail }) => {
  if (totalFail > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}).catch((err) => {
  console.error("Fatal error running adversarial tests:", err);
  process.exit(2);
});
