import * as http from "node:http";
import jwt from "jsonwebtoken";
import { Database } from "bun:sqlite";
import { JWT_SECRET } from "../../server/src/config.js";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3001";
const MOCK_AI_PORT = 3198;

interface TestResult {
  suite: string;
  name: string;
  passed: boolean;
  expected: any;
  actual: any;
  details?: string;
}

const results: TestResult[] = [];

function record(suite: string, name: string, passed: boolean, expected: any, actual: any, details?: string) {
  results.push({ suite, name, passed, expected, actual, details });
  const icon = passed ? "\x1b[32m✔ PASS\x1b[0m" : "\x1b[31m✖ FAIL\x1b[0m";
  console.log(`  ${icon} [${suite}] ${name}`);
  if (!passed) {
    console.error(`     ❌ Expected: ${JSON.stringify(expected)} | Actual: ${JSON.stringify(actual)}`);
    if (details) console.error(`        Details:  ${details}`);
  }
}

// ----------------------------------------------------------------------------
// Advanced Mock AI Server with SSE slow streaming, error injection & abort tracker
// ----------------------------------------------------------------------------
class AdvancedMockAiServer {
  private server: http.Server | null = null;
  public port: number;
  public requests: Array<{
    path: string;
    method: string;
    headers: http.IncomingHttpHeaders;
    body: any;
    timestamp: number;
  }> = [];

  // Error simulation
  public nextErrorStatus: number | null = null;
  public nextErrorMessage: string | null = null;

  // Streaming configuration & stats
  public streamChunkDelayMs: number = 0;
  public streamChunkCount: number = 2;
  public injectKeyInStream: string | null = null;
  public activeStreamConnections: number = 0;
  public abortedStreamConnections: number = 0;
  public completedStreamConnections: number = 0;
  public lastAbortLatencyMs: number = 0;

  constructor(port = MOCK_AI_PORT) {
    this.port = port;
  }

  public getUrl(): string {
    return `http://127.0.0.1:${this.port}/v1`;
  }

  public clear(): void {
    this.requests = [];
    this.nextErrorStatus = null;
    this.nextErrorMessage = null;
    this.streamChunkDelayMs = 0;
    this.streamChunkCount = 2;
    this.injectKeyInStream = null;
    this.activeStreamConnections = 0;
    this.abortedStreamConnections = 0;
    this.completedStreamConnections = 0;
    this.lastAbortLatencyMs = 0;
  }

  public getLastAuthHeader(): string | undefined {
    const last = this.requests[this.requests.length - 1];
    return last ? (last.headers["authorization"] as string) : undefined;
  }

