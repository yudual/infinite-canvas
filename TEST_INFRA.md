# E2E Test Infrastructure & Verification Architecture

## 1. Overview & Methodology

The Infinite Canvas End-to-End (E2E) Test Suite is designed as an **opaque-box, contract-driven, automated test framework** targeting the full-stack system via standard HTTP/REST endpoints and static file endpoints.

### Key Testing Principles:
1. **Opaque-Box Verification**: All test cases interact strictly through external HTTP REST APIs (`/api/*`) and static routes (`/uploads/*`), treating the server internals as a black box.
2. **Deterministic & Offline Execution**: Includes a built-in lightweight mock OpenAI upstream server (`mock-ai-server.ts`) allowing complete end-to-end proxy verification without external internet access or third-party API costs.
3. **Zero Key Leak Audit**: Rigorous assertions verify that server-side AI API keys are never exposed in response bodies, response headers, or error messages.
4. **Tenant & Data Isolation**: Validates multi-user authorization barriers, ensuring users cannot access, modify, or delete other users' canvas projects or private assets.
5. **Multi-Tier Organization**: Structured into 4 distinct verification tiers ensuring both comprehensive feature coverage and deep adversarial boundary hardening.

---

## 2. Test Architecture & Directory Layout

```
/home/dual/Projects/canvas/
├── TEST_INFRA.md                          # Test infrastructure specification (this document)
├── TEST_READY.md                          # Test readiness & pass summary report
└── tests/
    └── e2e/
        ├── harness/
        │   ├── api-client.ts              # Typed HTTP REST client with Bearer JWT & multipart support
        │   ├── mock-ai-server.ts          # Mock OpenAI-compatible upstream API server
        │   ├── test-context.ts            # Test environment configuration, base URL, and runner helpers
        │   └── assertions.ts              # Assertion utilities (zero key leak, error schema, tenant checks)
        ├── types.ts                       # Shared DTOs and API response interfaces
        ├── tier1-features/                # Tier 1: Primary Feature Coverage (>=5 tests per feature)
        │   ├── r1-setup-auth.test.ts      # Setup wizard, JWT authentication, session profile
        │   ├── r2-admin-dashboard.test.ts # Admin users CRUD, AI config, test probe, stats
        │   ├── r3-ai-proxy.test.ts        # Image generation, edits, chat streaming, key isolation
        │   ├── r4-cloud-projects.test.ts  # Project CRUD, asset upload, static serving
        │   └── r5-frontend-integ.test.ts  # Model discovery, canvas state serialization
        ├── tier2-boundaries/              # Tier 2: Boundary & Corner Cases (>=5 tests per feature)
        │   ├── r1-auth-boundaries.test.ts # Invalid credentials, malformed tokens, repeated setup
        │   ├── r2-admin-boundaries.test.ts# Self-deletion block, invalid roles, duplicate users
        │   ├── r3-proxy-boundaries.test.ts# Unconfigured AI, invalid payload, upstream failures
        │   ├── r4-storage-boundaries.test.ts# Traversal attacks, oversized payloads, invalid MIME
        │   └── r5-integ-boundaries.test.ts# Corrupted canvas graph, concurrent mutations
        ├── tier3-combinations/            # Tier 3: Cross-Feature Combinations & State Transitions
        │   ├── auth-admin-matrix.test.ts  # Admin disables user -> token immediately rejected
        │   ├── admin-proxy-lifecycle.test.ts # Admin updates AI settings -> proxy uses new upstream
        │   ├── user-project-isolation.test.ts # User A cannot read/update/delete User B's projects
        │   └── asset-lifecycle-cleanup.test.ts # User creation -> asset upload -> deletion cascade
        ├── tier4-scenarios/               # Tier 4: Real-World Multi-Step User Scenarios
        │   ├── full-user-lifecycle.test.ts# Setup -> Admin create user -> Login -> Change password
        │   ├── canvas-workflow-e2e.test.ts# Login -> Create project -> Generate AI -> Save & Reload
        │   └── admin-ops-e2e.test.ts      # Full admin operations workflow with system stats
        └── run-tests.ts                   # Master test runner CLI with filtering and colored output
```

---

## 3. Feature Inventory & Coverage Mapping

