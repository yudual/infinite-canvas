# Project: Infinite Canvas Full-Stack Enhancement & Multi-Channel Admin Upgrade

## Architecture
A full-stack infinite canvas creative platform with a Node.js/TypeScript Express backend, SQLite local database (`better-sqlite3` / `bun:sqlite`), JWT authentication, Ant Design 6 admin dashboard, intelligent multi-channel AI provider pool with automated failover routing, asset and cloud project console, AI request audit logs, and clean token-based design system.

```
+---------------------------------------------------------------------------------------------------+
|                                          Browser Client                                           |
|                  (React 19 + Vite 7 + React Router 7 + Ant Design 6 + Zustand 5)                  |
|                                                                                                   |
|  - Setup Wizard (/setup)                                    - Login (/login)                      |
|  - Canvas Workspace (/canvas/:id)                           - User Profile Dropdown               |
|  - Admin Dashboard (/admin):                                                                      |
|    * System Overview (Metrics Grid, Quick Actions)                                                |
|    * Multi-Channel Model Pool (Channel Table, Modals, Model Tag Editor, Upstream Model Discovery)   |
|    * Asset Management Console (Thumbnail Previews, Size Sort, Disk Storage Stats, Batch Delete)   |
|    * Project Management Console (Owner Query, Canvas Size, Recovery Reset, Delete)                |
|    * AI Request Audit Logs (Status Badges, Latency Tags, Failover Traces, JSON Detail Drawer)     |
|    * User Management (CRUD, Status Toggle, Password Reset)                                        |
+---------------------------------------------------------------------------------------------------+
                                                  |
                             HTTP REST / SSE      | Bearer JWT (Vite dev proxy / Single port)
                                                  v
+---------------------------------------------------------------------------------------------------+
|                               Express Backend Service (Node.js / TS)                              |
|                                                                                                   |
|  +-----------------------+  +------------------------------------------------------------------+  |
|  |   /api/setup & auth   |  |                   /api/admin (Protected Admin)                   |  |
|  | - First admin init    |  | - /users: User CRUD, status, password reset                      |  |
|  | - JWT Login/Me        |  | - /channels: Multi-provider CRUD, priority, health probe, sync   |  |
|  | - bcrypt hashing      |  | - /assets: Multi-user query, disk space stats, batch unlink      |  |
|  +-----------------------+  | - /projects: User project query, canvas reset, delete            |  |
|                             | - /audit-logs: Multi-dimensional log query & payload details     |  |
|                             | - /stats: Comprehensive system metrics                           |  |
|                             +------------------------------------------------------------------+  |
|  +---------------------------------------------------------------------------------------------+  |
|  |                     /api/ai (Secure AI Proxy with Intelligent Router)                       |  |
|  | - Dynamic Candidate Channel Matching by Requested Model & Priority                          |  |
|  | - Automated Failover Loop on HTTP 429 / 5xx / Network Timeouts (Alternate Channels)        |  |
|  | - Zero Key Leak Isolation & Sanitized Request/Response Logging                              |  |
|  +---------------------------------------------------------------------------------------------+  |
|  +------------------------------------------------------+  +-----------------------------------+  |
|  |                    /api/projects                     |  |       /api/assets & /uploads      |  |
|  | - User Cloud Canvas CRUD                             |  | - Multer upload, MIME validation  |  |
|  | - Node graph & state persistence                     |  | - Physical disk storage (/uploads)|  |
|  +------------------------------------------------------+  +-----------------------------------+  |
+---------------------------------------------------------------------------------------------------+
                  |                                                    |
                  v                                                    v
+--------------------------------------+             +----------------------------------------------+
|       SQLite DB (data/canvas.db)     |             |       Upstream Multi-Provider AI Pool        |
| - users, system_settings, projects   |             | - Channel A: OpenAI (gpt-4o, dall-e-3)       |
| - assets (with disk paths & sizes)   |             | - Channel B: SiliconFlow (flux, deepseek)    |
| - ai_channels (priority, health)     |             | - Channel C: DeepSeek / Custom Providers     |
| - ai_audit_logs (traces & latencies) |             +----------------------------------------------+
+--------------------------------------+
```