  public async start(): Promise<void> {
    if (this.server) return;

    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", async () => {
          const rawBody = Buffer.concat(chunks).toString("utf-8");
          let parsedBody: any = rawBody;
          try {
            parsedBody = JSON.parse(rawBody);
          } catch {}

          this.requests.push({
            path: req.url || "/",
            method: req.method || "GET",
            headers: req.headers,
            body: parsedBody,
            timestamp: Date.now(),
          });

          // Check simulated error
          if (this.nextErrorStatus) {
            const status = this.nextErrorStatus;
            const message = this.nextErrorMessage || "Simulated upstream error";
            this.nextErrorStatus = null;
            this.nextErrorMessage = null;

            res.writeHead(status, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: { message, code: status, type: "upstream_error" } }));
            return;
          }

          const url = req.url || "/";

          // 1. GET /v1/models
          if (url.includes("/models") && req.method === "GET") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                object: "list",
                data: [
                  { id: "gpt-image-2", object: "model" },
                  { id: "dall-e-3", object: "model" },
                  { id: "gpt-4o", object: "model" },
                ],
              })
            );
            return;
          }

          // 2. POST /v1/images/generations
          if (url.includes("/images/generations") && req.method === "POST") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                created: Math.floor(Date.now() / 1000),
                data: [
                  {
                    url: `http://127.0.0.1:${this.port}/mock/sample.png`,
                    b64_json: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
                    revised_prompt: parsedBody?.prompt || "Sample prompt",
                  },
                ],
              })
            );
            return;
          }

          // 3. POST /v1/images/edits
          if (url.includes("/images/edits") && req.method === "POST") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                created: Math.floor(Date.now() / 1000),
                data: [
                  {
                    url: `http://127.0.0.1:${this.port}/mock/edited.png`,
                  },
                ],
              })
            );
            return;
          }

          // 4. POST /v1/chat/completions
          if (url.includes("/chat/completions") && req.method === "POST") {
            const isStream = parsedBody && typeof parsedBody === "object" && parsedBody.stream === true;

            if (isStream) {
              this.activeStreamConnections++;
              let clientAborted = false;
              const streamStartTime = Date.now();

              req.on("close", () => {
                if (!res.writableEnded) {
                  clientAborted = true;
                  this.abortedStreamConnections++;
                  this.lastAbortLatencyMs = Date.now() - streamStartTime;
                }
              });

              res.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
              });

              const totalChunks = this.streamChunkCount;
              const delay = this.streamChunkDelayMs;

              for (let i = 0; i < totalChunks; i++) {
                if (clientAborted || res.writableEnded || res.destroyed) {
                  break;
                }

                let chunkText = `Chunk #${i + 1}`;
                if (this.injectKeyInStream && i === 1) {
                  chunkText = `Leaked secret: ${this.injectKeyInStream}`;
                }

                res.write(
                  `data: ${JSON.stringify({
                    id: `chatcmpl-mock-${i}`,
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1000),
                    model: parsedBody?.model || "gpt-4o",
                    choices: [
                      {
                        index: 0,
                        delta: i === 0 ? { role: "assistant", content: chunkText } : { content: " " + chunkText },
                        finish_reason: i === totalChunks - 1 ? "stop" : null,
                      },
                    ],
                  })}\n\n`
                );

                if (delay > 0) {
                  await new Promise((r) => setTimeout(r, delay));
                }
              }

              if (!clientAborted && !res.writableEnded && !res.destroyed) {
                res.write("data: [DONE]\n\n");
                res.end();
                this.completedStreamConnections++;
              }
              this.activeStreamConnections--;
              return;
            } else {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({
                  id: "chatcmpl-mock-static",
                  object: "chat.completion",
                  created: Math.floor(Date.now() / 1000),
                  model: parsedBody?.model || "gpt-4o",
                  choices: [
                    {
                      index: 0,
                      message: {
                        role: "assistant",
                        content: "Static mock completion response",
                      },
                      finish_reason: "stop",
                    },
                  ],
                })
              );
              return;
            }
          }

          // Fallback
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok", mock: true }));
        });
      });

      this.server.on("error", (err: any) => {
        if (err.code === "EADDRINUSE") {
          this.port += 1;
          this.server?.close();
          this.server = null;
          this.start().then(resolve).catch(reject);
        } else {
          reject(err);
        }
      });

      this.server.listen(this.port, "127.0.0.1", () => {
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve) => {
      this.server!.close(() => {
        this.server = null;
        resolve();
      });
    });
  }
}

// ----------------------------------------------------------------------------
// Request Helper
// ----------------------------------------------------------------------------
async function apiRequest(
  path: string,
  options: {
    method?: string;
    token?: string | null;
    body?: any;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  } = {}
) {
  const url = `${BASE_URL}${path.startsWith("/") ? path : "/" + path}`;
  const headers: Record<string, string> = {
    ...(options.headers || {}),
  };
  if (options.token !== undefined) {
    if (options.token !== null) {
      headers["Authorization"] = `Bearer ${options.token}`;
    }
  }
  let reqBody: any = undefined;
  if (options.body !== undefined) {
    if (typeof options.body === "string" || options.body instanceof FormData) {
      reqBody = options.body;
    } else {
      reqBody = JSON.stringify(options.body);
      if (!headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
      }
    }
  }

  const res = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: reqBody,
    signal: options.signal,
  });

  const rawText = await res.text();
  let data: any = rawText;
  try {
    data = JSON.parse(rawText);
  } catch {}

  return { status: res.status, ok: res.ok, headers: res.headers, data, rawText };
}

// ----------------------------------------------------------------------------
// Security Key Leak Assertions
// ----------------------------------------------------------------------------
function assertNoKeyLeakInResponse(
  res: { headers: Headers; rawText: string; data: any },
  secretKey: string,
  testLabel: string
): boolean {
  if (!secretKey || secretKey.length < 4) return true;

  // 1. Check rawText string
  if (res.rawText.includes(secretKey)) {
    console.error(`🚨 KEY LEAK DETECTED in body for [${testLabel}]! Secret found in rawText.`);
    return false;
  }

  // 2. Check all response headers
  for (const [headerKey, headerVal] of res.headers.entries()) {
    if (headerVal.includes(secretKey)) {
      console.error(`🚨 KEY LEAK DETECTED in header [${headerKey}] for [${testLabel}]!`);
      return false;
    }
  }

  // 3. Deep check serialized data
  const serialized = typeof res.data === "string" ? res.data : JSON.stringify(res.data || {});
  if (serialized.includes(secretKey)) {
    console.error(`🚨 KEY LEAK DETECTED in parsed data for [${testLabel}]!`);
    return false;
  }

  return true;
}

