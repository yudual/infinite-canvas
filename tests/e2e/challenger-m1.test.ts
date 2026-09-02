import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import { setupRouter } from "../../server/src/routes/setup.js";
import { authRouter } from "../../server/src/routes/auth.js";
import { adminRouter } from "../../server/src/routes/admin.js";
import { db, initSchema } from "../../server/src/db.js";
import { JWT_SECRET } from "../../server/src/config.js";

export interface AssertionResult {
  suite: string;
  name: string;
  passed: boolean;
  details: string;
  logs: string[];
}

export const testResults: AssertionResult[] = [];

function recordAssertion(suite: string, name: string, passed: boolean, details: string, logs: string[] = []) {
  testResults.push({ suite, name, passed, details, logs });
  const mark = passed ? "✅ PASS" : "❌ FAIL";
  console.log(`${mark} [${suite}] ${name}: ${details}`);
}

export async function createTestServer(port: number): Promise<http.Server> {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  app.use("/api/setup", setupRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/admin", adminRouter);

  // Global 404 handler
  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "API endpoint not found" },
      message: "API endpoint not found",
    });
  });

  // Global error handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || 500;
    const code = err.code || (status === 400 ? "BAD_REQUEST" : "INTERNAL_SERVER_ERROR");
    const message = err.message || "An unexpected error occurred";
    res.status(status).json({
      success: false,
      error: { code, message },
      message,
    });
  });

  return new Promise((resolve) => {
    const server = app.listen(port, "127.0.0.1", () => {
      resolve(server);
    });
  });
}

export function resetDatabase() {
  db.exec("DELETE FROM assets;");
  db.exec("DELETE FROM projects;");
  db.exec("DELETE FROM users;");
  db.exec("DELETE FROM system_settings;");
}

