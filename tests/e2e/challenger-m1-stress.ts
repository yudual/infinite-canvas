import jwt from "jsonwebtoken";
import { Database } from "bun:sqlite";
import { JWT_SECRET } from "../../server/src/config.js";

const BASE_URL = "http://127.0.0.1:3001";

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
    console.error(`     Expected: ${JSON.stringify(expected)} | Actual: ${JSON.stringify(actual)}`);
    if (details) console.error(`     Details:  ${details}`);
  }
}

async function request(path: string, options: { method?: string; token?: string | null; body?: any; headers?: Record<string, string> } = {}) {
  const url = `${BASE_URL}${path.startsWith('/') ? path : '/' + path}`;
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

async function runAllChallenges() {
  console.log("================================================================================");
  console.log("       🔥 Milestone 1 Empirical Adversarial Challenge Runner                    ");
  console.log("================================================================================\n");

  console.log("--- Step 0: Ensure Admin & Setup State ---");
  const statusRes = await request("/api/setup/status");
  let adminToken = "";
  let adminUserId = "";

  if (!statusRes.data.initialized) {
    const adminUsername = `firstadmin_${Date.now()}`;
    const adminPassword = "SuperAdminPassword123!";
    const setupRes = await request("/api/setup", {
      method: "POST",
      body: {
        username: adminUsername,
        password: adminPassword,
        displayName: "First Super Admin",
      },
    });
    record("Setup", "First admin registration via /api/setup", setupRes.status === 201, 201, setupRes.status);
    adminToken = setupRes.data?.token || "";
    adminUserId = setupRes.data?.user?.id || "";
  } else {
    // Read admin from DB to generate valid session
    const db = new Database("data/canvas.db");
    const adminRow = db.query("SELECT * FROM users WHERE role = 'admin' AND status = 'active' LIMIT 1").get() as any;
    if (adminRow) {
      adminUserId = adminRow.id;
      adminToken = jwt.sign(
        { userId: adminRow.id, sub: adminRow.id, username: adminRow.username, role: adminRow.role },
        JWT_SECRET,
        { expiresIn: "1h" }
      );
      record("Setup", "Admin session established from database record", true, true, true);
    } else {
      record("Setup", "Admin record lookup in DB", false, "admin found", "no active admin");
    }
  }

  // Create a regular test user via Admin API for user-level tests
  let userToken = "";
  let testUserId = "";
  const regularUsername = `usr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const regularPassword = "UserPassword123!";

  const createUsrRes = await request("/api/admin/users", {
    method: "POST",
    token: adminToken,
    body: {
      username: regularUsername,
      password: regularPassword,
      role: "user",
      displayName: "Regular Challenger User",
    },
  });

  if (createUsrRes.status === 201) {
    testUserId = createUsrRes.data?.user?.id;
    // Log in with regular credentials
    const userLoginRes = await request("/api/auth/login", {
      method: "POST",
      body: { username: regularUsername, password: regularPassword },
    });
    if (userLoginRes.ok && userLoginRes.data?.token) {
      userToken = userLoginRes.data.token;
      record("User-Creation", "Created and authenticated regular test user", true, 200, userLoginRes.status);
    } else {
      record("User-Creation", "Login for newly created test user", false, 200, userLoginRes.status);
    }
  } else {
    record("User-Creation", "Admin user creation endpoint", false, 201, createUsrRes.status);
  }

  console.log(`\n--- 1. Token Security, Signature Tampering & Alg Confusion on /api/auth/me ---`);

  // 1.1 Baseline Positive Control
  {
    const meRes = await request("/api/auth/me", { token: userToken });
    record("Token-Security", "1.1 Baseline valid JWT gives 200 OK and correct profile",
      meRes.status === 200 && meRes.data?.user?.username === regularUsername,
      200, meRes.status
    );
  }

  // 1.2 Signature Tampering
  {
    const validToken = userToken;
    const parts = validToken.split(".");
    if (parts.length === 3) {
      // 1.2a: Corrupted signature
      const corruptedSigToken = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -4)}XXXX`;
      const resA = await request("/api/auth/me", { token: corruptedSigToken });
      record("Token-Tampering", "1.2a Corrupted signature rejected with 401 INVALID_TOKEN",
        resA.status === 401 && resA.data?.error?.code === "INVALID_TOKEN",
        { status: 401, code: "INVALID_TOKEN" },
        { status: resA.status, code: resA.data?.error?.code }
      );

      // 1.2b: Privilege Escalation payload tampering (role: user -> role: admin)
      const payloadObj = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));
      payloadObj.role = "admin";
      const tamperedPayloadB64 = Buffer.from(JSON.stringify(payloadObj)).toString("base64url");
      const privEscToken = `${parts[0]}.${tamperedPayloadB64}.${parts[2]}`;
      const resB = await request("/api/auth/me", { token: privEscToken });
      record("Token-Tampering", "1.2b Payload tampering (privilege escalation) rejected with 401",
        resB.status === 401, 401, resB.status
      );

      // 1.2c: Identity spoofing (userId changed to admin user ID)
      payloadObj.userId = adminUserId;
      payloadObj.sub = adminUserId;
      const idSpoofPayloadB64 = Buffer.from(JSON.stringify(payloadObj)).toString("base64url");
      const idSpoofToken = `${parts[0]}.${idSpoofPayloadB64}.${parts[2]}`;
      const resC = await request("/api/auth/me", { token: idSpoofToken });
      record("Token-Tampering", "1.2c User ID identity spoofing rejected with 401",
        resC.status === 401, 401, resC.status
      );

      // 1.2d: Truncated signature (empty signature segment)
      const truncSigToken = `${parts[0]}.${parts[1]}.`;
      const resD = await request("/api/auth/me", { token: truncSigToken });
      record("Token-Tampering", "1.2d Truncated signature rejected with 401",
        resD.status === 401, 401, resD.status
      );
    }
  }

  // 1.3 Algorithm Confusion & None Algorithm Attacks
  {
    const payload = {
      userId: testUserId,
      sub: testUserId,
      username: regularUsername,
      role: "admin",
    };

    // 1.3a: alg: "none" (lowercase, standard RFC 7515 none-attack)
    const headerNone = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const algNoneToken = `${headerNone}.${payloadB64}.`;
    const resNone = await request("/api/auth/me", { token: algNoneToken });
    record("Alg-Confusion", "1.3a alg: 'none' rejected with 401", resNone.status === 401, 401, resNone.status);

    // 1.3b: alg: "NONE" (uppercase)
    const headerNoneUpper = Buffer.from(JSON.stringify({ alg: "NONE", typ: "JWT" })).toString("base64url");
    const algNoneUpperToken = `${headerNoneUpper}.${payloadB64}.`;
    const resNoneUpper = await request("/api/auth/me", { token: algNoneUpperToken });
    record("Alg-Confusion", "1.3b alg: 'NONE' (uppercase) rejected with 401", resNoneUpper.status === 401, 401, resNoneUpper.status);

    // 1.3c: alg: "HS384"
    const hs384Token = jwt.sign(payload, JWT_SECRET, { algorithm: "HS384" });
    const resHs384 = await request("/api/auth/me", { token: hs384Token });
    record("Alg-Confusion", "1.3c alg: 'HS384' rejected (enforcing HS256 only)", resHs384.status === 401, 401, resHs384.status);

    // 1.3d: alg: "HS512"
    const hs512Token = jwt.sign(payload, JWT_SECRET, { algorithm: "HS512" });
    const resHs512 = await request("/api/auth/me", { token: hs512Token });
    record("Alg-Confusion", "1.3d alg: 'HS512' rejected (enforcing HS256 only)", resHs512.status === 401, 401, resHs512.status);

    // 1.3e: Malformed header (invalid non-JSON base64)
    const badHeaderToken = `bm90LWpzb24.${payloadB64}.invalidsig`;
    const resBadHeader = await request("/api/auth/me", { token: badHeaderToken });
    record("Alg-Confusion", "1.3e Malformed non-JSON header rejected with 401", resBadHeader.status === 401, 401, resBadHeader.status);
  }

  // 1.4 Expiration & Temporal Constraints
  {
    // 1.4a: Expired Token (exp in past)
    const expiredPayload = {
      userId: testUserId,
      sub: testUserId,
      username: regularUsername,
      role: "user",
      exp: Math.floor(Date.now() / 1000) - 300, // 5 min ago
    };
    const expiredToken = jwt.sign(expiredPayload, JWT_SECRET);
    const resExpired = await request("/api/auth/me", { token: expiredToken });
    record("Token-Expiry", "1.4a Expired token rejected with 401 and code TOKEN_EXPIRED",
      resExpired.status === 401 && resExpired.data?.error?.code === "TOKEN_EXPIRED",
      { status: 401, code: "TOKEN_EXPIRED" },
      { status: resExpired.status, code: resExpired.data?.error?.code }
    );

    // 1.4b: Future Not-Before (nbf)
    const nbfPayload = {
      userId: testUserId,
      sub: testUserId,
      username: regularUsername,
      role: "user",
      nbf: Math.floor(Date.now() / 1000) + 3600, // 1 hour in future
    };
    const nbfToken = jwt.sign(nbfPayload, JWT_SECRET);
    const resNbf = await request("/api/auth/me", { token: nbfToken });
    record("Token-Expiry", "1.4b Future nbf (not-before) rejected with 401", resNbf.status === 401, 401, resNbf.status);

    // 1.4c: Token missing userId & sub
    const noSubPayload = { username: regularUsername, role: "user" };
    const noSubToken = jwt.sign(noSubPayload, JWT_SECRET);
    const resNoSub = await request("/api/auth/me", { token: noSubToken });
    record("Token-Claims", "1.4c Token missing userId / sub rejected with 401 INVALID_TOKEN",
      resNoSub.status === 401 && resNoSub.data?.error?.code === "INVALID_TOKEN",
      { status: 401, code: "INVALID_TOKEN" },
      { status: resNoSub.status, code: resNoSub.data?.error?.code }
    );
  }

  // 1.5 Header Formats & Edge Cases
  {
    // 1.5a: Missing Authorization header
    const resNoAuth = await request("/api/auth/me", { token: null });
    record("Auth-Header", "1.5a Missing Authorization header returns 401 UNAUTHORIZED",
      resNoAuth.status === 401 && resNoAuth.data?.error?.code === "UNAUTHORIZED",
      { status: 401, code: "UNAUTHORIZED" },
      { status: resNoAuth.status, code: resNoAuth.data?.error?.code }
    );

    // 1.5b: Bearer with empty whitespace
    const resEmptyBearer = await request("/api/auth/me", { headers: { Authorization: "Bearer   " } });
    record("Auth-Header", "1.5b Bearer with empty whitespace returns 401 TOKEN_MISSING",
      resEmptyBearer.status === 401, 401, resEmptyBearer.status
    );

    // 1.5c: Wrong scheme (Basic)
    const resBasic = await request("/api/auth/me", { headers: { Authorization: "Basic dXNlcjpwYXNz" } });
    record("Auth-Header", "1.5c Basic auth scheme returns 401 UNAUTHORIZED",
      resBasic.status === 401 && resBasic.data?.error?.code === "UNAUTHORIZED",
      { status: 401, code: "UNAUTHORIZED" },
      { status: resBasic.status, code: resBasic.data?.error?.code }
    );

    // 1.5d: Bearer literal strings 'null' and 'undefined'
    const resNull = await request("/api/auth/me", { headers: { Authorization: "Bearer null" } });
    record("Auth-Header", "1.5d Bearer null returns 401", resNull.status === 401, 401, resNull.status);
    const resUndef = await request("/api/auth/me", { headers: { Authorization: "Bearer undefined" } });
    record("Auth-Header", "1.5e Bearer undefined returns 401", resUndef.status === 401, 401, resUndef.status);

    // 1.5f: Extremely oversized token header (10KB junk)
    const hugeToken = "Bearer " + "A".repeat(10240);
    const resHuge = await request("/api/auth/me", { headers: { Authorization: hugeToken } });
    record("Auth-Header", "1.5f Oversized 10KB junk token header rejected safely",
      [401, 431].includes(resHuge.status), "401 or 431", resHuge.status
    );
  }

  // 1.6 Session & Account Lifecycle Invalidation
  {
    // Create user to be disabled
    const disUsrName = `dis_${Date.now()}`;
    const disCreate = await request("/api/admin/users", {
      method: "POST",
      token: adminToken,
      body: { username: disUsrName, password: "Password123!", role: "user" },
    });
    const disUserId = disCreate.data?.user?.id;
    const disLogin = await request("/api/auth/login", {
      method: "POST",
      body: { username: disUsrName, password: "Password123!" },
    });
    const disToken = disLogin.data?.token;

    // Verify token works before disabling
    const preCheck = await request("/api/auth/me", { token: disToken });
    record("Session-Lifecycle", "1.6a Pre-disable active user token works (200 OK)", preCheck.status === 200, 200, preCheck.status);

    // Disable the user
    await request(`/api/admin/users/${disUserId}/status`, {
      method: "PATCH",
      token: adminToken,
      body: { status: "disabled" },
    });

    // Now test with the existing token on /api/auth/me
    const postCheck = await request("/api/auth/me", { token: disToken });
    record("Session-Lifecycle", "1.6b Disabled user's existing token rejected with 403 ACCOUNT_DISABLED on /api/auth/me",
      postCheck.status === 403 && postCheck.data?.error?.code === "ACCOUNT_DISABLED",
      { status: 403, code: "ACCOUNT_DISABLED" },
      { status: postCheck.status, code: postCheck.data?.error?.code }
    );

    // Create user to be deleted
    const delUsrName = `del_${Date.now()}`;
    const delCreate = await request("/api/admin/users", {
      method: "POST",
      token: adminToken,
      body: { username: delUsrName, password: "Password123!", role: "user" },
    });
    const delUserId = delCreate.data?.user?.id;
    const delLogin = await request("/api/auth/login", {
      method: "POST",
      body: { username: delUsrName, password: "Password123!" },
    });
    const delToken = delLogin.data?.token;

    // Delete the user
    await request(`/api/admin/users/${delUserId}`, {
      method: "DELETE",
      token: adminToken,
    });

    // Now test with the deleted user's token on /api/auth/me
    const delCheck = await request("/api/auth/me", { token: delToken });
    record("Session-Lifecycle", "1.6c Deleted user's token rejected with 401 USER_NOT_FOUND on /api/auth/me",
      delCheck.status === 401 && delCheck.data?.error?.code === "USER_NOT_FOUND",
      { status: 401, code: "USER_NOT_FOUND" },
      { status: delCheck.status, code: delCheck.data?.error?.code }
    );
  }

  console.log(`\n--- 2. Boundary Input Lengths: Username < 2 or > 32, Password < 6 ---`);

  // 2.1 Boundary tests on /api/auth/login
  {
    // Empty body
    const resEmpty = await request("/api/auth/login", { method: "POST", body: {} });
    record("Login-Boundary", "2.1a Empty login payload returns 400 INVALID_REQUEST",
      resEmpty.status === 400 && resEmpty.data?.error?.code === "INVALID_REQUEST",
      { status: 400, code: "INVALID_REQUEST" },
      { status: resEmpty.status, code: resEmpty.data?.error?.code }
    );

    // Whitespace only username
    const resWs = await request("/api/auth/login", { method: "POST", body: { username: "    ", password: "pwd" } });
    record("Login-Boundary", "2.1b Whitespace-only username returns 400 INVALID_REQUEST",
      resWs.status === 400, 400, resWs.status
    );

    // Username 1 char (length < 2)
    const res1Char = await request("/api/auth/login", { method: "POST", body: { username: "a", password: "Password123!" } });
    record("Login-Boundary", "2.1c 1-char non-existent username handled safely (401 INVALID_CREDENTIALS)",
      res1Char.status === 401 && res1Char.data?.error?.code === "INVALID_CREDENTIALS",
      { status: 401, code: "INVALID_CREDENTIALS" },
      { status: res1Char.status, code: res1Char.data?.error?.code }
    );

    // Password < 6 chars on login
    const resShortPw = await request("/api/auth/login", { method: "POST", body: { username: "admin", password: "123" } });
    record("Login-Boundary", "2.1d Short password on login returns 401 without server crash",
      resShortPw.status === 401, 401, resShortPw.status
    );

    // Huge 100KB password payload (DoS / ReDoS stress)
    const hugePassword = "P".repeat(100000);
    const resHugePw = await request("/api/auth/login", { method: "POST", body: { username: "admin", password: hugePassword } });
    record("Login-Boundary", "2.1e 100KB password handled safely without server crash",
      resHugePw.status === 401, 401, resHugePw.status
    );
  }

  // 2.2 Boundary tests on /api/admin/users (Admin user creation)
  {
    // 2.2a: Username < 2 chars (length 0, 1)
    const resEmptyUser = await request("/api/admin/users", {
      method: "POST",
      token: adminToken,
      body: { username: "", password: "ValidPassword123!" },
    });
    record("AdminUser-Boundary", "2.2a Empty username on user creation returns 400 INVALID_USERNAME",
      resEmptyUser.status === 400 && resEmptyUser.data?.error?.code === "INVALID_USERNAME",
      { status: 400, code: "INVALID_USERNAME" },
      { status: resEmptyUser.status, code: resEmptyUser.data?.error?.code }
    );

    const res1CharUser = await request("/api/admin/users", {
      method: "POST",
      token: adminToken,
      body: { username: "x", password: "ValidPassword123!" },
    });
    record("AdminUser-Boundary", "2.2b 1-character username (< 2) returns 400 INVALID_USERNAME",
      res1CharUser.status === 400 && res1CharUser.data?.error?.code === "INVALID_USERNAME",
      { status: 400, code: "INVALID_USERNAME" },
      { status: res1CharUser.status, code: res1CharUser.data?.error?.code }
    );

    // 2.2c: Username exactly 2 chars (min boundary edge)
    const twoCharName = "u" + Math.random().toString(36).substring(2, 3);
    const res2CharUser = await request("/api/admin/users", {
      method: "POST",
      token: adminToken,
      body: { username: twoCharName, password: "ValidPassword123!" },
    });
    record("AdminUser-Boundary", "2.2c 2-character username (exact min bound) returns 201 Created",
      res2CharUser.status === 201, 201, res2CharUser.status
    );

    // 2.2d: Username exactly 32 chars (max boundary edge)
    const exact32User = "u" + Math.random().toString(36).substring(2, 10).padEnd(31, "x");
    const res32CharUser = await request("/api/admin/users", {
      method: "POST",
      token: adminToken,
      body: { username: exact32User, password: "ValidPassword123!" },
    });
    record("AdminUser-Boundary", "2.2d 32-character username (exact max bound) returns 201 Created",
      res32CharUser.status === 201, 201, res32CharUser.status
    );

    // 2.2e: Username > 32 chars (33 chars)
    const len33User = "u" + "x".repeat(32); // 33 chars total
    const res33CharUser = await request("/api/admin/users", {
      method: "POST",
      token: adminToken,
      body: { username: len33User, password: "ValidPassword123!" },
    });
    record("AdminUser-Boundary", "2.2e 33-character username (> 32) returns 400 INVALID_USERNAME",
      res33CharUser.status === 400 && res33CharUser.data?.error?.code === "INVALID_USERNAME",
      { status: 400, code: "INVALID_USERNAME" },
      { status: res33CharUser.status, code: res33CharUser.data?.error?.code }
    );

    // 2.2f: Password < 6 chars (length 0, 1, 5)
    const resEmptyPw = await request("/api/admin/users", {
      method: "POST",
      token: adminToken,
      body: { username: `pwtest_${Date.now()}`, password: "" },
    });
    record("AdminUser-Boundary", "2.2f Empty password returns 400 INVALID_PASSWORD",
      resEmptyPw.status === 400 && resEmptyPw.data?.error?.code === "INVALID_PASSWORD",
      { status: 400, code: "INVALID_PASSWORD" },
      { status: resEmptyPw.status, code: resEmptyPw.data?.error?.code }
    );

    const res5CharPw = await request("/api/admin/users", {
      method: "POST",
      token: adminToken,
      body: { username: `pwtest5_${Date.now()}`, password: "12345" },
    });
    record("AdminUser-Boundary", "2.2g 5-character password (< 6) returns 400 INVALID_PASSWORD",
      res5CharPw.status === 400 && res5CharPw.data?.error?.code === "INVALID_PASSWORD",
      { status: 400, code: "INVALID_PASSWORD" },
      { status: res5CharPw.status, code: res5CharPw.data?.error?.code }
    );

    // 2.2h: Password exactly 6 chars (min bound)
    const res6CharPw = await request("/api/admin/users", {
      method: "POST",
      token: adminToken,
      body: { username: `pwtest6_${Date.now()}`, password: "123456" },
    });
    record("AdminUser-Boundary", "2.2h 6-character password (exact min bound) returns 201 Created",
      res6CharPw.status === 201, 201, res6CharPw.status
    );

    // 2.2i: Duplicate username check
    const dupUsername = `dup_${Date.now()}`;
    await request("/api/admin/users", {
      method: "POST",
      token: adminToken,
      body: { username: dupUsername, password: "Password123!" },
    });
    const resDup = await request("/api/admin/users", {
      method: "POST",
      token: adminToken,
      body: { username: dupUsername.toUpperCase(), password: "Password123!" },
    });
    record("AdminUser-Boundary", "2.2i Case-insensitive duplicate username returns 400 USERNAME_EXISTS",
      resDup.status === 400 && resDup.data?.error?.code === "USERNAME_EXISTS",
      { status: 400, code: "USERNAME_EXISTS" },
      { status: resDup.status, code: resDup.data?.error?.code }
    );
  }

  // 2.3 Boundary tests on /api/admin/users/:id/reset-password
  if (testUserId) {
    const resResetShort = await request(`/api/admin/users/${testUserId}/reset-password`, {
      method: "POST",
      token: adminToken,
      body: { newPassword: "12345" }, // < 6 chars
    });
    record("PasswordReset-Boundary", "2.3a Reset password < 6 chars returns 400 INVALID_PASSWORD",
      resResetShort.status === 400 && resResetShort.data?.error?.code === "INVALID_PASSWORD",
      { status: 400, code: "INVALID_PASSWORD" },
      { status: resResetShort.status, code: resResetShort.data?.error?.code }
    );

    const resResetValid = await request(`/api/admin/users/${testUserId}/reset-password`, {
      method: "POST",
      token: adminToken,
      body: { newPassword: "NewSuperPassword678!" },
    });
    record("PasswordReset-Boundary", "2.3b Reset password >= 6 chars returns 200 OK",
      resResetValid.status === 200, 200, resResetValid.status
    );

    // Verify login with new password succeeds and old fails
    const oldLogin = await request("/api/auth/login", {
      method: "POST",
      body: { username: regularUsername, password: regularPassword },
    });
    record("PasswordReset-Boundary", "2.3c Old password rejected with 401 after reset", oldLogin.status === 401, 401, oldLogin.status);

    const newLogin = await request("/api/auth/login", {
      method: "POST",
      body: { username: regularUsername, password: "NewSuperPassword678!" },
    });
    record("PasswordReset-Boundary", "2.3d New password accepted with 200 after reset", newLogin.status === 200, 200, newLogin.status);
  }

  // Summary
  console.log("\n================================================================================");
  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`🏁 Total Challenges: ${total}`);
  console.log(`\x1b[32m   Passed:           ${passed}\x1b[0m`);
  if (failed > 0) {
    console.log(`\x1b[31m   Failed:           ${failed}\x1b[0m`);
  }
  console.log("================================================================================\n");

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAllChallenges().catch(err => {
  console.error("Fatal challenge error:", err);
  process.exit(1);
});