// ----------------------------------------------------------------------------
// Main Stress Test Suite
// ----------------------------------------------------------------------------
async function runMilestone3Challenger() {
  console.log("================================================================================");
  console.log("     🛡️ Milestone 3: Empirical Zero Key Leakage & SSE Streaming Challenger       ");
  console.log("================================================================================\n");

  const mockAi = new AdvancedMockAiServer();
  await mockAi.start();
  console.log(`🤖 Mock AI upstream server listening on ${mockAi.getUrl()}`);

  const db = new Database("data/canvas.db");

  // Get Admin session
  let adminToken = "";
  const adminRow = db.query("SELECT * FROM users WHERE role = 'admin' AND status = 'active' LIMIT 1").get() as any;
  if (adminRow) {
    adminToken = jwt.sign(
      { userId: adminRow.id, sub: adminRow.id, username: adminRow.username, role: adminRow.role },
      JWT_SECRET,
      { expiresIn: "1h" }
    );
    record("Setup", "Admin credentials obtained", true, true, true);
  } else {
    console.error("No active admin user found in database!");
    process.exit(1);
  }

  // Create Standard User session
  const stdUsername = `m3_challenger_${Date.now().toString().slice(-6)}`;
  const stdPassword = "ChallengerUserPass123!";
  const userCreateRes = await apiRequest("/api/admin/users", {
    method: "POST",
    token: adminToken,
    body: { username: stdUsername, password: stdPassword, role: "user", displayName: "M3 Challenger Tester" },
  });
  const stdUserId = userCreateRes.data?.user?.id;
  const userLoginRes = await apiRequest("/api/auth/login", {
    method: "POST",
    body: { username: stdUsername, password: stdPassword },
  });
  const stdToken = userLoginRes.data?.token;
  record("Setup", "Standard user authenticated", userLoginRes.status === 200 && !!stdToken, 200, userLoginRes.status);

  // Secret API Key with high entropy and special pattern
  const SECRET_KEY = "sk-live-super-secret-production-key-998877665544332211";

  // Configure AI Settings
  await apiRequest("/api/admin/ai-config", {
    method: "PUT",
    token: adminToken,
    body: {
      baseUrl: mockAi.getUrl(),
      apiKey: SECRET_KEY,
      imageModels: ["gpt-image-2", "dall-e-3", "flux-1-schnell"],
      defaultModel: "gpt-image-2",
      chatModels: ["gpt-4o", "gpt-4o-mini"],
    },
  });

  // ============================================================================
  // SECTION 1: Zero Key Leak Audit Across All Endpoints & Error States
  // ============================================================================
  console.log("\n--- Section 1: Zero Key Leak Audit Across All Endpoints & Status Codes ---");

  // 1.1 GET /api/ai/models
  {
    const res = await apiRequest("/api/ai/models", { token: stdToken });
    const noLeak = assertNoKeyLeakInResponse(res, SECRET_KEY, "1.1 GET /api/ai/models");
    const valid = res.status === 200 && Array.isArray(res.data?.imageModels) && noLeak;
    record("Zero-Key-Leak", "1.1 GET /api/ai/models returns models with ZERO key leak", valid, true, valid);
  }

  // 1.2 POST /api/ai/images/generations (Valid Success)
  {
    mockAi.clear();
    const res = await apiRequest("/api/ai/images/generations", {
      method: "POST",
      token: stdToken,
      body: { prompt: "Generate glowing cyberpunk canvas nodes", model: "gpt-image-2", size: "1024x1024" },
    });
    const lastAuth = mockAi.getLastAuthHeader();
    const upstreamGotKey = !!lastAuth && lastAuth.includes(SECRET_KEY);
    const noLeak = assertNoKeyLeakInResponse(res, SECRET_KEY, "1.2 POST /api/ai/images/generations success");
    const valid = res.status === 200 && upstreamGotKey && noLeak && !!res.data?.data?.[0]?.url;
    record("Zero-Key-Leak", "1.2 POST /api/ai/images/generations attaches key upstream & returns 0 leak to client", valid, true, valid);
  }

  // 1.3 POST /api/ai/images/generations (Empty Prompt Error)
  {
    const res = await apiRequest("/api/ai/images/generations", {
      method: "POST",
      token: stdToken,
      body: { prompt: "", model: "gpt-image-2" },
    });
    const noLeak = assertNoKeyLeakInResponse(res, SECRET_KEY, "1.3 Empty prompt error");
    const valid = res.status === 400 && res.data?.error?.code === "INVALID_PROMPT" && noLeak;
    record("Zero-Key-Leak", "1.3 Invalid/empty prompt rejected with 400 and ZERO key leak", valid, 400, res.status);
  }

  // 1.4 POST /api/ai/images/generations (Upstream 401 Unauthorized Error)
  {
    mockAi.clear();
    mockAi.nextErrorStatus = 401;
    mockAi.nextErrorMessage = `Unauthorized: Invalid API key ${SECRET_KEY}`; // Upstream echo attack!

    const res = await apiRequest("/api/ai/images/generations", {
      method: "POST",
      token: stdToken,
      body: { prompt: "Cyberpunk landscape", model: "gpt-image-2" },
    });
    const noLeak = assertNoKeyLeakInResponse(res, SECRET_KEY, "1.4 Upstream 401");
    // Should map 401 to 502 Bad Gateway and sanitize body
    const valid = res.status === 502 && noLeak && res.rawText.includes("[REDACTED]");
    record("Zero-Key-Leak", "1.4 Upstream 401 with echoed key is mapped to 502 and sanitized to [REDACTED]", valid, 502, res.status);
  }

  // 1.5 POST /api/ai/images/generations (Upstream 429 Rate Limit Error)
  {
    mockAi.clear();
    mockAi.nextErrorStatus = 429;
    mockAi.nextErrorMessage = `Quota exceeded for account associated with key ${SECRET_KEY}`;

    const res = await apiRequest("/api/ai/images/generations", {
      method: "POST",
      token: stdToken,
      body: { prompt: "Cyberpunk landscape", model: "gpt-image-2" },
    });
    const noLeak = assertNoKeyLeakInResponse(res, SECRET_KEY, "1.5 Upstream 429");
    const valid = res.status === 429 && noLeak && res.rawText.includes("[REDACTED]");
    record("Zero-Key-Leak", "1.5 Upstream 429 rate limit returned safely with [REDACTED] and 0 leak", valid, 429, res.status);
  }

  // 1.6 POST /api/ai/images/generations (Upstream 500 Server Error)
  {
    mockAi.clear();
    mockAi.nextErrorStatus = 500;
    mockAi.nextErrorMessage = `Internal crash while processing key ${SECRET_KEY}`;

    const res = await apiRequest("/api/ai/images/generations", {
      method: "POST",
      token: stdToken,
      body: { prompt: "Cyberpunk landscape", model: "gpt-image-2" },
    });
    const noLeak = assertNoKeyLeakInResponse(res, SECRET_KEY, "1.6 Upstream 500");
    const valid = res.status === 502 && noLeak && res.rawText.includes("[REDACTED]");
    record("Zero-Key-Leak", "1.6 Upstream 500 mapped to 502 Bad Gateway with [REDACTED] and 0 leak", valid, 502, res.status);
  }

  // 1.7 POST /api/ai/images/edits (JSON Inpainting)
  {
    mockAi.clear();
    const res = await apiRequest("/api/ai/images/edits", {
      method: "POST",
      token: stdToken,
      body: {
        prompt: "Add neon lighting to canvas",
        image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      },
    });
    const lastAuth = mockAi.getLastAuthHeader();
    const upstreamGotKey = !!lastAuth && lastAuth.includes(SECRET_KEY);
    const noLeak = assertNoKeyLeakInResponse(res, SECRET_KEY, "1.7 POST /api/ai/images/edits JSON");
    const valid = res.status === 200 && upstreamGotKey && noLeak;
    record("Zero-Key-Leak", "1.7 POST /api/ai/images/edits forwards JSON payload with server key & 0 leak", valid, true, valid);
  }

  // 1.8 POST /api/ai/images/edits (Multipart Form Data with image file buffer)
  {
    mockAi.clear();
    const formData = new FormData();
    formData.append("prompt", "Inpaint realistic waterfall");
    formData.append("model", "gpt-image-2");
    const blob = new Blob([Buffer.from("dummy-image-binary-data")], { type: "image/png" });
    formData.append("image", blob, "canvas_source.png");

    const res = await apiRequest("/api/ai/images/edits", {
      method: "POST",
      token: stdToken,
      body: formData,
    });
    const lastAuth = mockAi.getLastAuthHeader();
    const upstreamGotKey = !!lastAuth && lastAuth.includes(SECRET_KEY);
    const noLeak = assertNoKeyLeakInResponse(res, SECRET_KEY, "1.8 POST /api/ai/images/edits Multipart");
    const valid = res.status === 200 && upstreamGotKey && noLeak;
    record("Zero-Key-Leak", "1.8 POST /api/ai/images/edits forwards multipart formData with server key & 0 leak", valid, true, valid);
  }

  // 1.9 POST /api/ai/images/edits (Upstream 401/429/500 Errors)
  {
    mockAi.clear();
    mockAi.nextErrorStatus = 401;
    mockAi.nextErrorMessage = `Key ${SECRET_KEY} is invalid`;

    const res = await apiRequest("/api/ai/images/edits", {
      method: "POST",
      token: stdToken,
      body: { prompt: "Edit waterfall", image: "data:..." },
    });
    const noLeak = assertNoKeyLeakInResponse(res, SECRET_KEY, "1.9 Edits upstream 401");
    const valid = res.status === 502 && noLeak && res.rawText.includes("[REDACTED]");
    record("Zero-Key-Leak", "1.9 POST /api/ai/images/edits upstream error sanitized with 0 key leak", valid, 502, res.status);
  }

  // 1.10 POST /api/ai/chat/completions (Non-Streaming JSON)
  {
    mockAi.clear();
    const res = await apiRequest("/api/ai/chat/completions", {
      method: "POST",
      token: stdToken,
      body: {
        messages: [{ role: "user", content: "Suggest 3 node layouts for canvas workflow" }],
        model: "gpt-4o",
        stream: false,
      },
    });
    const lastAuth = mockAi.getLastAuthHeader();
    const upstreamGotKey = !!lastAuth && lastAuth.includes(SECRET_KEY);
    const noLeak = assertNoKeyLeakInResponse(res, SECRET_KEY, "1.10 Non-streaming chat");
    const valid = res.status === 200 && upstreamGotKey && noLeak && !!res.data?.choices?.[0]?.message?.content;
    record("Zero-Key-Leak", "1.10 POST /api/ai/chat/completions (JSON) forwards server key & returns 0 leak", valid, true, valid);
  }

  // 1.11 POST /api/ai/chat/completions (Missing / Invalid Messages Validation)
  {
    const badRes1 = await apiRequest("/api/ai/chat/completions", {
      method: "POST",
      token: stdToken,
      body: { model: "gpt-4o" },
    });
    const badRes2 = await apiRequest("/api/ai/chat/completions", {
      method: "POST",
      token: stdToken,
      body: { messages: [], model: "gpt-4o" },
    });
    const noLeak1 = assertNoKeyLeakInResponse(badRes1, SECRET_KEY, "1.11 Missing messages");
    const noLeak2 = assertNoKeyLeakInResponse(badRes2, SECRET_KEY, "1.11 Empty messages array");
    const valid = badRes1.status === 400 && badRes2.status === 400 && noLeak1 && noLeak2;
    record("Zero-Key-Leak", "1.11 Chat completions with missing/empty messages rejected with 400 and 0 leak", valid, 400, badRes1.status);
  }

  // 1.12 POST /api/ai/chat/completions (Upstream 401 & 500 Echoing Key)
  {
    mockAi.clear();
    mockAi.nextErrorStatus = 401;
    mockAi.nextErrorMessage = `Chat authentication error with ${SECRET_KEY}`;

    const res401 = await apiRequest("/api/ai/chat/completions", {
      method: "POST",
      token: stdToken,
      body: { messages: [{ role: "user", content: "Hi" }], model: "gpt-4o" },
    });
    const noLeak401 = assertNoKeyLeakInResponse(res401, SECRET_KEY, "1.12 Chat upstream 401");

    mockAi.nextErrorStatus = 500;
    mockAi.nextErrorMessage = `Chat server 500 with ${SECRET_KEY}`;
    const res500 = await apiRequest("/api/ai/chat/completions", {
      method: "POST",
      token: stdToken,
      body: { messages: [{ role: "user", content: "Hi" }], model: "gpt-4o" },
    });
    const noLeak500 = assertNoKeyLeakInResponse(res500, SECRET_KEY, "1.12 Chat upstream 500");

    const valid = res401.status === 502 && res500.status === 502 && noLeak401 && noLeak500 && res401.rawText.includes("[REDACTED]");
    record("Zero-Key-Leak", "1.12 Chat completions upstream 401/500 sanitized to [REDACTED] with 0 leak", valid, 502, res401.status);
  }

  // ============================================================================
  // SECTION 2: SSE Chat Streaming Fidelity & In-Flight Key Redaction
  // ============================================================================
  console.log("\n--- Section 2: SSE Chat Streaming Protocol & Data Delivery ---");

  // 2.1 Complete SSE Stream Delivery & Protocol Validation
  {
    mockAi.clear();
    mockAi.streamChunkCount = 3;
    mockAi.streamChunkDelayMs = 10;

    const url = `${BASE_URL}/api/ai/chat/completions`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${stdToken}`,
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Test streaming SSE" }],
        model: "gpt-4o",
        stream: true,
      }),
    });

    const isSseContentType = response.headers.get("content-type")?.includes("text/event-stream");
    const isCacheNoCache = response.headers.get("cache-control")?.includes("no-cache");
    const chunksReceived: string[] = [];
    let fullStreamText = "";

    if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        chunksReceived.push(text);
        fullStreamText += text;
      }
    }

    const hasDoneMarker = fullStreamText.includes("data: [DONE]");
    const hasDataLines = fullStreamText.includes("data: {");
    const noLeak = !fullStreamText.includes(SECRET_KEY);
    const valid =
      response.status === 200 &&
      !!isSseContentType &&
      !!isCacheNoCache &&
      hasDoneMarker &&
      hasDataLines &&
      chunksReceived.length >= 1 &&
      noLeak;

    record("SSE-Streaming", "2.1 SSE stream headers, chunk delivery, data format, and [DONE] termination verified",
      valid, true, valid
    );
  }

  // 2.2 In-Flight Key Leak Redaction during SSE Stream
  {
    mockAi.clear();
    mockAi.streamChunkCount = 3;
    mockAi.streamChunkDelayMs = 10;
    mockAi.injectKeyInStream = SECRET_KEY; // Deliberate upstream stream leak!

    const url = `${BASE_URL}/api/ai/chat/completions`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${stdToken}`,
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Test streaming leak injection" }],
        model: "gpt-4o",
        stream: true,
      }),
    });

    let streamedContent = "";
    if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        streamedContent += decoder.decode(value, { stream: true });
      }
    }

    const rawKeyFound = streamedContent.includes(SECRET_KEY);
    const wasRedacted = streamedContent.includes("[REDACTED]");
    const valid = !rawKeyFound && wasRedacted;

    record("SSE-Streaming", "2.2 In-flight key in SSE chunks is sanitized to [REDACTED] in real-time",
      valid, { rawKeyFound: false, wasRedacted: true }, { rawKeyFound, wasRedacted }
    );
  }

  // 2.3 Streaming with Upstream Error (401 / 429) returns JSON error safely
  {
    mockAi.clear();
    mockAi.nextErrorStatus = 401;
    mockAi.nextErrorMessage = `Stream auth error with ${SECRET_KEY}`;

    const res = await apiRequest("/api/ai/chat/completions", {
      method: "POST",
      token: stdToken,
      body: {
        messages: [{ role: "user", content: "Stream error test" }],
        model: "gpt-4o",
        stream: true,
      },
    });

    const noLeak = assertNoKeyLeakInResponse(res, SECRET_KEY, "2.3 SSE upstream error");
    const valid = res.status === 502 && noLeak && res.rawText.includes("[REDACTED]");
    record("SSE-Streaming", "2.3 Stream initiation failure with upstream 401 returns 502 with [REDACTED] and 0 leak",
      valid, 502, res.status
    );
  }

  // ============================================================================
  // SECTION 3: Client Abort & Upstream Cancellation Empirical Verification
  // ============================================================================
  console.log("\n--- Section 3: Empirical SSE Mid-Stream Client Abort & Upstream Cancellation ---");

  // 3.1 Mid-Stream Client Abort Triggers Clean Upstream Fetch Cancellation
  {
    mockAi.clear();
    mockAi.streamChunkCount = 10;
    mockAi.streamChunkDelayMs = 60; // 600ms total stream duration

    const abortController = new AbortController();
    const url = `${BASE_URL}/api/ai/chat/completions`;

    const streamPromise = fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${stdToken}`,
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Mid-stream abort test" }],
        model: "gpt-4o",
        stream: true,
      }),
      signal: abortController.signal,
    });

    const response = await streamPromise;
    let chunksRead = 0;

    if (response.body) {
      const reader = response.body.getReader();
      try {
        while (chunksRead < 2) {
          const { done, value } = await reader.read();
          if (done) break;
          chunksRead++;
        }
      } catch {}
      // Abruptly abort client connection mid-stream
      abortController.abort();
    }

    // Give backend & upstream 150ms to propagate close event
    await new Promise((r) => setTimeout(r, 150));

    const upstreamAborted = mockAi.abortedStreamConnections > 0;
    const latency = mockAi.lastAbortLatencyMs;

    // Verify backend is immediately responsive for new requests
    const pingStart = Date.now();
    const pingRes = await apiRequest("/api/ai/models", { token: stdToken });
    const pingLatency = Date.now() - pingStart;

    const valid = upstreamAborted && pingRes.status === 200 && pingLatency < 100;
    record("SSE-Abort", `3.1 Client abort mid-stream propagated to upstream mock (${mockAi.abortedStreamConnections} aborted, ping: ${pingLatency}ms)`,
      valid, true, valid, `Upstream detected client socket abort in ${latency}ms`
    );
  }

  // 3.2 Immediate Client Disconnect (Client aborts immediately before chunk arrival)
  {
    mockAi.clear();
    mockAi.streamChunkCount = 8;
    mockAi.streamChunkDelayMs = 50;

    const abortController = new AbortController();
    const url = `${BASE_URL}/api/ai/chat/completions`;

    const streamPromise = fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${stdToken}`,
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Immediate abort test" }],
        model: "gpt-4o",
        stream: true,
      }),
      signal: abortController.signal,
    });

    // Abort after 5ms immediately
    setTimeout(() => abortController.abort(), 5);

    try {
      await streamPromise;
    } catch {}

    await new Promise((r) => setTimeout(r, 150));
    const pingRes = await apiRequest("/api/ai/models", { token: stdToken });
    const valid = pingRes.status === 200;
    record("SSE-Abort", "3.2 Immediate client abort before 1st chunk handled without server crash or hang",
      valid, 200, pingRes.status
    );
  }

  // 3.3 High-Concurrency SSE Streams with Mixed Aborts and Completions
  {
    mockAi.clear();
    mockAi.streamChunkCount = 6;
    mockAi.streamChunkDelayMs = 40;

    const totalConnections = 10;
    const abortIndices = new Set([0, 2, 4, 6, 8]); // Abort 5 out of 10
    const streamTasks: Promise<{ index: number; completed: boolean; aborted: boolean; chunks: number }>[] = [];

    for (let i = 0; i < totalConnections; i++) {
      const isAbort = abortIndices.has(i);
      const controller = new AbortController();
      const task = (async () => {
        try {
          const res = await fetch(`${BASE_URL}/api/ai/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${stdToken}`,
            },
            body: JSON.stringify({
              messages: [{ role: "user", content: `Concurrent stream #${i}` }],
              model: "gpt-4o",
              stream: true,
            }),
            signal: controller.signal,
          });

          let chunkCount = 0;
          if (res.body) {
            const reader = res.body.getReader();
            while (true) {
              const { done } = await reader.read();
              if (done) break;
              chunkCount++;
              if (isAbort && chunkCount >= 2) {
                controller.abort();
                return { index: i, completed: false, aborted: true, chunks: chunkCount };
              }
            }
          }
          return { index: i, completed: true, aborted: false, chunks: chunkCount };
        } catch {
          return { index: i, completed: false, aborted: isAbort, chunks: 0 };
        }
      })();
      streamTasks.push(task);
    }

    const taskResults = await Promise.all(streamTasks);
    await new Promise((r) => setTimeout(r, 200));

    const completedCount = taskResults.filter((r) => r.completed).length;
    const abortedCount = taskResults.filter((r) => r.aborted).length;
    const pingRes = await apiRequest("/api/ai/models", { token: stdToken });

    const valid = completedCount === 5 && abortedCount === 5 && pingRes.status === 200;
    record("SSE-Abort", `3.3 10 concurrent streams (5 completed, 5 aborted mid-flight) cleanly isolated`,
      valid, { completed: 5, aborted: 5, serverHealthy: true },
      { completed: completedCount, aborted: abortedCount, serverHealthy: pingRes.status === 200 }
    );
  }

  // ============================================================================
  // SECTION 4: Unconfigured AI State & Key Rotation Invariants
  // ============================================================================
  console.log("\n--- Section 4: Unconfigured AI State & Key Rotation Invariants ---");

  // 4.1 Unconfigured AI State (Empty Key) -> 503 AI_NOT_CONFIGURED
  {
    // Clear API Key in DB
    db.prepare("UPDATE system_settings SET value = '' WHERE key = 'ai.api_key'").run();

    const genRes = await apiRequest("/api/ai/images/generations", {
      method: "POST",
      token: stdToken,
      body: { prompt: "Test unconfigured" },
    });
    const editRes = await apiRequest("/api/ai/images/edits", {
      method: "POST",
      token: stdToken,
      body: { prompt: "Test unconfigured edit" },
    });
    const chatJsonRes = await apiRequest("/api/ai/chat/completions", {
      method: "POST",
      token: stdToken,
      body: { messages: [{ role: "user", content: "Test unconfigured" }], stream: false },
    });
    const chatStreamRes = await apiRequest("/api/ai/chat/completions", {
      method: "POST",
      token: stdToken,
      body: { messages: [{ role: "user", content: "Test unconfigured" }], stream: true },
    });

    const all503 =
      genRes.status === 503 &&
      editRes.status === 503 &&
      chatJsonRes.status === 503 &&
      chatStreamRes.status === 503 &&
      genRes.data?.error?.code === "AI_NOT_CONFIGURED";

    record("Unconfigured-AI", "4.1 Unconfigured AI state returns 503 AI_NOT_CONFIGURED across all endpoints",
      all503, { gen: 503, edit: 503, chat: 503, stream: 503 },
      { gen: genRes.status, edit: editRes.status, chat: chatJsonRes.status, stream: chatStreamRes.status }
    );
  }

  // 4.2 Dynamic Key Rotation (Key A -> Key B without server restart)
  {
    const KEY_A = "sk-rotation-key-alpha-111111111111111111";
    const KEY_B = "sk-rotation-key-beta-2222222222222222222";

    // Set Key A
    await apiRequest("/api/admin/ai-config", {
      method: "PUT",
      token: adminToken,
      body: { baseUrl: mockAi.getUrl(), apiKey: KEY_A },
    });

    mockAi.clear();
    await apiRequest("/api/ai/images/generations", {
      method: "POST",
      token: stdToken,
      body: { prompt: "Key A prompt" },
    });
    const authA = mockAi.getLastAuthHeader();
    const gotKeyA = !!authA && authA.includes(KEY_A);

    // Rotate to Key B
    await apiRequest("/api/admin/ai-config", {
      method: "PUT",
      token: adminToken,
      body: { baseUrl: mockAi.getUrl(), apiKey: KEY_B },
    });

    mockAi.clear();
    await apiRequest("/api/ai/images/generations", {
      method: "POST",
      token: stdToken,
      body: { prompt: "Key B prompt" },
    });
    const authB = mockAi.getLastAuthHeader();
    const gotKeyB = !!authB && authB.includes(KEY_B) && !authB.includes(KEY_A);

    const valid = gotKeyA && gotKeyB;
    record("Key-Rotation", "4.2 Dynamic key rotation immediately applies new key to upstream requests",
      valid, { gotKeyA: true, gotKeyB: true }, { gotKeyA, gotKeyB }
    );
  }

  // ============================================================================
  // SECTION 5: Authentication Guards & Token Tampering on /api/ai/*
  // ============================================================================
  console.log("\n--- Section 5: Authentication Guards & Tampering on /api/ai/* ---");

  // 5.1 Unauthenticated requests to all /api/ai/* endpoints return 401
  {
    const endpoints = [
      { path: "/api/ai/models", method: "GET" },
      { path: "/api/ai/images/generations", method: "POST", body: { prompt: "p" } },
      { path: "/api/ai/images/edits", method: "POST", body: { prompt: "p" } },
      { path: "/api/ai/chat/completions", method: "POST", body: { messages: [{ role: "user", content: "c" }] } },
    ];

    let all401 = true;
    for (const ep of endpoints) {
      const res = await apiRequest(ep.path, { method: ep.method, token: null, body: ep.body });
      if (res.status !== 401) {
        all401 = false;
        console.error(`Endpoint ${ep.method} ${ep.path} unauth status: ${res.status}`);
      }
    }
    record("Auth-Guards", "5.1 All 4 /api/ai/* endpoints reject unauthenticated requests with 401 UNAUTHORIZED",
      all401, true, all401
    );
  }

  // 5.2 Tampered / Malicious JWT Tokens
  {
    const forgedToken = jwt.sign({ userId: stdUserId, sub: stdUserId, role: "user" }, "FAKE_SECRET_123");
    const res = await apiRequest("/api/ai/models", { token: forgedToken });
    const valid = res.status === 401 && res.data?.error?.code === "INVALID_TOKEN";
    record("Auth-Guards", "5.2 Tampered signature JWT rejected with 401 INVALID_TOKEN", valid, 401, res.status);
  }

  // 5.3 Disabled User Token blocked from /api/ai/*
  {
    // Disable user
    await apiRequest(`/api/admin/users/${stdUserId}/status`, {
      method: "PATCH",
      token: adminToken,
      body: { status: "disabled" },
    });

    const res = await apiRequest("/api/ai/models", { token: stdToken });
    const valid = res.status === 403 && res.data?.error?.code === "ACCOUNT_DISABLED";
    record("Auth-Guards", "5.3 Disabled user instantly blocked from /api/ai/* with 403 ACCOUNT_DISABLED",
      valid, 403, res.status
    );
  }

  // Cleanup
  if (stdUserId) {
    await apiRequest(`/api/admin/users/${stdUserId}`, { method: "DELETE", token: adminToken });
  }
  await mockAi.stop();

  // Summary
  console.log("\n================================================================================");
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`🏁 Milestone 3 Total Empirical Challenges: ${total}`);
  console.log(`\x1b[32m   Passed:                                  ${passed}\x1b[0m`);
  if (failed > 0) {
    console.log(`\x1b[31m   Failed:                                  ${failed}\x1b[0m`);
  }
  console.log("================================================================================\n");

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runMilestone3Challenger().catch((err) => {
  console.error("Fatal error running M3 stress harness:", err);
  process.exit(1);
});