## Feature Inventory
| # | Feature ID | Feature Name | Description | Milestone | Source |
|---|------------|--------------|-------------|-----------|--------|
| 1 | FEAT-AUTH-01 | Setup Status Check | Check if system has initial admin registered | M0 (Done) | survey |
| 2 | FEAT-AUTH-02 | First-Time Admin Setup | Create initial super admin and initialize system | M0 (Done) | survey |
| 3 | FEAT-AUTH-03 | User Login | Authenticate user with username/password, issue JWT | M0 (Done) | survey |
| 4 | FEAT-AUTH-04 | Current Session Profile | Get logged-in user profile & verify token | M0 (Done) | survey |
| 5 | FEAT-AUTH-05 | User Logout | Invalidate client session and redirect to login | M0 (Done) | survey |
| 6 | FEAT-AUTH-06 | Frontend Route Guards | Protect canvas, admin, setup, and auth routes | M0 (Done) | survey |
| 7 | FEAT-CHAN-01 | AI Channels Schema & Migration | SQLite `ai_channels` schema, indexes, legacy auto-seeding | M1 | R1 |
| 8 | FEAT-CHAN-02 | Channel CRUD REST API | List, get, create, update, delete, and toggle AI channels | M1 | R1 |
| 9 | FEAT-CHAN-03 | Channel Health & Probe API | Health probe with latency measurement and error tracking | M1 | R1 |
| 10 | FEAT-CHAN-04 | Upstream Model Sync API | Probe `/models` to auto-discover and categorize models | M1 | R1 |
| 11 | FEAT-CHAN-05 | Intelligent AI Router Service | Match candidates by model, priority, health state | M1 | R1 |
| 12 | FEAT-CHAN-06 | Auto-Failover & Retry Loop | Seamless retry across backup channels on 429/5xx/timeout | M1 | R1 |
| 13 | FEAT-CHAN-07 | Proxy Route Integration | Wire `/api/ai/*` to use Intelligent Router | M1 | R1 |
| 14 | FEAT-ASSET-01 | Admin Assets Query API | List all user assets with search, MIME filter, size sorting | M2 | R2 |
| 15 | FEAT-ASSET-02 | Disk Space Statistics API | Disk space usage aggregation & orphan file detection | M2 | R2 |
| 16 | FEAT-ASSET-03 | Physical Asset Deletion API | Single & atomic batch deletion with `fs.unlinkSync` & DB delete | M2 | R2 |
| 17 | FEAT-PROJ-01 | Admin Projects Query API | List cloud projects across all users with data size | M2 | R2 |
| 18 | FEAT-PROJ-02 | Corrupt Project Reset API | Reset invalid/corrupted `canvas_data` to clean graph | M2 | R2 |
| 19 | FEAT-PROJ-03 | Admin Project Deletion API | Admin deletion of user projects | M2 | R2 |
| 20 | FEAT-LOG-01 | AI Audit Logs Schema | SQLite `ai_audit_logs` table with performance indexes | M3 | R3 |
| 21 | FEAT-LOG-02 | AI Interceptor & Logger | Intercept AI requests, record latency, channel, status | M3 | R3 |
| 22 | FEAT-LOG-03 | Zero Base64 Bleed Sanitizer | Sanitize large base64 payloads and redact API credentials | M3 | R3 |
| 23 | FEAT-LOG-04 | Admin Audit Logs Query API | Query logs with status, model, channel, date filtering | M3 | R3 |
| 24 | FEAT-TOKEN-01 | Design Token Enhancement | Comprehensive Alias & Component tokens in `app-theme.ts` | M4 | R4 |
| 25 | FEAT-UI-CHAN | Channel Pool Admin View | Modular ChannelTable, Modal, TagEditor, FetchModal | M4 | R1, R4 |
| 26 | FEAT-UI-ASSET | Asset Console Admin View | Modular AssetTable, StatsCard, BatchModal, ImagePreview | M4 | R2, R4 |
| 27 | FEAT-UI-PROJ | Project Console Admin View | Modular ProjectTable, ResetModal, ThumbnailPreview | M4 | R2, R4 |
| 28 | FEAT-UI-LOG | Audit Logs Admin View | Modular AuditLogTable, FilterBar, DetailDrawer | M4 | R3, R4 |
| 29 | FEAT-UI-CLEAN | AGENTS.md Cleanup & Split | Remove all 41 `dark:` classes, keep all files < 400 lines | M4 | R4 |
| 30 | FEAT-TEST-ALL | Acceptance & Verification | Automated test suites for all features + adversarial hardening | M5 | Acceptance |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Multi-Channel AI Pool & Routing Backend | `ai_channels` DB schema, Channel CRUD/probe/sync APIs, `ai-router` with failover loop, proxy integration | none | DONE |
| M2 | Asset & Project Console Backend | Admin Assets API with size sort & filters, disk space stats, single & batch `fs.unlinkSync` deletion, Admin Projects API with canvas data reset | none | DONE |
| M3 | AI Request Audit Logging Backend | `ai_audit_logs` DB schema, asynchronous logging interceptor, payload sanitizer, `/api/admin/audit-logs` query API | M1 | PLANNED |
| M4 | Ant Design System & Admin Frontend | `app-theme.ts` token expansion, modular views for Channels, Assets, Projects, Logs, clean all `dark:` classes, guarantee all files <400 lines | M1, M2, M3 | PLANNED |
| M5 | E2E Acceptance & Adversarial Hardening | Comprehensive automated test suites across all new endpoints, multi-channel failover simulation, line-count & token audits | M4 | PLANNED |