export async function runMilestone1Challenger() {
  const TEST_PORT = 3998;
  const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
  const server = await createTestServer(TEST_PORT);

  console.log(`================================================================`);
  console.log(`🔥 EMPIRICAL CHALLENGER VERIFICATION SUITE — MILESTONE 1`);
  console.log(`   Base URL: ${BASE_URL}`);
  console.log(`   Time:     ${new Date().toISOString()}`);
  console.log(`================================================================\n`);

  try {
    // ============================================================================
    // TEST SECTION 1: Concurrency / Race Condition on /api/setup
    // ============================================================================
    console.log(`>>> SECTION 1: Concurrency & Race Condition on /api/setup <<<`);
    resetDatabase();

    // 1.1 Pre-check setup status
    const initialStatusRes = await fetch(`${BASE_URL}/api/setup/status`);
    const initialStatus = await initialStatusRes.json();
    recordAssertion(
      "CONCURRENCY_SETUP",
      "Initial Setup Status",
      initialStatus.initialized === false && initialStatus.requiresSetup === true,
      `Requires setup: ${initialStatus.requiresSetup}, Initialized: ${initialStatus.initialized}`
    );

    // 1.2 10 Concurrent /api/setup requests to empty DB with different usernames
    const CONCURRENCY_COUNT = 10;
    const distinctPayloads = Array.from({ length: CONCURRENCY_COUNT }, (_, i) => ({
      username: `admin_candidate_${i}`,
      password: `AdminSecretPassword${i}!`,
      displayName: `Super Admin Candidate ${i}`,
    }));

    const raceStart = Date.now();
    const raceResponses = await Promise.all(
      distinctPayloads.map(async (payload, idx) => {
        const res = await fetch(`${BASE_URL}/api/setup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        return { index: idx, status: res.status, data };
      })
    );
    const raceElapsed = Date.now() - raceStart;

    const success201 = raceResponses.filter((r) => r.status === 201);
    const forbidden403 = raceResponses.filter(
      (r) => r.status === 403 && (r.data?.error?.code === "ALREADY_INITIALIZED" || r.data?.message?.includes("already initialized"))
    );
    const anomalousResponses = raceResponses.filter((r) => r.status !== 201 && r.status !== 403);

    const adminCountInDb = (db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get() as any).count;
    const isInitSettingSet = (db.prepare("SELECT value FROM system_settings WHERE key = 'system.initialized'").get() as any)?.value === "true";

    const test1Passed =
      success201.length === 1 &&
      forbidden403.length === 9 &&
      anomalousResponses.length === 0 &&
      adminCountInDb === 1 &&
      isInitSettingSet;

    recordAssertion(
      "CONCURRENCY_SETUP",
      "10 Concurrent Requests with Distinct Payloads",
      test1Passed,
      `Exactly 1 succeeded (201 Created), exactly 9 rejected (403 ALREADY_INITIALIZED). DB admin count: ${adminCountInDb}. Elapsed: ${raceElapsed}ms`,
      [
        `201 Responses: ${success201.length}`,
        `403 Responses: ${forbidden403.length}`,
        `Anomalies: ${JSON.stringify(anomalousResponses)}`,
        `Winner User: ${JSON.stringify(success201[0]?.data?.user?.username)}`,
      ]
    );

    // 1.3 10 Concurrent /api/setup requests with IDENTICAL payloads on empty DB (duplicate key / race check)
    resetDatabase();
    const identicalPayloads = Array.from({ length: CONCURRENCY_COUNT }, () => ({
      username: "masteradmin",
      password: "MasterAdminPassword123!",
      displayName: "Master Admin",
    }));

    const identRaceResponses = await Promise.all(
      identicalPayloads.map(async (payload, idx) => {
        const res = await fetch(`${BASE_URL}/api/setup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        return { index: idx, status: res.status, data };
      })
    );

    const ident201 = identRaceResponses.filter((r) => r.status === 201);
    const ident403 = identRaceResponses.filter(
      (r) => r.status === 403 && (r.data?.error?.code === "ALREADY_INITIALIZED" || r.data?.message?.includes("already initialized"))
    );
    const identAnomalies = identRaceResponses.filter((r) => r.status !== 201 && r.status !== 403);
    const identAdminCount = (db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get() as any).count;

    const test1_3Passed =
      ident201.length === 1 &&
      ident403.length === 9 &&
      identAnomalies.length === 0 &&
      identAdminCount === 1;

    recordAssertion(
      "CONCURRENCY_SETUP",
      "10 Concurrent Requests with Identical Payloads",
      test1_3Passed,
      `Exactly 1 created (201), 9 rejected (403 ALREADY_INITIALIZED), DB admin count: ${identAdminCount}`,
      [`Identical 201 count: ${ident201.length}`, `Identical 403 count: ${ident403.length}`]
    );

    // 1.4 Post-initialization status check
    const postStatusRes = await fetch(`${BASE_URL}/api/setup/status`);
    const postStatus = await postStatusRes.json();
    recordAssertion(
      "CONCURRENCY_SETUP",
      "Post-Setup Status Endpoint",
      postStatus.initialized === true && postStatus.requiresSetup === false,
      `Requires setup: ${postStatus.requiresSetup}, Initialized: ${postStatus.initialized}`
    );

    // ============================================================================
    // TEST SECTION 2: Real-time User Lockout
    // ============================================================================
    console.log(`\n>>> SECTION 2: Real-time User Lockout <<<`);
    resetDatabase();

    // 2.1 Setup admin
    const adminInitRes = await fetch(`${BASE_URL}/api/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "admin_tester",
        password: "AdminTesterPassword123!",
        displayName: "Admin Tester",
      }),
    });
    const adminInitData = await adminInitRes.json();
    const adminJwt = adminInitData.token;

    // 2.2 Create regular user via admin API
    const createTargetRes = await fetch(`${BASE_URL}/api/admin/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminJwt}`,
      },
      body: JSON.stringify({
        username: "target_member",
        password: "TargetMemberPassword123!",
        displayName: "Target Member",
        role: "user",
      }),
    });
    const createTargetData = await createTargetRes.json();
    const targetUserId = createTargetData.user.id;

    // 2.3 User logs in and acquires JWT
    const targetLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "target_member",
        password: "TargetMemberPassword123!",
      }),
    });
    const targetLoginData = await targetLoginRes.json();
    const targetUserJwt = targetLoginData.token;

    // 2.4 Verify user profile succeeds initially
    const meBeforeLockoutRes = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${targetUserJwt}` },
    });
    const meBeforeLockoutData = await meBeforeLockoutRes.json();
    recordAssertion(
      "REALTIME_LOCKOUT",
      "Pre-Lockout: /api/auth/me (Active User)",
      meBeforeLockoutRes.status === 200 && meBeforeLockoutData.user?.status === "active",
      `HTTP 200 OK, username: ${meBeforeLockoutData.user?.username}, status: ${meBeforeLockoutData.user?.status}`
    );

    // 2.5 Lock out user directly in SQLite DB (status = 'disabled')
    db.prepare("UPDATE users SET status = 'disabled', updated_at = ? WHERE id = ?").run(
      new Date().toISOString(),
      targetUserId
    );

    // 2.6 Verify immediate subsequent request to /api/auth/me returns 403 ACCOUNT_DISABLED
    const meAfterDbLockoutRes = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${targetUserJwt}` },
    });
    const meAfterDbLockoutData = await meAfterDbLockoutRes.json();
    const lockoutPass =
      meAfterDbLockoutRes.status === 403 &&
      meAfterDbLockoutData.error?.code === "ACCOUNT_DISABLED";

    recordAssertion(
      "REALTIME_LOCKOUT",
      "Immediate Lockout Check via DB Update",
      lockoutPass,
      `HTTP ${meAfterDbLockoutRes.status}, error code: ${meAfterDbLockoutData.error?.code}`,
      [`Response body: ${JSON.stringify(meAfterDbLockoutData)}`]
    );

    // 2.7 Verify login attempt while disabled is rejected with 403 ACCOUNT_DISABLED
    const loginDisabledRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "target_member",
        password: "TargetMemberPassword123!",
      }),
    });
    const loginDisabledData = await loginDisabledRes.json();
    recordAssertion(
      "REALTIME_LOCKOUT",
      "Login Rejection While Disabled",
      loginDisabledRes.status === 403 && loginDisabledData.error?.code === "ACCOUNT_DISABLED",
      `HTTP ${loginDisabledRes.status}, error code: ${loginDisabledData.error?.code}`
    );

    // 2.8 Re-enable user via Admin API PATCH /api/admin/users/:id/status
    const patchActiveRes = await fetch(`${BASE_URL}/api/admin/users/${targetUserId}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminJwt}`,
      },
      body: JSON.stringify({ status: "active" }),
    });
    const patchActiveData = await patchActiveRes.json();
    recordAssertion(
      "REALTIME_LOCKOUT",
      "Admin Re-enables User Account",
      patchActiveRes.status === 200 && patchActiveData.user?.status === "active",
      `HTTP 200 OK, user status updated to: ${patchActiveData.user?.status}`
    );

    // 2.9 Verify immediate subsequent request with original JWT succeeds again
    const meRestoredRes = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${targetUserJwt}` },
    });
    const meRestoredData = await meRestoredRes.json();
    recordAssertion(
      "REALTIME_LOCKOUT",
      "Instant Session Restoration on Re-enable",
      meRestoredRes.status === 200 && meRestoredData.user?.status === "active",
      `HTTP 200 OK, status: ${meRestoredData.user?.status}`
    );

    // 2.10 Admin disables user via Admin API PATCH
    const patchDisableRes = await fetch(`${BASE_URL}/api/admin/users/${targetUserId}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminJwt}`,
      },
      body: JSON.stringify({ status: "disabled" }),
    });
    const patchDisableData = await patchDisableRes.json();
    const meAfterApiDisableRes = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${targetUserJwt}` },
    });
    const meAfterApiDisableData = await meAfterApiDisableRes.json();
    recordAssertion(
      "REALTIME_LOCKOUT",
      "Immediate Lockout Check via Admin API PATCH",
      meAfterApiDisableRes.status === 403 && meAfterApiDisableData.error?.code === "ACCOUNT_DISABLED",
      `HTTP ${meAfterApiDisableRes.status}, error code: ${meAfterApiDisableData.error?.code}`
    );

    // 2.11 Deleted user token invalidation
    db.prepare("DELETE FROM users WHERE id = ?").run(targetUserId);
    const meDeletedRes = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${targetUserJwt}` },
    });
    const meDeletedData = await meDeletedRes.json();
    recordAssertion(
      "REALTIME_LOCKOUT",
      "Deleted User Token Immediate 401 USER_NOT_FOUND",
      meDeletedRes.status === 401 && meDeletedData.error?.code === "USER_NOT_FOUND",
      `HTTP ${meDeletedRes.status}, error code: ${meDeletedData.error?.code}`
    );

    // ============================================================================
    // TEST SECTION 3: Injection & Malformed Payloads
    // ============================================================================
    console.log(`\n>>> SECTION 3: Injection & Malformed Payloads <<<`);

    // 3.1 SQL Injection vectors in Login, Setup, and Admin Search
    const sqlInjections = [
      { payload: "' OR '1'='1", desc: "Tautology single quote" },
      { payload: "admin' --", desc: "SQL comment termination" },
      { payload: "admin' /*", desc: "Multiline comment block" },
      { payload: "' UNION SELECT '1', 'injected', 'hash', 'Injected', 'admin', 'active', 'now', 'now' --", desc: "UNION SELECT extraction" },
      { payload: "\"; DROP TABLE users; --", desc: "Stacked queries drop table" },
      { payload: "admin'; SELECT sqlite_version(); --", desc: "Stacked queries version query" },
      { payload: "' OR 1=1 LIMIT 1 --", desc: "Limit clause injection" },
      { payload: "admin' OR ''='", desc: "String concat injection" },
      { payload: "x' UNION SELECT 1,2,3,4,5,6,7,8--", desc: "Column count probing" },
      { payload: "admin' AND (SELECT 1 FROM (SELECT COUNT(*),CONCAT((SELECT username FROM users LIMIT 1),FLOOR(RANDOM()))x FROM users GROUP BY x)a)--", desc: "Subquery injection" },
    ];

    for (const sqli of sqlInjections) {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: sqli.payload,
          password: "MaliciousPassword123!",
        }),
      });
      const data = await res.json().catch(() => ({}));
      const passed = res.status === 401 && data.error?.code === "INVALID_CREDENTIALS";
      recordAssertion(
        "SQL_INJECTION",
        `Login SQLi: ${sqli.desc}`,
        passed,
        `HTTP ${res.status}, error code: ${data.error?.code}`,
        [`Payload: ${sqli.payload}`, `Response: ${JSON.stringify(data)}`]
      );
    }

    // 3.2 SQL Injection in /api/setup username validation (should be rejected by format validator 400)
    resetDatabase();
    for (const sqli of sqlInjections) {
      const res = await fetch(`${BASE_URL}/api/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: sqli.payload,
          password: "SetupPassword123!",
        }),
      });
      const data = await res.json().catch(() => ({}));
      const passed = res.status === 400 && (data.error?.code === "INVALID_USERNAME_FORMAT" || data.error?.code === "INVALID_USERNAME");
      recordAssertion(
        "SQL_INJECTION",
        `Setup SQLi Rejection: ${sqli.desc}`,
        passed,
        `HTTP ${res.status}, error code: ${data.error?.code}`,
        [`Payload: ${sqli.payload}`, `Response: ${JSON.stringify(data)}`]
      );
    }

    // Re-initialize for subsequent tests
    await fetch(`${BASE_URL}/api/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "AdminPassword123!" }),
    });

    // 3.3 Malformed JSON Payloads
    const malformedJsonStrings = [
      { raw: `{ "username": "admin", "password": `, desc: "Truncated JSON" },
      { raw: `{ "username": "admin", broken_json `, desc: "Syntax error tokens" },
      { raw: `{"unclosed": "brace"`, desc: "Unclosed object" },
      { raw: `<<<NOT_JSON_BODY>>>`, desc: "Arbitrary non-JSON string" },
      { raw: `[1, 2, 3, {"trailing": "comma",}]`, desc: "Trailing comma syntax" },
      { raw: `{"username": "\u0000admin"}`, desc: "Null byte in JSON" },
    ];

    for (const badJson of malformedJsonStrings) {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: badJson.raw,
      });
      // Express body parser returns 400 for JSON syntax errors
      const passed = res.status === 400;
      recordAssertion(
        "MALFORMED_JSON",
        `Malformed JSON: ${badJson.desc}`,
        passed,
        `HTTP Status: ${res.status}`,
        [`Raw payload: ${badJson.raw}`]
      );
    }

    // 3.4 Missing fields, Empty Body, Type Mismatches
    const missingFieldCases = [
      { name: "Empty body {}", body: {}, expectedStatus: 400, expectedCode: "INVALID_REQUEST" },
      { name: "Missing password field", body: { username: "admin" }, expectedStatus: 400, expectedCode: "INVALID_REQUEST" },
      { name: "Missing username field", body: { password: "AdminPassword123!" }, expectedStatus: 400, expectedCode: "INVALID_REQUEST" },
      { name: "Whitespace only username", body: { username: "    ", password: "AdminPassword123!" }, expectedStatus: 400, expectedCode: "INVALID_REQUEST" },
      { name: "Whitespace only password", body: { username: "admin", password: "   " }, expectedStatus: 401, expectedCode: "INVALID_CREDENTIALS" },
      { name: "Null username", body: { username: null, password: "AdminPassword123!" }, expectedStatus: 401, expectedCode: "INVALID_CREDENTIALS" },
      { name: "Numeric username & password", body: { username: 12345, password: 67890 }, expectedStatus: 401, expectedCode: "INVALID_CREDENTIALS" },
      { name: "Array instead of object", body: [1, 2, 3], expectedStatus: 400, expectedCode: "INVALID_REQUEST" },
      { name: "Deeply nested object as username", body: { username: { nested: { user: "admin" } }, password: "Password123!" }, expectedStatus: 401, expectedCode: "INVALID_CREDENTIALS" },
    ];

    for (const tc of missingFieldCases) {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tc.body),
      });
      const data = await res.json().catch(() => ({}));
      const passed = res.status === tc.expectedStatus && data.error?.code === tc.expectedCode;
      recordAssertion(
        "FIELD_VALIDATION",
        `Payload Boundary: ${tc.name}`,
        passed,
        `Expected ${tc.expectedStatus} ${tc.expectedCode}, Got ${res.status} ${data.error?.code}`,
        [`Body: ${JSON.stringify(tc.body)}`, `Response: ${JSON.stringify(data)}`]
      );
    }

    // 3.5 JWT Authentication and Authorization Hardening
    const jwtAttackCases = [
      { name: "Tampered Signature", header: `Bearer ${jwt.sign({ userId: "admin" }, "FORGED_SECRET_KEY")}`, expectedStatus: 401, expectedCode: "INVALID_TOKEN" },
      { name: "Expired JWT Token", header: `Bearer ${jwt.sign({ userId: "admin" }, JWT_SECRET, { expiresIn: -60 })}`, expectedStatus: 401, expectedCode: "TOKEN_EXPIRED" },
      { name: "Malformed Token Structure", header: "Bearer invalid.jwt.structure", expectedStatus: 401, expectedCode: "INVALID_TOKEN" },
      { name: "Non-existent User ID", header: `Bearer ${jwt.sign({ userId: "non-existent-uuid-999" }, JWT_SECRET, { expiresIn: "1h" })}`, expectedStatus: 401, expectedCode: "USER_NOT_FOUND" },
      { name: "Missing Token after Bearer Prefix", header: "Bearer ", expectedStatus: 401, expectedCode: "UNAUTHORIZED" },
      { name: "Basic Auth Header instead of Bearer", header: "Basic YWRtaW46cGFzc3dvcmQ=", expectedStatus: 401, expectedCode: "UNAUTHORIZED" },
      { name: "Missing Authorization Header", header: "", expectedStatus: 401, expectedCode: "UNAUTHORIZED" },
    ];

    for (const jac of jwtAttackCases) {
      const headers: Record<string, string> = {};
      if (jac.header) {
        headers["Authorization"] = jac.header;
      }
      const res = await fetch(`${BASE_URL}/api/auth/me`, { headers });
      const data = await res.json().catch(() => ({}));
      const passed = res.status === jac.expectedStatus && data.error?.code === jac.expectedCode;
      recordAssertion(
        "JWT_HARDENING",
        `JWT Verification: ${jac.name}`,
        passed,
        `Expected ${jac.expectedStatus} ${jac.expectedCode}, Got ${res.status} ${data.error?.code}`,
        [`Header: ${jac.header.slice(0, 30)}...`, `Response: ${JSON.stringify(data)}`]
      );
    }

    // 3.6 Case-Insensitivity Authentication Invariants
    const caseSensitivityTests = [
      { usernameLogin: "ADMIN", desc: "Uppercase username" },
      { usernameLogin: "Admin", desc: "Capitalized username" },
      { usernameLogin: "aDmIn", desc: "Mixed-case username" },
    ];

    for (const cst of caseSensitivityTests) {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: cst.usernameLogin,
          password: "AdminPassword123!",
        }),
      });
      const data = await res.json().catch(() => ({}));
      const passed = res.status === 200 && data.user?.username?.toLowerCase() === "admin";
      recordAssertion(
        "CASE_INSENSITIVITY",
        `Login Case-Insensitivity: ${cst.desc}`,
        passed,
        `HTTP ${res.status}, Logged in as: ${data.user?.username}`,
        [`Attempted: ${cst.usernameLogin}`, `User returned: ${JSON.stringify(data.user)}`]
      );
    }

  } finally {
    server.close();
  }

  // Summary
  const total = testResults.length;
  const passed = testResults.filter((r) => r.passed).length;
  const failed = testResults.filter((r) => !r.passed).length;
  const verdict = failed === 0 ? "APPROVE" : "REQUEST_CHANGES";

  console.log(`\n================================================================`);
  console.log(`🏁 CHALLENGER VERIFICATION SUMMARY`);
  console.log(`   Total Assertions: ${total}`);
  console.log(`   Passed:           ${passed}`);
  console.log(`   Failed:           ${failed}`);
  console.log(`   VERDICT:          ${verdict}`);
  console.log(`================================================================\n`);

  return { total, passed, failed, verdict, testResults };
}

runMilestone1Challenger().catch((err) => {
  console.error("FATAL ERROR in Challenger Suite:", err);
  process.exit(1);
});
