import jwt from "jsonwebtoken";
import { Database } from "bun:sqlite";
import { JWT_SECRET } from "../../server/src/config.js";
import { MockAiServer } from "./harness/mock-ai-server.js";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3001";
const MOCK_AI_PORT = 3199;

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

async function request(
  path: string,
  options: {
    method?: string;
    token?: string | null;
    body?: any;
    headers?: Record<string, string>;
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
    reqBody = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
    if (!headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
  }

  const res = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: reqBody,
  });

  const rawText = await res.text();
  let data: any = rawText;
  try {
    data = JSON.parse(rawText);
  } catch {}

  return { status: res.status, ok: res.ok, headers: res.headers, data, rawText };
}

async function runMilestone2StressTests() {
  console.log("================================================================================");
  console.log("       🛡️ Milestone 2 Empirical RBAC & User Management Stress Suite             ");
  console.log("================================================================================\n");

  const mockAi = new MockAiServer(MOCK_AI_PORT);
  await mockAi.start();

  // Setup Admin and Regular user sessions
  let adminToken = "";
  let adminId = "";
  let adminUsername = "";

  const db = new Database("data/canvas.db");
  const adminRow = db.query("SELECT * FROM users WHERE role = 'admin' AND status = 'active' LIMIT 1").get() as any;
  if (adminRow) {
    adminId = adminRow.id;
    adminUsername = adminRow.username;
    adminToken = jwt.sign(
      { userId: adminRow.id, sub: adminRow.id, username: adminRow.username, role: adminRow.role },
      JWT_SECRET,
      { expiresIn: "1h" }
    );
    record("Setup", "Admin session obtained", true, true, true);
  } else {
    // Fallback initialize
    const setupRes = await request("/api/setup", {
      method: "POST",
      body: { username: "admin", password: "AdminPassword123!", displayName: "Initial Super Admin" },
    });
    if (setupRes.ok && setupRes.data?.token) {
      adminToken = setupRes.data.token;
      adminId = setupRes.data.user.id;
      adminUsername = setupRes.data.user.username;
      record("Setup", "First admin created via setup", true, true, true);
    } else {
      record("Setup", "Admin setup failed", false, true, false);
      process.exit(1);
    }
  }

  // Create a standard non-admin user for RBAC isolation testing
  const stdUsername = `std_user_${Date.now().toString().slice(-6)}`;
  const stdPassword = "StandardUserPass123!";
  const createStdRes = await request("/api/admin/users", {
    method: "POST",
    token: adminToken,
    body: {
      username: stdUsername,
      password: stdPassword,
      role: "user",
      displayName: "Standard RBAC Test User",
    },
  });

  const stdUserId = createStdRes.data?.user?.id;
  const stdLoginRes = await request("/api/auth/login", {
    method: "POST",
    body: { username: stdUsername, password: stdPassword },
  });
  const stdToken = stdLoginRes.data?.token;

  record("Setup", "Standard non-admin user created and authenticated", stdLoginRes.status === 200 && !!stdToken, 200, stdLoginRes.status);

  // ============================================================================
  // 1. RBAC Isolation: All /api/admin/* endpoints MUST return 403 Forbidden for standard user
  // ============================================================================
  console.log("\n--- Section 1: RBAC Isolation Testing (Standard User -> 403 Forbidden) ---");

  // 1.1 GET /api/admin/users
  {
    const res = await request("/api/admin/users", { token: stdToken });
    record("RBAC-Isolation", "1.1 GET /api/admin/users returns 403 Forbidden",
      res.status === 403 && res.data?.error?.code === "FORBIDDEN",
      { status: 403, code: "FORBIDDEN" },
      { status: res.status, code: res.data?.error?.code }
    );
  }

  // 1.2 POST /api/admin/users (attempting privilege escalation / unauthorized user creation)
  {
    const res = await request("/api/admin/users", {
      method: "POST",
      token: stdToken,
      body: { username: `hacked_${Date.now()}`, password: "Password123!", role: "admin" },
    });
    record("RBAC-Isolation", "1.2 POST /api/admin/users returns 403 Forbidden",
      res.status === 403 && res.data?.error?.code === "FORBIDDEN",
      { status: 403, code: "FORBIDDEN" },
      { status: res.status, code: res.data?.error?.code }
    );
  }

  // 1.3 PATCH /api/admin/users/:id/status (attempting to disable admin)
  {
    const res = await request(`/api/admin/users/${adminId}/status`, {
      method: "PATCH",
      token: stdToken,
      body: { status: "disabled" },
    });
    record("RBAC-Isolation", "1.3 PATCH /api/admin/users/:id/status returns 403 Forbidden",
      res.status === 403 && res.data?.error?.code === "FORBIDDEN",
      { status: 403, code: "FORBIDDEN" },
      { status: res.status, code: res.data?.error?.code }
    );
  }

  // 1.4 POST /api/admin/users/:id/reset-password (attempting to hijack admin account)
  {
    const res = await request(`/api/admin/users/${adminId}/reset-password`, {
      method: "POST",
      token: stdToken,
      body: { newPassword: "HackedPassword123!" },
    });
    record("RBAC-Isolation", "1.4 POST /api/admin/users/:id/reset-password returns 403 Forbidden",
      res.status === 403 && res.data?.error?.code === "FORBIDDEN",
      { status: 403, code: "FORBIDDEN" },
      { status: res.status, code: res.data?.error?.code }
    );
  }

  // 1.5 DELETE /api/admin/users/:id (attempting to delete admin account)
  {
    const res = await request(`/api/admin/users/${adminId}`, {
      method: "DELETE",
      token: stdToken,
    });
    record("RBAC-Isolation", "1.5 DELETE /api/admin/users/:id returns 403 Forbidden",
      res.status === 403 && res.data?.error?.code === "FORBIDDEN",
      { status: 403, code: "FORBIDDEN" },
      { status: res.status, code: res.data?.error?.code }
    );
  }

  // 1.6 GET /api/admin/ai-config
  {
    const res = await request("/api/admin/ai-config", { token: stdToken });
    record("RBAC-Isolation", "1.6 GET /api/admin/ai-config returns 403 Forbidden",
      res.status === 403 && res.data?.error?.code === "FORBIDDEN",
      { status: 403, code: "FORBIDDEN" },
      { status: res.status, code: res.data?.error?.code }
    );
  }

  // 1.7 PUT /api/admin/ai-config
  {
    const res = await request("/api/admin/ai-config", {
      method: "PUT",
      token: stdToken,
      body: { baseUrl: "http://malicious.url", apiKey: "sk-evil" },
    });
    record("RBAC-Isolation", "1.7 PUT /api/admin/ai-config returns 403 Forbidden",
      res.status === 403 && res.data?.error?.code === "FORBIDDEN",
      { status: 403, code: "FORBIDDEN" },
      { status: res.status, code: res.data?.error?.code }
    );
  }

  // 1.8 POST /api/admin/ai-config/test
  {
    const res = await request("/api/admin/ai-config/test", {
      method: "POST",
      token: stdToken,
      body: { baseUrl: mockAi.getUrl() },
    });
    record("RBAC-Isolation", "1.8 POST /api/admin/ai-config/test returns 403 Forbidden",
      res.status === 403 && res.data?.error?.code === "FORBIDDEN",
      { status: 403, code: "FORBIDDEN" },
      { status: res.status, code: res.data?.error?.code }
    );
  }

  // 1.9 GET /api/admin/stats
  {
    const res = await request("/api/admin/stats", { token: stdToken });
    record("RBAC-Isolation", "1.9 GET /api/admin/stats returns 403 Forbidden",
      res.status === 403 && res.data?.error?.code === "FORBIDDEN",
      { status: 403, code: "FORBIDDEN" },
      { status: res.status, code: res.data?.error?.code }
    );
  }

  // 1.10 Unauthenticated requests to all admin endpoints return 401 Unauthorized
  {
    const unauthEndpoints = [
      { path: "/api/admin/users", method: "GET" },
      { path: "/api/admin/users", method: "POST", body: { username: "x" } },
      { path: `/api/admin/users/${adminId}/status`, method: "PATCH", body: { status: "disabled" } },
      { path: `/api/admin/users/${adminId}/reset-password`, method: "POST", body: { newPassword: "p" } },
      { path: `/api/admin/users/${adminId}`, method: "DELETE" },
      { path: "/api/admin/ai-config", method: "GET" },
      { path: "/api/admin/ai-config", method: "PUT", body: {} },
      { path: "/api/admin/ai-config/test", method: "POST", body: {} },
      { path: "/api/admin/stats", method: "GET" },
    ];

    let allUnauth401 = true;
    for (const ep of unauthEndpoints) {
      const res = await request(ep.path, { method: ep.method, token: null, body: ep.body });
      if (res.status !== 401) {
        allUnauth401 = false;
        console.error(`Endpoint ${ep.method} ${ep.path} returned ${res.status} instead of 401`);
      }
    }
    record("RBAC-Isolation", "1.10 All 9 /api/admin/* endpoints reject unauthenticated requests with 401",
      allUnauth401, true, allUnauth401
    );
  }

  // 1.11 Forged / tampered token with role: admin injected
  {
    const forgedToken = jwt.sign(
      { userId: stdUserId, sub: stdUserId, username: stdUsername, role: "admin" },
      "WRONG_SECRET_KEY_12345"
    );
    const res = await request("/api/admin/users", { token: forgedToken });
    record("RBAC-Isolation", "1.11 Forged token with role: 'admin' signed by wrong key rejected with 401",
      res.status === 401, 401, res.status
    );
  }

  // ============================================================================
  // 2. Admin Self-Protection & Guard Boundary Testing
  // ============================================================================
  console.log("\n--- Section 2: Admin Self-Protection (400 Bad Request) ---");

  // 2.1 Admin attempting PATCH /api/admin/users/:adminId/status to disabled
  {
    const res = await request(`/api/admin/users/${adminId}/status`, {
      method: "PATCH",
      token: adminToken,
      body: { status: "disabled" },
    });
    record("Self-Protection", "2.1 Admin disabling own account returns 400 CANNOT_DISABLE_SELF",
      res.status === 400 && res.data?.error?.code === "CANNOT_DISABLE_SELF",
      { status: 400, code: "CANNOT_DISABLE_SELF" },
      { status: res.status, code: res.data?.error?.code }
    );
  }

  // 2.2 Admin attempting DELETE /api/admin/users/:adminId
  {
    const res = await request(`/api/admin/users/${adminId}`, {
      method: "DELETE",
      token: adminToken,
    });
    record("Self-Protection", "2.2 Admin deleting own account returns 400 CANNOT_DELETE_SELF",
      res.status === 400 && res.data?.error?.code === "CANNOT_DELETE_SELF",
      { status: 400, code: "CANNOT_DELETE_SELF" },
      { status: res.status, code: res.data?.error?.code }
    );
  }

  // 2.3 Verify admin account remained active and intact
  {
    const adminCheck = await request("/api/auth/me", { token: adminToken });
    record("Self-Protection", "2.3 Admin account remains active and functional after blocked self-attacks",
      adminCheck.status === 200 && adminCheck.data?.user?.status === "active",
      200, adminCheck.status
    );
  }

  // ============================================================================
  // 3. User Lifecycle: Create -> Login -> Reset Pwd -> Old Pwd Fail -> New Pwd Login -> Disable -> 403 Revocation -> Re-enable -> Delete -> 401 Post-Delete
  // ============================================================================
  console.log("\n--- Section 3: User Lifecycle Stress-Testing ---");

  const lcUsername = `lifecycle_${Date.now().toString().slice(-6)}`;
  const lcInitPassword = "InitialLcPassword123!";
  const lcNewPassword = "NewUpdatedLcPass456!";
  let lcUserId = "";
  let lcToken = "";

  // 3.1 Step A: Admin creates user
  {
    const res = await request("/api/admin/users", {
      method: "POST",
      token: adminToken,
      body: {
        username: lcUsername,
        password: lcInitPassword,
        role: "user",
        displayName: "Lifecycle Test Subject",
      },
    });
    lcUserId = res.data?.user?.id;
    record("User-Lifecycle", "3.1 Admin creates user (201 Created)",
      res.status === 201 && !!lcUserId && res.data?.user?.username === lcUsername,
      201, res.status
    );
  }

  // 3.2 Step B: User logs in immediately
  {
    const res = await request("/api/auth/login", {
      method: "POST",
      body: { username: lcUsername, password: lcInitPassword },
    });
    lcToken = res.data?.token;
    record("User-Lifecycle", "3.2 New user logs in immediately with initial credentials",
      res.status === 200 && !!lcToken && res.data?.user?.id === lcUserId,
      200, res.status
    );
  }

  // 3.3 Step C: User calls /api/auth/me
  {
    const res = await request("/api/auth/me", { token: lcToken });
    record("User-Lifecycle", "3.3 User verifies session profile via /api/auth/me",
      res.status === 200 && res.data?.user?.username === lcUsername && res.data?.user?.role === "user",
      200, res.status
    );
  }

  // 3.4 Step D: Admin resets user password
  {
    const res = await request(`/api/admin/users/${lcUserId}/reset-password`, {
      method: "POST",
      token: adminToken,
      body: { newPassword: lcNewPassword },
    });
    record("User-Lifecycle", "3.4 Admin resets user password (200 OK)",
      res.status === 200 && res.data?.success === true,
      200, res.status
    );
  }

  // 3.5 Step E: Old password fails login
  {
    const res = await request("/api/auth/login", {
      method: "POST",
      body: { username: lcUsername, password: lcInitPassword },
    });
    record("User-Lifecycle", "3.5 Login with old password rejected with 401 INVALID_CREDENTIALS",
      res.status === 401 && res.data?.error?.code === "INVALID_CREDENTIALS",
      { status: 401, code: "INVALID_CREDENTIALS" },
      { status: res.status, code: res.data?.error?.code }
    );
  }

  // 3.6 Step F: New password succeeds login
  {
    const res = await request("/api/auth/login", {
      method: "POST",
      body: { username: lcUsername, password: lcNewPassword },
    });
    lcToken = res.data?.token;
    record("User-Lifecycle", "3.6 Login with new password succeeds (200 OK + new JWT)",
      res.status === 200 && !!lcToken,
      200, res.status
    );
  }

  // 3.7 Step G: Admin disables user
  {
    const res = await request(`/api/admin/users/${lcUserId}/status`, {
      method: "PATCH",
      token: adminToken,
      body: { status: "disabled" },
    });
    record("User-Lifecycle", "3.7 Admin sets user status to disabled (200 OK)",
      res.status === 200 && res.data?.user?.status === "disabled",
      200, res.status
    );
  }

  // 3.8 Step H: Disabled user cannot log in
  {
    const res = await request("/api/auth/login", {
      method: "POST",
      body: { username: lcUsername, password: lcNewPassword },
    });
    record("User-Lifecycle", "3.8 Disabled user login rejected with 403 ACCOUNT_DISABLED",
      res.status === 403 && res.data?.error?.code === "ACCOUNT_DISABLED",
      { status: 403, code: "ACCOUNT_DISABLED" },
      { status: res.status, code: res.data?.error?.code }
    );
  }

  // 3.9 Step I: Instant Token Revocation Check (pre-existing valid JWT rejected on /api/auth/me)
  {
    const res = await request("/api/auth/me", { token: lcToken });
    record("User-Lifecycle", "3.9 Pre-issued JWT for disabled user instantly rejected with 403 ACCOUNT_DISABLED",
      res.status === 403 && res.data?.error?.code === "ACCOUNT_DISABLED",
      { status: 403, code: "ACCOUNT_DISABLED" },
      { status: res.status, code: res.data?.error?.code }
    );
  }

  // 3.10 Step J: Admin re-enables user
  {
    const res = await request(`/api/admin/users/${lcUserId}/status`, {
      method: "PATCH",
      token: adminToken,
      body: { status: "active" },
    });
    record("User-Lifecycle", "3.10 Admin re-enables user account (200 OK)",
      res.status === 200 && res.data?.user?.status === "active",
      200, res.status
    );
  }

  // 3.11 Step K: Re-enabled user logs in and accesses /api/auth/me
  {
    const loginRes = await request("/api/auth/login", {
      method: "POST",
      body: { username: lcUsername, password: lcNewPassword },
    });
    const newActiveToken = loginRes.data?.token;
    const meRes = await request("/api/auth/me", { token: newActiveToken });
    record("User-Lifecycle", "3.11 Re-enabled user logs in and accesses API successfully",
      loginRes.status === 200 && meRes.status === 200 && meRes.data?.user?.status === "active",
      200, meRes.status
    );
  }

  // 3.12 Step L: Admin deletes user
  {
    const res = await request(`/api/admin/users/${lcUserId}`, {
      method: "DELETE",
      token: adminToken,
    });
    record("User-Lifecycle", "3.12 Admin deletes user (200 OK)",
      res.status === 200 && res.data?.success === true,
      200, res.status
    );
  }

  // 3.13 Step M: Deleted user login attempt rejected with 401
  {
    const res = await request("/api/auth/login", {
      method: "POST",
      body: { username: lcUsername, password: lcNewPassword },
    });
    record("User-Lifecycle", "3.13 Deleted user login attempt rejected with 401 INVALID_CREDENTIALS",
      res.status === 401 && res.data?.error?.code === "INVALID_CREDENTIALS",
      { status: 401, code: "INVALID_CREDENTIALS" },
      { status: res.status, code: res.data?.error?.code }
    );
  }

  // 3.14 Step N: Deleted user's pre-issued JWT rejected with 401 USER_NOT_FOUND
  {
    const res = await request("/api/auth/me", { token: lcToken });
    record("User-Lifecycle", "3.14 Deleted user's token rejected with 401 USER_NOT_FOUND",
      res.status === 401 && res.data?.error?.code === "USER_NOT_FOUND",
      { status: 401, code: "USER_NOT_FOUND" },
      { status: res.status, code: res.data?.error?.code }
    );
  }

  // 3.15 Step O: Operations on deleted user ID return 404 Not Found
  {
    const patchRes = await request(`/api/admin/users/${lcUserId}/status`, {
      method: "PATCH",
      token: adminToken,
      body: { status: "active" },
    });
    const resetRes = await request(`/api/admin/users/${lcUserId}/reset-password`, {
      method: "POST",
      token: adminToken,
      body: { newPassword: "SomeNewPassword123!" },
    });
    const delRes = await request(`/api/admin/users/${lcUserId}`, {
      method: "DELETE",
      token: adminToken,
    });

    const all404 = patchRes.status === 404 && resetRes.status === 404 && delRes.status === 404;
    record("User-Lifecycle", "3.15 PATCH, reset-password, and DELETE on deleted user return 404 USER_NOT_FOUND",
      all404, { patch: 404, reset: 404, del: 404 }, { patch: patchRes.status, reset: resetRes.status, del: delRes.status }
    );
  }

  // ============================================================================
  // 4. AI Configuration & System Stats Stress Testing
  // ============================================================================
  console.log("\n--- Section 4: AI Configuration & System Stats Stress Testing ---");

  // 4.1 Update AI config with fresh settings and raw API key
  const secretKey = "sk-live-production-secret-ai-token-123456789";
  {
    const putRes = await request("/api/admin/ai-config", {
      method: "PUT",
      token: adminToken,
      body: {
        baseUrl: mockAi.getUrl(),
        apiKey: secretKey,
        imageModels: ["gpt-image-2", "dall-e-3", "flux-1-schnell"],
        defaultModel: "flux-1-schnell",
        chatModels: ["gpt-4o", "gpt-4o-mini", "claude-3-5-sonnet"],
      },
    });
    record("AI-Config", "4.1 Admin updates AI configuration (200 OK)", putRes.status === 200, 200, putRes.status);
  }

  // 4.2 Retrieve AI config and verify zero key leakage (masked)
  {
    const getRes = await request("/api/admin/ai-config", { token: adminToken });
    const isMasked = getRes.data?.apiKeyMasked === "sk-****6789";
    const noRawKey = !JSON.stringify(getRes.data).includes(secretKey);
    const modelsCorrect = getRes.data?.defaultModel === "flux-1-schnell" && getRes.data?.imageModels?.includes("flux-1-schnell");

    record("AI-Config", "4.2 GET /api/admin/ai-config returns masked key without exposing raw secret",
      getRes.status === 200 && isMasked && noRawKey && modelsCorrect,
      { status: 200, masked: "sk-****6789", noRawKey: true },
      { status: getRes.status, masked: getRes.data?.apiKeyMasked, noRawKey }
    );
  }

  // 4.3 Updating AI config with masked key string does NOT overwrite stored secret in DB
  {
    await request("/api/admin/ai-config", {
      method: "PUT",
      token: adminToken,
      body: {
        baseUrl: mockAi.getUrl(),
        apiKey: "sk-****6789", // Sending back masked key
        imageModels: ["flux-1-schnell"],
        defaultModel: "flux-1-schnell",
      },
    });

    // Check DB directly to ensure actual secret was preserved
    const row = db.query("SELECT value FROM system_settings WHERE key = 'ai.api_key'").get() as any;
    record("AI-Config", "4.3 Sending masked key in PUT does not overwrite actual stored secret key in DB",
      row?.value === secretKey, secretKey, row?.value
    );
  }

  // 4.4 AI Connectivity Probe with active Mock AI server
  {
    const probeRes = await request("/api/admin/ai-config/test", {
      method: "POST",
      token: adminToken,
      body: { baseUrl: mockAi.getUrl() },
    });
    record("AI-Config", "4.4 POST /api/admin/ai-config/test returns success: true and latencyMs",
      probeRes.status === 200 && probeRes.data?.success === true && typeof probeRes.data?.latencyMs === "number",
      true, probeRes.data?.success
    );
  }

  // 4.5 AI Connectivity Probe with invalid protocol & unreachable host
  {
    const badProtoRes = await request("/api/admin/ai-config/test", {
      method: "POST",
      token: adminToken,
      body: { baseUrl: "ftp://unsupported.server" },
    });
    record("AI-Config", "4.5 AI connectivity test rejects invalid protocol safely",
      badProtoRes.status === 200 && badProtoRes.data?.success === false,
      false, badProtoRes.data?.success
    );

    const unreachableRes = await request("/api/admin/ai-config/test", {
      method: "POST",
      token: adminToken,
      body: { baseUrl: "http://127.0.0.1:54399/does-not-exist" },
    });
    record("AI-Config", "4.6 AI connectivity test handles unreachable endpoint gracefully",
      unreachableRes.status === 200 && unreachableRes.data?.success === false,
      false, unreachableRes.data?.success
    );
  }

  // 4.6 System Stats Overview verification
  {
    const statsRes = await request("/api/admin/stats", { token: adminToken });
    const d = statsRes.data;
    const validStats =
      typeof d?.userCount === "number" &&
      typeof d?.activeUserCount === "number" &&
      typeof d?.projectCount === "number" &&
      typeof d?.assetCount === "number" &&
      typeof d?.storageBytes === "number" &&
      d.userCount >= d.activeUserCount &&
      d.activeUserCount >= 1;

    record("Admin-Stats", "4.7 GET /api/admin/stats returns valid aggregate metrics",
      statsRes.status === 200 && validStats,
      true, validStats
    );
  }

  // ============================================================================
  // 5. Boundary Conditions, Injection Probes & Adversarial Edge Cases
  // ============================================================================
  console.log("\n--- Section 5: Boundary Conditions, Injection Probes & Stress ---");

  // 5.1 SQL Injection Probes in /api/admin/users
  {
    const sqliSearch = await request("/api/admin/users?search=' OR 1=1 --", { token: adminToken });
    record("SQLi-Probes", "5.1 SQL injection probe in search param handled safely",
      sqliSearch.status === 200 && Array.isArray(sqliSearch.data?.users),
      200, sqliSearch.status
    );

    const sqliSortBy = await request("/api/admin/users?sortBy=; DROP TABLE users; --", { token: adminToken });
    record("SQLi-Probes", "5.2 SQL injection probe in sortBy param fallback to created_at safely",
      sqliSortBy.status === 200 && Array.isArray(sqliSortBy.data?.users),
      200, sqliSortBy.status
    );

    const sqliSortOrder = await request("/api/admin/users?sortOrder=ASC; SELECT 1; --", { token: adminToken });
    record("SQLi-Probes", "5.3 SQL injection probe in sortOrder param fallback safely",
      sqliSortOrder.status === 200 && Array.isArray(sqliSortOrder.data?.users),
      200, sqliSortOrder.status
    );
  }

  // 5.2 Invalid status in PATCH /api/admin/users/:id/status
  {
    const invalidStatuses = ["superuser", "banned", "123", "", null, undefined];
    let allInvalidRejected = true;
    for (const badStatus of invalidStatuses) {
      const res = await request(`/api/admin/users/${stdUserId}/status`, {
        method: "PATCH",
        token: adminToken,
        body: { status: badStatus },
      });
      if (res.status !== 400 || res.data?.error?.code !== "INVALID_STATUS") {
        allInvalidRejected = false;
        console.error(`Status '${badStatus}' got status ${res.status}, error:`, res.data);
      }
    }
    record("Status-Boundary", "5.4 Invalid status values rejected with 400 INVALID_STATUS",
      allInvalidRejected, true, allInvalidRejected
    );
  }

  // 5.3 Password reset validation (< 6 chars, empty, non-string)
  {
    const badPasswords = ["123", "abcde", "", null, 12345];
    let allBadPwRejected = true;
    for (const badPw of badPasswords) {
      const res = await request(`/api/admin/users/${stdUserId}/reset-password`, {
        method: "POST",
        token: adminToken,
        body: { newPassword: badPw },
      });
      if (res.status !== 400 || res.data?.error?.code !== "INVALID_PASSWORD") {
        allBadPwRejected = false;
        console.error(`Reset pw '${badPw}' got ${res.status}`);
      }
    }
    record("Password-Boundary", "5.5 Invalid reset password payloads rejected with 400 INVALID_PASSWORD",
      allBadPwRejected, true, allBadPwRejected
    );
  }

  // 5.4 High Concurrency User Creation Stress Test (20 parallel requests)
  {
    const parallelCount = 20;
    const createPromises = Array.from({ length: parallelCount }, (_, i) => {
      const u = `conc_${Date.now().toString().slice(-4)}_${i}_${Math.random().toString(36).substring(2, 6)}`;
      return request("/api/admin/users", {
        method: "POST",
        token: adminToken,
        body: { username: u, password: "ConcurrentPassword123!", role: "user" },
      });
    });

    const createResults = await Promise.all(createPromises);
    const successCount = createResults.filter((r) => r.status === 201).length;

    record("Concurrency-Stress", `5.6 Concurrent creation of ${parallelCount} users (${successCount}/${parallelCount} 201 Created)`,
      successCount === parallelCount, parallelCount, successCount
    );

    // Verify pagination with large user count
    const listRes = await request("/api/admin/users?page=1&limit=50", { token: adminToken });
    record("Concurrency-Stress", "5.7 Query users after concurrent burst returns accurate total and users array",
      listRes.status === 200 && listRes.data?.total >= parallelCount && listRes.data?.users?.length <= 50,
      true, listRes.data?.total >= parallelCount
    );

    // Clean up created concurrent users to keep database clean
    const userIdsToDelete = createResults
      .map((r) => r.data?.user?.id)
      .filter((id) => typeof id === "string");
    await Promise.all(userIdsToDelete.map((id) => request(`/api/admin/users/${id}`, { method: "DELETE", token: adminToken })));
  }

  // Clean up std test user
  if (stdUserId) {
    await request(`/api/admin/users/${stdUserId}`, { method: "DELETE", token: adminToken });
  }

  await mockAi.stop();

  // Summary
  console.log("\n================================================================================");
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`🏁 Milestone 2 Total Empirical Challenges: ${total}`);
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

runMilestone2StressTests().catch((err) => {
  console.error("Fatal error running M2 stress harness:", err);
  process.exit(1);
});