| Req ID | Feature ID | Feature Name | Test Suite Coverage |
|---|---|---|---|
| **R1** | `FEAT-AUTH-01` | Setup Status Check | `tier1-features/r1-setup-auth.test.ts` |
| **R1** | `FEAT-AUTH-02` | First-Time Admin Setup | `tier1-features/r1-setup-auth.test.ts`, `tier2-boundaries/r1-auth-boundaries.test.ts` |
| **R1** | `FEAT-AUTH-03` | User Login & JWT Issuance | `tier1-features/r1-setup-auth.test.ts`, `tier2-boundaries/r1-auth-boundaries.test.ts` |
| **R1** | `FEAT-AUTH-04` | Session Profile (`/api/auth/me`)| `tier1-features/r1-setup-auth.test.ts` |
| **R1** | `FEAT-AUTH-05` | User Logout | `tier1-features/r1-setup-auth.test.ts` |
| **R1** | `FEAT-AUTH-06` | Route Guards & Unauth Intercept | `tier1-features/r1-setup-auth.test.ts`, `tier2-boundaries/r1-auth-boundaries.test.ts` |
| **R2** | `FEAT-ADMIN-01` | Admin Dashboard Authorization Guard | `tier1-features/r2-admin-dashboard.test.ts` |
| **R2** | `FEAT-ADMIN-02` | User List & Search Pagination | `tier1-features/r2-admin-dashboard.test.ts` |
| **R2** | `FEAT-ADMIN-03` | Admin User Creation | `tier1-features/r2-admin-dashboard.test.ts`, `tier2-boundaries/r2-admin-boundaries.test.ts` |
| **R2** | `FEAT-ADMIN-04` | Toggle User Active/Disabled Status | `tier1-features/r2-admin-dashboard.test.ts`, `tier3-combinations/auth-admin-matrix.test.ts` |
| **R2** | `FEAT-ADMIN-05` | Admin Reset User Password | `tier1-features/r2-admin-dashboard.test.ts`, `tier4-scenarios/full-user-lifecycle.test.ts` |
| **R2** | `FEAT-ADMIN-06` | Delete User Account | `tier1-features/r2-admin-dashboard.test.ts`, `tier2-boundaries/r2-admin-boundaries.test.ts` |
| **R2** | `FEAT-ADMIN-07` | Get AI Config (Masked Key) | `tier1-features/r2-admin-dashboard.test.ts`, `tier1-features/r3-ai-proxy.test.ts` |
| **R2** | `FEAT-ADMIN-08` | Update AI Config | `tier1-features/r2-admin-dashboard.test.ts`, `tier3-combinations/admin-proxy-lifecycle.test.ts` |
| **R2** | `FEAT-ADMIN-09` | Test AI Connectivity Probe | `tier1-features/r2-admin-dashboard.test.ts` |
| **R2** | `FEAT-ADMIN-10` | System Statistics Overview | `tier1-features/r2-admin-dashboard.test.ts`, `tier4-scenarios/admin-ops-e2e.test.ts` |
| **R3** | `FEAT-PROXY-01` | Image Generation Proxy | `tier1-features/r3-ai-proxy.test.ts`, `tier4-scenarios/canvas-workflow-e2e.test.ts` |
| **R3** | `FEAT-PROXY-02` | Image Edit Proxy | `tier1-features/r3-ai-proxy.test.ts` |
| **R3** | `FEAT-PROXY-03` | Chat & Agent SSE Proxy | `tier1-features/r3-ai-proxy.test.ts` |
| **R3** | `FEAT-PROXY-04` | Zero Key Leak Isolation | `tier1-features/r3-ai-proxy.test.ts`, `tier2-boundaries/r3-proxy-boundaries.test.ts` |
| **R4** | `FEAT-PROJ-01` | List User Projects | `tier1-features/r4-cloud-projects.test.ts` |
| **R4** | `FEAT-PROJ-02` | Create Cloud Canvas Project | `tier1-features/r4-cloud-projects.test.ts`, `tier4-scenarios/canvas-workflow-e2e.test.ts` |
| **R4** | `FEAT-PROJ-03` | Load Project Detail | `tier1-features/r4-cloud-projects.test.ts`, `tier3-combinations/user-project-isolation.test.ts` |
| **R4** | `FEAT-PROJ-04` | Update Project Graph State | `tier1-features/r4-cloud-projects.test.ts` |
| **R4** | `FEAT-PROJ-05` | Delete Project | `tier1-features/r4-cloud-projects.test.ts` |
| **R4** | `FEAT-ASSET-01` | Asset File Upload (`/api/upload`) | `tier1-features/r4-cloud-projects.test.ts`, `tier2-boundaries/r4-storage-boundaries.test.ts` |
| **R4** | `FEAT-ASSET-02` | Static Asset Serving (`/uploads/*`)| `tier1-features/r4-cloud-projects.test.ts`, `tier2-boundaries/r4-storage-boundaries.test.ts` |
| **R4** | `FEAT-ASSET-03` | List & Delete Assets | `tier1-features/r4-cloud-projects.test.ts`, `tier3-combinations/asset-lifecycle-cleanup.test.ts` |
| **R5** | `FEAT-UI-01` | Auth Contract Verification | `tier1-features/r5-frontend-integ.test.ts` |
| **R5** | `FEAT-UI-02` | User Profile Contract | `tier1-features/r5-frontend-integ.test.ts` |
| **R5** | `FEAT-UI-03` | Cloud Sync Data Graph Serialization| `tier1-features/r5-frontend-integ.test.ts`, `tier4-scenarios/canvas-workflow-e2e.test.ts` |
| **R5** | `FEAT-UI-04` | AI Service Routing & Model Presets | `tier1-features/r5-frontend-integ.test.ts` |

