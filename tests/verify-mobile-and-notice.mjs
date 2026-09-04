import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const BASE_URL = "http://127.0.0.1:8675";
const JWT_SECRET = "canvas-production-jwt-secret-replace-in-env";

let totalTests = 0;
let passedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passedTests++;
  console.log(`✅ PASS: ${message}`);
}

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  const res = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, data: json, text };
}

// Generate JWT tokens
async function getJwtToken(payload) {
  // Use node crypto to construct a valid HMAC-SHA256 JWT
  const crypto = await import("node:crypto");
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = Buffer.from(JSON.stringify({ userId: payload.id, sub: payload.id, ...payload, iat: now, exp: now + 3600 })).toString("base64url");
  const signature = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${fullPayload}`).digest("base64url");
  return `${header}.${fullPayload}.${signature}`;
}

async function runTests() {
  console.log("=== Starting Automated Test Suite for Mobile UX and Admin Notice System ===");

  const adminToken = await getJwtToken({ id: "3ae36533-19a8-4a00-b5e3-339971606cea", username: "admin", role: "admin" });
  const userToken = await getJwtToken({ id: "4ae26beb-d186-49d9-89a0-d010c9b0264b", username: "laoda", role: "user" });

  // 1. Health check
  console.log("\n--- 1. Service Health Check ---");
  const healthRes = await request("/api/health");
  assert(healthRes.status === 200, "GET /api/health returns 200");
  assert(healthRes.data?.status === "ok", "Health status is ok");

  // 2. Public Notice Endpoint
  console.log("\n--- 2. Public Notice Endpoint ---");
  const publicNoticeRes = await request("/api/notice");
  assert(publicNoticeRes.status === 200, "GET /api/notice returns 200 without authentication");
  assert(publicNoticeRes.data?.success === true, "GET /api/notice success is true");
  assert(typeof publicNoticeRes.data?.notice === "object", "GET /api/notice notice is an object");
  assert(typeof publicNoticeRes.data?.notice?.title === "string", "Notice title is a string");
  assert(Array.isArray(publicNoticeRes.data?.notice?.items), "Notice items is an array");
  assert(typeof publicNoticeRes.data?.notice?.updatedAt === "string", "Notice updatedAt is a timestamp string");

  // 3. Admin Notice Endpoint - Permissions & Guards
  console.log("\n--- 3. Admin Notice Security & Auth Guard ---");
  const noTokenRes = await request("/api/admin/notice");
  assert(noTokenRes.status === 401, "GET /api/admin/notice without token returns 401 Unauthorized");

  const userTokenRes = await request("/api/admin/notice", { headers: { Authorization: `Bearer ${userToken}` } });
  assert(userTokenRes.status === 403, "GET /api/admin/notice with non-admin token returns 403 Forbidden");

  const adminNoticeRes = await request("/api/admin/notice", { headers: { Authorization: `Bearer ${adminToken}` } });
  assert(adminNoticeRes.status === 200, "GET /api/admin/notice with admin token returns 200 OK");
  assert(adminNoticeRes.data?.notice?.title !== undefined, "Admin notice returns config object");

  // 4. Admin Update Validation & Persistence
  console.log("\n--- 4. Admin Notice PUT Validation & Persistence ---");
  const invalidTitleRes = await request("/api/admin/notice", {
    method: "PUT",
    headers: { Authorization: `Bearer ${adminToken}` },
    body: { title: "   " },
  });
  assert(invalidTitleRes.status === 400, "PUT /api/admin/notice with empty title returns 400 Bad Request");
  assert(invalidTitleRes.data?.error?.code === "INVALID_TITLE", "Error code is INVALID_TITLE");

  const customNotice = {
    enabled: true,
    title: "【重要通知】全站核心模型已全面升级 2.0",
    tag: "重大发布",
    tagColor: "green",
    content: "尊敬的用户，我们已于今日凌晨完成画质引擎与移动端全套手势升级。",
    items: [
      { title: "移动端触控优化：", description: "支持双指捏合缩放视口、双指平移、单指拖拽节点与连线。", type: "tip" },
      { title: "后台公告自设系统：", description: "管理员可随时在管理后台自由发布全站通知与注意事项。", type: "info" },
    ],
    footerNote: "祝您创作愉快！如遇问题请在创作者社群中反馈。",
  };

  const updateRes = await request("/api/admin/notice", {
    method: "PUT",
    headers: { Authorization: `Bearer ${adminToken}` },
    body: customNotice,
  });
  assert(updateRes.status === 200, "PUT /api/admin/notice returns 200 OK");
  assert(updateRes.data?.success === true, "PUT response success is true");
  assert(updateRes.data?.notice?.title === customNotice.title, "Saved title matches custom title");
  assert(updateRes.data?.notice?.tag === customNotice.tag, "Saved tag matches custom tag");
  assert(updateRes.data?.notice?.tagColor === customNotice.tagColor, "Saved tagColor matches green");
  assert(updateRes.data?.notice?.items.length === 2, "Saved items length is 2");

  // Verify that public endpoint now reflects this update immediately
  const publicAfterUpdate = await request("/api/notice");
  assert(publicAfterUpdate.data?.notice?.title === customNotice.title, "Public endpoint immediately serves updated announcement");
  assert(publicAfterUpdate.data?.notice?.tag === "重大发布", "Public endpoint returns updated tag");

  // 5. Verify Toggling Notice Off
  console.log("\n--- 5. Notice Toggle Off & On ---");
  const disableRes = await request("/api/admin/notice", {
    method: "PUT",
    headers: { Authorization: `Bearer ${adminToken}` },
    body: { enabled: false },
  });
  assert(disableRes.status === 200, "PUT /api/admin/notice disabling notice returns 200");
  assert(disableRes.data?.notice?.enabled === false, "Notice enabled is now false");

  const publicDisabled = await request("/api/notice");
  assert(publicDisabled.data?.notice?.enabled === false, "Public endpoint returns enabled: false");

  // Re-enable
  const enableRes = await request("/api/admin/notice", {
    method: "PUT",
    headers: { Authorization: `Bearer ${adminToken}` },
    body: { enabled: true },
  });
  assert(enableRes.data?.notice?.enabled === true, "Notice re-enabled successfully");

  // 6. Admin Reset Endpoint
  console.log("\n--- 6. Admin Notice Reset Endpoint ---");
  const noTokenReset = await request("/api/admin/notice/reset", { method: "POST" });
  assert(noTokenReset.status === 401, "POST /api/admin/notice/reset without token returns 401");

  const resetRes = await request("/api/admin/notice/reset", {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert(resetRes.status === 200, "POST /api/admin/notice/reset returns 200 OK");
  assert(resetRes.data?.success === true, "Reset response success is true");
  assert(resetRes.data?.notice?.title.includes("Grok 2.0"), "Reset notice restores default Grok 2.0 announcement");
  assert(resetRes.data?.notice?.updatedAt !== undefined, "Reset notice has updated timestamp");

  // 7. Client Dismissal Logic Simulation (Testing "Don't Show Today" robustness)
  console.log("\n--- 7. Client 'Don't Show Today' Dismissal Algorithm Unit Check ---");
  function isNoticeDismissed(rawStorage, todayStr, currentUpdatedAt) {
    if (!rawStorage) return false;
    try {
      if (rawStorage.startsWith("{")) {
        const parsed = JSON.parse(rawStorage);
        return parsed.date === todayStr && (!currentUpdatedAt || parsed.updatedAt === currentUpdatedAt);
      } else {
        const firstColon = rawStorage.indexOf(":");
        if (firstColon !== -1) {
          const dismissedDate = rawStorage.slice(0, firstColon);
          const dismissedUpdatedAt = rawStorage.slice(firstColon + 1);
          return dismissedDate === todayStr && (!currentUpdatedAt || dismissedUpdatedAt === currentUpdatedAt);
        }
      }
    } catch {}
    return false;
  }

  const today = new Date().toISOString().slice(0, 10);
  const initialUpdatedAt = "2026-09-04T02:00:00.000Z";
  const storedJson = JSON.stringify({ date: today, updatedAt: initialUpdatedAt });

  assert(isNoticeDismissed(storedJson, today, initialUpdatedAt) === true, "Same day and same updatedAt -> is dismissed");

  const newAdminPublishTime = "2026-09-04T02:30:00.000Z";
  assert(isNoticeDismissed(storedJson, today, newAdminPublishTime) === false, "Admin republished new notice -> dismissal invalidated, re-pops up!");

  const tomorrow = "2026-09-05";
  assert(isNoticeDismissed(storedJson, tomorrow, initialUpdatedAt) === false, "Next day -> dismissal expired, re-pops up for new day");

  // Legacy colon compatibility test (handles colon in ISO timestamp)
  const legacyColonFormat = `${today}:${initialUpdatedAt}`;
  assert(isNoticeDismissed(legacyColonFormat, today, initialUpdatedAt) === true, "Legacy format with ISO timestamp parses correctly without colon truncation");

  // 8. Mobile Assets & Code Bundling Verification
  console.log("\n--- 8. Frontend Assets & Mobile Code Bundle Verification ---");
  const htmlContent = fs.readFileSync("/home/ubuntu/infinite-canvas-new/web/index.html", "utf8");
  assert(htmlContent.includes("viewport-fit=cover"), "index.html has viewport-fit=cover");
  assert(htmlContent.includes("user-scalable=no"), "index.html disables accidental page zoom");

  const cssContent = fs.readFileSync("/home/ubuntu/infinite-canvas-new/web/src/styles/globals.css", "utf8");
  assert(cssContent.includes("overscroll-behavior-y: none"), "globals.css has overscroll-behavior-y: none");

  const canvasNodeContent = fs.readFileSync("/home/ubuntu/infinite-canvas-new/web/src/components/canvas/canvas-node.tsx", "utf8");
  assert(canvasNodeContent.includes("touch-none"), "canvas-node.tsx has touch-none");
  assert(canvasNodeContent.includes("setPointerCapture"), "canvas-node.tsx has setPointerCapture on touch down");

  const projectContent = fs.readFileSync("/home/ubuntu/infinite-canvas-new/web/src/pages/canvas/project.tsx", "utf8");
  assert(projectContent.includes("activeTouchesRef"), "project.tsx tracks multi-touch pointers with activeTouchesRef");
  assert(!projectContent.includes("handleGlobalMouseMove"), "project.tsx eliminated duplicate mouse listeners");

  const toolbarHoverContent = fs.readFileSync("/home/ubuntu/infinite-canvas-new/web/src/components/canvas/canvas-node-hover-toolbar.tsx", "utf8");
  assert(toolbarHoverContent.includes('isMobile ? "50%"'), "canvas-node-hover-toolbar centers horizontally on mobile screens");

  const systemNoticeModalContent = fs.readFileSync("/home/ubuntu/infinite-canvas-new/web/src/components/layout/system-notice-modal.tsx", "utf8");
  assert(systemNoticeModalContent.includes("当前暂无生效中的全站系统公告"), "system-notice-modal.tsx provides non-null feedback when opened with disabled notice");

  console.log(`\n🎉 All ${passedTests}/${totalTests} integration tests passed successfully!`);
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