## Interface Contracts

### 1. AI Channel Management (`Authorization: Bearer <admin_token>`)
- `GET /api/admin/channels` -> `{ success: true, channels: ChannelDto[], total: number }`
- `GET /api/admin/channels/:id` -> `{ success: true, channel: ChannelDto }`
- `POST /api/admin/channels` -> Body: `{ name, providerType, baseUrl, apiKey, models, defaultModel?, priority?, weight?, timeoutMs?, customHeaders? }` -> `201 Created`: `{ success: true, channel: ChannelDto }`
- `PUT /api/admin/channels/:id` -> Body: `{ name, providerType, baseUrl, apiKey?, models, defaultModel?, priority?, weight?, timeoutMs?, customHeaders? }` -> `200 OK`: `{ success: true, channel: ChannelDto }`
- `PATCH /api/admin/channels/:id/status` -> Body: `{ isActive: boolean }` -> `200 OK`: `{ success: true, isActive: boolean }`
- `DELETE /api/admin/channels/:id` -> `200 OK`: `{ success: true, message: string }`
- `POST /api/admin/channels/:id/test` -> `200 OK`: `{ success: boolean, latencyMs: number, healthStatus: string, message: string }`
- `POST /api/admin/channels/:id/sync-models` -> `200 OK`: `{ success: boolean, total: number, imageModels: string[], chatModels: string[], allModels: string[] }`

### 2. Admin Asset & Project Management (`Authorization: Bearer <admin_token>`)
- `GET /api/admin/assets?page=1&limit=20&search=&userId=&mimeType=&sortBy=created_at&sortOrder=desc` -> `{ success: true, assets: AssetDto[], total: number, totalStorageBytes: number }`
- `GET /api/admin/assets/stats` -> `{ success: true, totalCount: number, totalBytes: number, imageCount: number, orphanDiskCount: number, orphanDiskBytes: number }`
- `DELETE /api/admin/assets/:id` -> `200 OK`: `{ success: true, message: string }` (removes DB record and physically unlinks file on disk)
- `POST /api/admin/assets/batch-delete` -> Body: `{ ids: string[] }` -> `200 OK`: `{ success: true, deletedCount: number, freedBytes: number }`
- `GET /api/admin/projects?page=1&limit=20&search=&userId=` -> `{ success: true, projects: AdminProjectDto[], total: number }`
- `POST /api/admin/projects/:id/reset` -> `200 OK`: `{ success: true, message: string, project: AdminProjectDto }` (resets corrupted canvasData to clean empty graph)
- `DELETE /api/admin/projects/:id` -> `200 OK`: `{ success: true, message: string }`