---

## 4. Test Tiers Structure

### Tier 1: Feature Coverage (>=5 tests per requirement)
- Verifies nominal functional behavior ("happy paths") for all core endpoints.
- Verifies exact contract matching: request/response JSON schemas, HTTP status codes, and headers.
- Covers R1 (Auth & Setup), R2 (Admin Dashboard), R3 (AI Proxy), R4 (Cloud Projects & Storage), and R5 (Frontend Integration Contracts).

### Tier 2: Boundary & Corner Cases (>=5 tests per requirement)
- Verifies defensive behavior under malformed, missing, extreme, or adversarial inputs.
- Covers:
  - Empty or whitespace usernames/passwords, duplicate registrations.
  - Non-admin access to admin endpoints, attempts to delete/disable own admin account.
  - AI proxy calls before configuration, invalid models, upstream rate limits (429) and upstream server errors (500).
  - Path traversal attempts (`/uploads/../../etc/passwd`), non-image MIME spoofing, large payloads (>10MB).
  - Malformed project JSON graphs and invalid UUID parameters.

### Tier 3: Cross-Feature Combinations & State Transitions
- Verifies system behavior across interconnected features and lifecycle transitions:
  - **Auth-Admin Matrix**: Admin changes user status to "disabled" -> user's active JWT token is immediately rejected on subsequent API calls without server restart.
  - **Admin-Proxy Dynamic Configuration**: Admin configures a new mock upstream URL and API key -> subsequent proxy generation requests immediately route to the new upstream with the updated secret.
  - **Multi-Tenant Isolation**: User A creates project A and asset A; User B cannot read, modify, or delete User A's resources (returns 403 or 404).
  - **Asset Cascade & Lifecycle**: Creating project with asset references, updating asset metadata, and deleting assets.

### Tier 4: Real-World User Scenarios
- Verifies full end-to-end multi-step user and administrator journeys:
  1. **Scenario A (First-time Admin Setup & User Onboarding)**: Empty DB -> `/api/setup/status` -> Admin registers -> Admin configures AI -> Admin creates user "bob" -> "bob" logs in and changes password.
  2. **Scenario B (End-to-End Canvas Project Lifecycle)**: User logs in -> Creates canvas project with image, text, and config nodes -> Generates image through AI proxy -> Attaches generated image URL to project -> Updates project state -> Logs out -> Logs in as another session and reloads identical canvas graph.
  3. **Scenario C (Admin Operations & System Monitoring)**: Admin audits user list, disables abusive account, runs connectivity probe to upstream AI provider, and inspects updated system statistics.

---

## 5. Running the Test Suite

### Default Execution:
```bash
# Run all E2E test tiers against local backend (default: http://localhost:3001)
npx tsx tests/e2e/run-tests.ts

# Or using bun:
bun run tests/e2e/run-tests.ts
```

### Environment Variables & Custom Options:
```bash
# Specify custom backend target URL:
BASE_URL=http://localhost:3000 npx tsx tests/e2e/run-tests.ts

# Filter tests by tier:
npx tsx tests/e2e/run-tests.ts --tier=tier1
npx tsx tests/e2e/run-tests.ts --tier=tier2
npx tsx tests/e2e/run-tests.ts --tier=tier3
npx tsx tests/e2e/run-tests.ts --tier=tier4

# Filter tests by pattern:
npx tsx tests/e2e/run-tests.ts --filter=proxy
```

---

## 6. Assertion & Verification Guarantees

All test assertions follow strict validation contracts:
- `assertStatus(res, expectedStatus)`
- `assertNoKeyLeak(responseBody, secretKey)`
- `assertValidJwt(token)`
- `assertErrorResponse(res, expectedCode, expectedStatus)`
- `assertTenantIsolation(userAClient, userBClient, resourceId)`
