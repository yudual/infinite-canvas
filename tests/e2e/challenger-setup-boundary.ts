import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const TEST_PORT = 3002;
const TEST_DB = path.resolve(process.cwd(), "data/test_setup_boundary.db");
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

// Clean test db
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

interface TestResult {
  name: string;
  passed: boolean;
  expected: any;
  actual: any;
}
const results: TestResult[] = [];

function record(name: string, passed: boolean, expected: any, actual: any) {
  results.push({ name, passed, expected, actual });
  const icon = passed ? "\x1b[32m✔ PASS\x1b[0m" : "\x1b[31m✖ FAIL\x1b[0m";
  console.log(`  ${icon} ${name}`);
  if (!passed) console.error(`     Expected: ${JSON.stringify(expected)} | Actual: ${JSON.stringify(actual)}`);
}

async function request(path: string, options: { method?: string; body?: any } = {}) {
  const url = `${BASE_URL}${path.startsWith('/') ? path : '/' + path}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const res = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const rawText = await res.text();
  let data: any = rawText;
  try { data = JSON.parse(rawText); } catch {}
  return { status: res.status, data };
}

async function main() {
  console.log("================================================================================");
  console.log("       🛡️  Milestone 1 Setup Wizard Boundary & Concurrency Stress                ");
  console.log("================================================================================\n");

  const serverProcess = spawn("bun", ["run", "server/src/index.ts"], {
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      DB_PATH: TEST_DB,
    },
    stdio: "pipe",
  });

  // Wait for server to start
  let started = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${BASE_URL}/api/setup/status`);
      if (res.ok) { started = true; break; }
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }

  if (!started) {
    console.error("Failed to start isolated test server on port 3002");
    serverProcess.kill();
    process.exit(1);
  }

  // 1. Check uninitialized status
  const status1 = await request("/api/setup/status");
  record("Setup status initialized=false when fresh", status1.data?.initialized === false && status1.data?.requiresSetup === true, { initialized: false, requiresSetup: true }, status1.data);

  // 2. Setup boundary: Empty payload
  const resEmpty = await request("/api/setup", { method: "POST", body: {} });
  record("POST /api/setup with empty body rejected (400)", resEmpty.status === 400, 400, resEmpty.status);

  // 3. Setup boundary: Username < 3 chars
  const resLen1 = await request("/api/setup", { method: "POST", body: { username: "a", password: "Password123!" } });
  record("POST /api/setup username 1-char rejected (400 INVALID_USERNAME)", resLen1.status === 400 && resLen1.data?.error?.code === "INVALID_USERNAME", 400, resLen1.status);

  const resLen2 = await request("/api/setup", { method: "POST", body: { username: "ab", password: "Password123!" } });
  record("POST /api/setup username 2-char (<3) rejected (400 INVALID_USERNAME)", resLen2.status === 400 && resLen2.data?.error?.code === "INVALID_USERNAME", 400, resLen2.status);

  // 4. Setup boundary: Username > 32 chars (33 chars)
  const resLen33 = await request("/api/setup", { method: "POST", body: { username: "a".repeat(33), password: "Password123!" } });
  record("POST /api/setup username 33-char (>32) rejected (400 INVALID_USERNAME)", resLen33.status === 400 && resLen33.data?.error?.code === "INVALID_USERNAME", 400, resLen33.status);

  // 5. Setup boundary: Invalid characters in username
  const resInvalidChar = await request("/api/setup", { method: "POST", body: { username: "admin@test.com", password: "Password123!" } });
  record("POST /api/setup username with special chars rejected (400 INVALID_USERNAME_FORMAT)", resInvalidChar.status === 400 && resInvalidChar.data?.error?.code === "INVALID_USERNAME_FORMAT", 400, resInvalidChar.status);

  const resXss = await request("/api/setup", { method: "POST", body: { username: "<script>alert(1)</script>", password: "Password123!" } });
  record("POST /api/setup username with XSS rejected (400 INVALID_USERNAME_FORMAT)", resXss.status === 400 && resXss.data?.error?.code === "INVALID_USERNAME_FORMAT", 400, resXss.status);

  // 6. Setup boundary: Password < 6 chars
  const resPwShort = await request("/api/setup", { method: "POST", body: { username: "validadmin", password: "12345" } });
  record("POST /api/setup password 5-char (<6) rejected (400 INVALID_PASSWORD)", resPwShort.status === 400 && resPwShort.data?.error?.code === "INVALID_PASSWORD", 400, resPwShort.status);

  // 7. Setup boundary: Valid min boundaries (username 3 chars, password 6 chars)
  const resValidMin = await request("/api/setup", {
    method: "POST",
    body: {
      username: "adm",
      password: "123456",
      displayName: "Min Bound Admin",
      aiConfig: {
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-test123456789",
        defaultModel: "dall-e-3",
        imageModels: ["dall-e-3", "dall-e-2"],
      }
    }
  });
  record("POST /api/setup valid min boundary (3-char username, 6-char password) created (201)",
    resValidMin.status === 201 && resValidMin.data?.user?.role === "admin" && typeof resValidMin.data?.token === "string",
    201, resValidMin.status
  );

  // 8. Re-setup rejection: Once initialized, subsequent POST /api/setup returns 403 ALREADY_INITIALIZED
  const resReSetup = await request("/api/setup", {
    method: "POST",
    body: { username: "secondadmin", password: "Password123!" }
  });
  record("POST /api/setup when already initialized returns 403 ALREADY_INITIALIZED",
    resReSetup.status === 403 && resReSetup.data?.error?.code === "ALREADY_INITIALIZED",
    403, resReSetup.status
  );

  // 9. Status check now returns initialized=true, requiresSetup=false
  const status2 = await request("/api/setup/status");
  record("Setup status initialized=true after setup",
    status2.data?.initialized === true && status2.data?.requiresSetup === false,
    { initialized: true, requiresSetup: false }, status2.data
  );

  // Teardown
  serverProcess.kill();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

  console.log("\n================================================================================");
  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`🏁 Total Setup Boundaries: ${total}`);
  console.log(`\x1b[32m   Passed:                 ${passed}\x1b[0m`);
  if (failed > 0) {
    console.log(`\x1b[31m   Failed:                 ${failed}\x1b[0m`);
  }
  console.log("================================================================================\n");

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error("Setup boundary runner failed:", err);
  process.exit(1);
});