### 3. AI Audit Logging (`Authorization: Bearer <admin_token>`)
- `GET /api/admin/audit-logs?page=1&limit=20&status=&requestType=&model=&channelId=&userId=&startDate=&endDate=` -> `{ success: true, logs: AuditLogDto[], total: number }`
- `GET /api/admin/audit-logs/:id` -> `{ success: true, log: AuditLogDetailDto }`

### 4. AI Proxy Execution (`Authorization: Bearer <user_token>`)
- `POST /api/ai/images/generations` -> Dispatches via `aiRouter.routeRequest({ type: 'image_generation', ... })`. If primary channel returns 429/5xx/timeout, automatically fails over to candidate channel 2. Emits audit log.
- `POST /api/ai/images/edits` -> Dispatches via `aiRouter.routeRequest({ type: 'image_edit', ... })`. Auto failover. Emits audit log.
- `POST /api/ai/chat/completions` -> Dispatches via `aiRouter.routeRequest({ type: 'chat_completion', ... })`. Auto failover before SSE flush. Emits audit log.

## Code Layout
```
/home/dual/Projects/canvas/
├── server/
│   └── src/
│       ├── db.ts                                  # Database schema & migrations (ai_channels, ai_audit_logs, indexes)
│       ├── services/
│       │   ├── ai-router.ts                       # Intelligent channel selection & failover dispatching
│       │   └── ai-audit.ts                        # Request audit logging & payload sanitization
│       └── routes/
│           ├── ai.ts                              # /api/ai endpoints powered by ai-router & ai-audit
│           └── admin/                             # Modular admin routers (<400 lines each)
│               ├── index.ts                       # Admin router aggregator
│               ├── channels.ts                    # /api/admin/channels endpoints
│               ├── assets.ts                      # /api/admin/assets endpoints (with fs.unlinkSync)
│               ├── projects.ts                    # /api/admin/projects endpoints
│               ├── audit-logs.ts                  # /api/admin/audit-logs endpoints
│               ├── users.ts                       # /api/admin/users endpoints
│               └── stats.ts                       # /api/admin/stats endpoints
├── web/
│   └── src/
│       ├── lib/app-theme.ts                       # Ant Design Theme Tokens (Alias & Component tokens)
│       ├── services/api/
│       │   ├── admin.ts                           # Re-exports domain admin clients
│       │   ├── admin-channels.ts                  # Channel pool API calls
│       │   ├── admin-assets.ts                    # Asset management API calls
│       │   ├── admin-projects.ts                  # Project management API calls
│       │   └── admin-logs.ts                      # Audit logs API calls
│       └── pages/admin/                           # Modular admin dashboard views (<400 lines per file)
│           ├── index.tsx                          # Admin page shell with tabs (token-driven)
│           ├── overview/                          # System overview & stats grid
│           ├── channels/                          # Multi-channel pool UI
│           │   ├── index.tsx
│           │   ├── components/channel-table.tsx
│           │   ├── components/channel-modal.tsx
│           │   ├── components/model-tag-editor.tsx
│           │   ├── components/model-fetch-modal.tsx
│           │   └── use-admin-channels.ts
│           ├── assets/                            # Asset management console
│           │   ├── index.tsx
│           │   ├── components/asset-table.tsx
│           │   ├── components/asset-stats-card.tsx
│           │   ├── components/asset-batch-modal.tsx
│           │   └── use-admin-assets.ts
│           ├── projects/                          # Project management console
│           │   ├── index.tsx
│           │   ├── components/project-table.tsx
│           │   ├── components/project-reset-modal.tsx
│           │   └── use-admin-projects.ts
│           ├── logs/                              # AI request audit logs console
│           │   ├── index.tsx
│           │   ├── components/audit-log-table.tsx
│           │   ├── components/audit-log-filter-bar.tsx
│           │   ├── components/audit-log-drawer.tsx
│           │   └── use-admin-logs.ts
│           └── users/                             # User management views
│               ├── index.tsx
│               ├── components/admin-user-table.tsx
│               └── components/admin-user-modal.tsx
└── tests/
    └── e2e/                                       # End-to-end acceptance tests
```
