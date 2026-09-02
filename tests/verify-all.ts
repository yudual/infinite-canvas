import fs from "node:fs";
import path from "node:path";

const BASE_URL = process.env.TEST_BASE_URL || "http://127.0.0.1:3001";

async function runVerification() {
  console.log("=== Starting Infinite Canvas End-to-End System Verification ===");
  console.log(`Target: ${BASE_URL}`);

  let adminToken = "";
  let userToken = "";
  let testUserId = "";
  let testProjectId = "";
  let testAssetId = "";

  // 1. Setup Status
  console.log("\n[Test 1] Checking setup status...");
  const statusRes = await fetch(`${BASE_URL}/api/setup/status`);
  const statusData = await statusRes.json();
  console.log("Setup status:", statusData);

  // 2. First-time setup or Login as admin
  console.log("\n[Test 2] Setting up or logging in as initial admin...");
  if (statusData.requiresSetup) {
    const setupRes = await fetch(`${BASE_URL}/api/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "admin_test",
        password: "AdminPassword123!",
        displayName: "Super Admin",
      }),
    });
    const setupData = await setupRes.json();
    if (!setupRes.ok || !setupData.token) {
      throw new Error(`Setup failed: ${JSON.stringify(setupData)}`);
    }
    adminToken = setupData.token;
    console.log("✓ First-time setup succeeded, admin token received");
  } else {
    // Admin login
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "admin_test",
        password: "AdminPassword123!",
      }),
    });
    const loginData = await loginRes.json();
    if (!loginRes.ok || !loginData.token) {
      throw new Error(`Admin login failed: ${JSON.stringify(loginData)}`);
    }
    adminToken = loginData.token;
    console.log("✓ Admin logged in successfully");
  }

  // 3. Verify /api/auth/me
  console.log("\n[Test 3] Verifying session profile (/api/auth/me)...");
  const meRes = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const meData = await meRes.json();
  if (!meRes.ok || meData.user.role !== "admin") {
    throw new Error(`Auth me failed or not admin: ${JSON.stringify(meData)}`);
  }
  console.log("✓ Admin profile verified:", meData.user.username);

  // 4. Admin creates new user
  console.log("\n[Test 4] Admin creating new standard user...");
  const timestamp = Date.now();
  const newUsername = `user_${timestamp}`;
  const createUserRes = await fetch(`${BASE_URL}/api/admin/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      username: newUsername,
      password: "UserPassword123!",
      displayName: "Canvas Creator",
      role: "user",
    }),
  });
  const createUserData = await createUserRes.json();
  if (!createUserRes.ok || !createUserData.user?.id) {
    throw new Error(`Create user failed: ${JSON.stringify(createUserData)}`);
  }
  testUserId = createUserData.user.id;
  console.log("✓ User created:", testUserId, newUsername);

  // 5. Standard user login
  console.log("\n[Test 5] Standard user logging in...");
  const userLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: newUsername,
      password: "UserPassword123!",
    }),
  });
  const userLoginData = await userLoginRes.json();
  if (!userLoginRes.ok || !userLoginData.token) {
    throw new Error(`User login failed: ${JSON.stringify(userLoginData)}`);
  }
  userToken = userLoginData.token;
  console.log("✓ Standard user login succeeded");

  // 6. Security Check: Normal user accessing /api/admin/users should be 403 Forbidden
  console.log("\n[Test 6] Security Check: Regular user accessing /api/admin/users...");
  const forbiddenRes = await fetch(`${BASE_URL}/api/admin/users`, {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  if (forbiddenRes.status !== 403) {
    throw new Error(`Security violation! Expected 403 Forbidden but got ${forbiddenRes.status}`);
  }
  console.log("✓ Route guard active: Regular user correctly blocked from admin endpoints (403 Forbidden)");

  // 7. Admin updates AI Configuration
  console.log("\n[Test 7] Admin updating AI Configuration...");
  const updateAiRes = await fetch(`${BASE_URL}/api/admin/ai-config`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-proj-super-secret-test-key-12345678",
      imageModels: ["dall-e-3", "flux-dev", "midjourney-v6"],
      defaultModel: "dall-e-3",
    }),
  });
  const updateAiData = await updateAiRes.json();
  if (!updateAiRes.ok || !updateAiData.success) {
    throw new Error(`Update AI config failed: ${JSON.stringify(updateAiData)}`);
  }
  console.log("✓ AI Config updated");

  // 7.1. Admin tests model discovery endpoint
  console.log("\n[Test 7.1] Testing Upstream Model Discovery endpoint (/api/admin/ai-config/fetch-models)...");
  const fetchModelsRes = await fetch(`${BASE_URL}/api/admin/ai-config/fetch-models`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-invalid-test-probe",
    }),
  });
  const fetchModelsData = await fetchModelsRes.json();
  if (!fetchModelsData.message) {
    throw new Error(`fetch-models should return diagnosis message: ${JSON.stringify(fetchModelsData)}`);
  }
  console.log("✓ fetch-models responded correctly with diagnosis:", fetchModelsData.message);

  // 8. Admin reads AI Config (must be masked)
  console.log("\n[Test 8] Admin retrieving AI Config (verifying key masking)...");
  const getAiRes = await fetch(`${BASE_URL}/api/admin/ai-config`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const getAiData = await getAiRes.json();
  if (!getAiRes.ok || getAiData.apiKeyMasked.includes("secret")) {
    throw new Error(`API key leak in admin config! Data: ${JSON.stringify(getAiData)}`);
  }
  console.log("✓ AI Key masked properly:", getAiData.apiKeyMasked);

  // 9. Standard user fetches models (Zero key leakage)
  console.log("\n[Test 9] User fetching AI models (/api/ai/models)...");
  const modelsRes = await fetch(`${BASE_URL}/api/ai/models`, {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  const modelsData = await modelsRes.json();
  if (!modelsRes.ok || !Array.isArray(modelsData.imageModels)) {
    throw new Error(`Fetch models failed: ${JSON.stringify(modelsData)}`);
  }
  if (JSON.stringify(modelsData).includes("super-secret")) {
    throw new Error("CRITICAL SECURITY ERROR: Secret key found in user models response!");
  }
  console.log("✓ AI models retrieved safely:", modelsData.imageModels);

  // 10. Cloud Project Persistence
  console.log("\n[Test 10] Testing Cloud Canvas Project Persistence...");
  const createProjRes = await fetch(`${BASE_URL}/api/projects`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userToken}`,
    },
    body: JSON.stringify({
      name: "My Fantastic Canvas 1",
      canvasData: {
        nodes: [{ id: "node-1", type: "image", x: 100, y: 200, data: { prompt: "A cyberpunk city" } }],
        connections: [],
      },
    }),
  });
  const createProjData = await createProjRes.json();
  if (!createProjRes.ok || !createProjData.project?.id) {
    throw new Error(`Create project failed: ${JSON.stringify(createProjData)}`);
  }
  testProjectId = createProjData.project.id;
  console.log("✓ Project created:", testProjectId, createProjData.project.name);

  // 11. Read and update project
  console.log("\n[Test 11] Loading and updating project detail...");
  const getProjRes = await fetch(`${BASE_URL}/api/projects/${testProjectId}`, {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  const getProjData = await getProjRes.json();
  if (!getProjRes.ok || getProjData.project.canvasData.nodes.length !== 1) {
    throw new Error(`Load project failed: ${JSON.stringify(getProjData)}`);
  }

  const updateProjRes = await fetch(`${BASE_URL}/api/projects/${testProjectId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userToken}`,
    },
    body: JSON.stringify({
      name: "My Fantastic Canvas (Renamed)",
      canvasData: {
        nodes: [
          { id: "node-1", type: "image", x: 100, y: 200, data: { prompt: "A cyberpunk city" } },
          { id: "node-2", type: "text", x: 300, y: 400, data: { content: "Note" } },
        ],
        connections: [],
      },
    }),
  });
  const updateProjData = await updateProjRes.json();
  if (!updateProjRes.ok || updateProjData.project.name !== "My Fantastic Canvas (Renamed)") {
    throw new Error(`Update project failed: ${JSON.stringify(updateProjData)}`);
  }
  console.log("✓ Project updated successfully");

  // 12. Asset Upload & Static Serving
  console.log("\n[Test 12] Uploading image asset to /api/upload and checking static serving...");
  const samplePngBuffer = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64"
  );
  const formData = new FormData();
  formData.append("file", new Blob([samplePngBuffer], { type: "image/png" }), "test-pixel.png");

  const uploadRes = await fetch(`${BASE_URL}/api/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${userToken}` },
    body: formData,
  });
  const uploadData = await uploadRes.json();
  if (!uploadRes.ok || !uploadData.url) {
    throw new Error(`Upload asset failed: ${JSON.stringify(uploadData)}`);
  }
  testAssetId = uploadData.id;
  console.log("✓ Asset uploaded:", uploadData.url);

  // Check static file retrieval
  const staticRes = await fetch(`${BASE_URL}${uploadData.url}`);
  if (!staticRes.ok || staticRes.headers.get("content-type") !== "image/png") {
    throw new Error(`Static asset serving failed: ${staticRes.status}, Content-Type: ${staticRes.headers.get("content-type")}`);
  }
  console.log("✓ Static asset served correctly with Content-Type image/png");

  // 13. Admin stats overview
  console.log("\n[Test 13] Checking admin stats overview...");
  const statsRes = await fetch(`${BASE_URL}/api/admin/stats`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const statsData = await statsRes.json();
  if (!statsRes.ok || statsData.userCount < 2 || statsData.projectCount < 1) {
    throw new Error(`Stats verification failed: ${JSON.stringify(statsData)}`);
  }
  console.log("✓ System stats verified:", statsData);

  // 14. Disable user account and verify 403
  console.log("\n[Test 14] Disabling user account...");
  const disableRes = await fetch(`${BASE_URL}/api/admin/users/${testUserId}/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ status: "disabled" }),
  });
  const disableData = await disableRes.json();
  if (!disableRes.ok || disableData.user.status !== "disabled") {
    throw new Error(`Disable user failed: ${JSON.stringify(disableData)}`);
  }

  const disabledAttemptRes = await fetch(`${BASE_URL}/api/projects`, {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  if (disabledAttemptRes.status !== 403) {
    throw new Error(`Expected disabled user to receive 403, but got ${disabledAttemptRes.status}`);
  }
  console.log("✓ Disabled user account immediately rejected with 403 Forbidden");

  console.log("\n=======================================================");
  console.log("🎉 ALL END-TO-END ACCEPTANCE TESTS PASSED SUCCESSFULLY!");
  console.log("=======================================================\n");
}

runVerification().catch((err) => {
  console.error("\n❌ VERIFICATION TEST FAILED:", err);
  process.exit(1);
});
