# Project: Infinite Canvas Full-Stack Enhancement

## Architecture
A full-stack infinite canvas creative platform with a lightweight Node.js/TypeScript Express backend, SQLite local database (`better-sqlite3`), JWT authentication, first-time setup wizard, Ant Design-based admin dashboard, secure server-side AI proxy, cloud canvas project & asset persistence, and seamless React/Vite frontend integration.

```
+-------------------------------------------------------------------------------+
|                               Browser Client                                  |
|         (React 19 + Vite 7 + React Router 7 + Ant Design 6 + Zustand 5)       |
|                                                                               |
|  - Setup Wizard (/setup)          - Admin Dashboard (/admin)                  |
|  - Login (/login)                 - Canvas Workspace (/canvas/:id)            |
|  - User Profile Dropdown          - Cloud Project Switcher / Saver            |
+-------------------------------------------------------------------------------+
                                      |
                 HTTP REST / SSE      | Bearer JWT (Vite dev proxy / Single port)
                                      v
+-------------------------------------------------------------------------------+
|                     Express Backend Service (Node.js / TS)                    |
|                                                                               |
|  +--------------------+  +--------------------+  +-------------------------+  |
|  | /api/setup & /auth |  |     /api/admin     |  |         /api/ai         |  |
|  |  - First admin init|  |  - Users CRUD      |  |  - Server key injection |  |
|  |  - JWT Login/Me    |  |  - AI settings     |  |  - Image generation     |  |
|  |  - Password hash   |  |  - System stats    |  |  - Chat/Agent SSE proxy |  |
|  +--------------------+  +--------------------+  +-------------------------+  |
|  +--------------------+  +-------------------------------------------------+  |
|  |   /api/projects    |  |          /api/assets & /uploads (Static)        |  |
|  |  - Cloud JSON CRUD |  |  - Multer upload, MIME check, disk storage      |  |
|  +--------------------+  +-------------------------------------------------+  |
+-------------------------------------------------------------------------------+
           |                                                      |
           v                                                      v
+-----------------------------+                         +-------------------+
|  SQLite DB (data/canvas.db) |                         |  Upstream OpenAI  |
|  users, settings, projects  |                         |  Compatible API   |
+-----------------------------+                         +-------------------+
```

## Feature Inventory
| # | Feature ID | Feature Name | Description | Milestone | Source |
|---|------------|--------------|-------------|-----------|--------|
| 1 | FEAT-AUTH-01 | Setup Status Check | Check if system has initial admin registered | M1 | survey |
| 2 | FEAT-AUTH-02 | First-Time Admin Setup | Create initial super admin and initialize system | M1 | survey |
| 3 | FEAT-AUTH-03 | User Login | Authenticate user with username/password, issue JWT | M1 | survey |
| 4 | FEAT-AUTH-04 | Current Session Profile | Get logged-in user profile & verify token | M1 | survey |
| 5 | FEAT-AUTH-05 | User Logout | Invalidate client session and redirect to login | M1 | survey |
| 6 | FEAT-AUTH-06 | Frontend Route Guards | Protect canvas, admin, setup, and auth routes | M1 | survey |
| 7 | FEAT-UI-01 | Login & Setup Pages | React UI for `/login` and `/setup` | M1 | survey |
| 8 | FEAT-ADMIN-01 | Admin Dashboard Page | Dedicated Ant Design admin portal layout (`/admin`) | M2 | survey |
| 9 | FEAT-ADMIN-02 | User List & Query | List all users with pagination and search | M2 | survey |
| 10 | FEAT-ADMIN-03 | Admin Create User | Admin creates new user with role and password | M2 | survey |
| 11 | FEAT-ADMIN-04 | Toggle User Status | Enable or disable user account | M2 | survey |
| 12 | FEAT-ADMIN-05 | Reset User Password | Admin sets new password for target user | M2 | survey |
| 13 | FEAT-ADMIN-06 | Delete User | Permanently remove user and cascade data | M2 | survey |
| 14 | FEAT-ADMIN-07 | Get AI Config | Fetch system AI provider settings with masked key | M2 | survey |
| 15 | FEAT-ADMIN-08 | Update AI Config | Save upstream Base URL, API Key, and model list | M2 | survey |
| 16 | FEAT-ADMIN-09 | Test AI Connectivity | Test connection to upstream OpenAI-compatible API | M2 | survey |
| 17 | FEAT-ADMIN-10 | System Stats Overview | Aggregated metrics for users, projects, assets | M2 | survey |
| 18 | FEAT-PROXY-01 | Image Generation Proxy | Securely forward image generation requests upstream | M3 | survey |
| 19 | FEAT-PROXY-02 | Image Edit Proxy | Securely forward inpainting/editing requests | M3 | survey |
| 20 | FEAT-PROXY-03 | Chat & Agent Proxy | Securely forward chat/agent completions (SSE stream) | M3 | survey |
| 21 | FEAT-PROXY-04 | Zero Key Leak Isolation | Prevent exposing admin API key to browser clients | M3 | survey |
| 22 | FEAT-PROJ-01 | List User Projects | Retrieve all canvas projects belonging to user | M4 | survey |
| 23 | FEAT-PROJ-02 | Create Project | Create new cloud canvas project record | M4 | survey |
| 24 | FEAT-PROJ-03 | Load Project Detail | Retrieve full canvas node graph & state | M4 | survey |
| 25 | FEAT-PROJ-04 | Update Project State | Save canvas node graph, connections, viewport | M4 | survey |
| 26 | FEAT-PROJ-05 | Delete Project | Remove user canvas project | M4 | survey |
| 27 | FEAT-ASSET-01 | Upload Asset File | Upload image/asset to `/uploads` on disk | M4 | survey |
| 28 | FEAT-ASSET-02 | Static Asset Serving | Serve uploaded files via `/uploads/...` with MIME check | M4 | survey |
| 29 | FEAT-ASSET-03 | List & Delete Assets | Manage user uploaded and generated assets | M4 | survey |
| 30 | FEAT-UI-02 | Canvas Header Profile | Profile dropdown in `AppTopNav` & canvas header | M5 | survey |
| 31 | FEAT-UI-03 | Cloud Sync Integration | Cloud project switcher/saver integrated into canvas | M5 | survey |
| 32 | FEAT-UI-04 | AI Service Routing | Direct all generation tools to `/api/ai/*` proxy | M5 | survey |
| 33 | FEAT-TEST-01 | E2E Test Suite | Automated end-to-end acceptance tests (Tiers 1-4) | E2E | survey |
| 34 | FEAT-VERIF-01 | Acceptance & Hardening | 100% E2E verification + Tier 5 adversarial tests | M6 | survey |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| E2E | E2E Testing Suite | Automated test runner, test harness, Tiers 1-4 test cases -> `TEST_READY.md` | none | DONE |
| M1 | Setup Wizard & Auth System | Backend scaffolding, SQLite DB, `/api/setup/*`, `/api/auth/*`, bcrypt, JWT, `/setup`, `/login`, route guards | none | DONE |
| M2 | Admin Management Dashboard | `/admin` UI, `/api/admin/users/*`, `/api/admin/settings/ai/*`, `/api/admin/stats` | M1 | DONE |
| M3 | Secure AI Proxy | `/api/ai/models`, `/api/ai/images/*`, `/api/ai/chat/completions` (SSE), server key injection | M1, M2 | IN_PROGRESS |
| M4 | Cloud Persistence & Assets | `/api/projects/*`, `/api/assets/*`, `/uploads/*` static serving | M1 | PLANNED |
| M5 | Seamless Frontend Integration | Header user profile dropdown, cloud project saver/switcher, AI service routing, canvas regression check | M1, M2, M3, M4 | PLANNED |
| M6 | Final Verification & Hardening | Pass 100% of E2E test suite (Tiers 1-4) + Tier 5 adversarial hardening | M5, E2E | PLANNED |

## Interface Contracts

### 1. Setup & Authentication
- `GET /api/setup/status` -> `{ initialized: boolean, requiresSetup: boolean }`
- `POST /api/setup` -> Body: `{ username, password, displayName? }` -> Response `201 Created`: `{ success: true, token: string, user: UserDto }` (or `403 ALREADY_INITIALIZED`)
- `POST /api/auth/login` -> Body: `{ username, password }` -> Response `200 OK`: `{ token: string, user: UserDto }` (or `401 / 403 ACCOUNT_DISABLED`)
- `GET /api/auth/me` -> Headers: `Authorization: Bearer <token>` -> Response `200 OK`: `{ user: UserDto }`
- `POST /api/auth/logout` -> Response `200 OK`: `{ success: true }`

### 2. Admin Management (`Authorization: Bearer <admin_token>`)
- `GET /api/admin/users?page=1&limit=50&search=` -> `{ users: UserListItem[], total: number }`
- `POST /api/admin/users` -> Body: `{ username, password, role, displayName? }` -> `201 Created`: `{ user: UserListItem }`
- `PATCH /api/admin/users/:id/status` -> Body: `{ status: "active" | "disabled" }` -> `200 OK`: `{ user: UserListItem }`
- `POST /api/admin/users/:id/reset-password` -> Body: `{ newPassword: string }` -> `200 OK`: `{ success: true }`
- `DELETE /api/admin/users/:id` -> `200 OK`: `{ success: true }`
- `GET /api/admin/ai-config` -> `200 OK`: `{ baseUrl: string, apiKeyMasked: string, hasKey: boolean, imageModels: string[], defaultModel: string, chatModels: string[] }`
- `PUT /api/admin/ai-config` -> Body: `{ baseUrl, apiKey?, imageModels, defaultModel, chatModels? }` -> `200 OK`: `{ success: true }`
- `POST /api/admin/ai-config/test` -> Body: `{ baseUrl?, apiKey? }` -> `200 OK`: `{ success: boolean, latencyMs: number, message?: string }`
- `GET /api/admin/stats` -> `200 OK`: `{ userCount: number, activeUserCount: number, projectCount: number, assetCount: number, storageBytes: number }`

### 3. Secure AI Proxy (`Authorization: Bearer <user_token>`)
- `GET /api/ai/models` -> `200 OK`: `{ imageModels: string[], defaultImageModel: string, chatModels: string[] }`
- `POST /api/ai/images/generations` -> Body: `{ prompt, model?, size?, quality?, n? }` -> `200 OK`: `{ created: number, data: [{ url?: string, b64_json?: string }] }`
- `POST /api/ai/images/edits` -> FormData: `prompt, image, mask?, model?, size?` -> `200 OK`: `{ created: number, data: [...] }`
- `POST /api/ai/chat/completions` -> Body: `{ messages, model, stream?: boolean }` -> `200 OK` JSON or `text/event-stream` chunks

### 4. Cloud Projects & Assets (`Authorization: Bearer <user_token>`)
- `GET /api/projects` -> `200 OK`: `{ projects: Array<{ id: string, name: string, thumbnail?: string, createdAt: string, updatedAt: string }> }`
- `POST /api/projects` -> Body: `{ name: string, canvasData: object, thumbnail?: string }` -> `201 Created`: `{ project: ProjectDetailDto }`
- `GET /api/projects/:id` -> `200 OK`: `{ project: ProjectDetailDto }`
- `PUT /api/projects/:id` -> Body: `{ name?: string, canvasData?: object, thumbnail?: string }` -> `200 OK`: `{ project: ProjectDetailDto }`
- `DELETE /api/projects/:id` -> `200 OK`: `{ success: true }`
- `POST /api/upload` -> FormData: `file` -> `201 Created`: `{ id: string, url: string, filename: string, mimeType: string, sizeBytes: number }`
- `GET /uploads/:filename` -> Static asset binary with correct `Content-Type`

## Code Layout
```
/home/dual/Projects/canvas/
├── package.json                          # Root workspace package.json (dev, build, start scripts)
├── server/                               # Express + TypeScript backend
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                      # Server entry & static route mounting
│       ├── config.ts                     # Environment & runtime constants
│       ├── db.ts                         # SQLite setup (data/canvas.db) & schema migrations
│       ├── middleware/
│       │   ├── auth.ts                   # JWT authentication & admin authorization
│       │   ├── upload.ts                 # Multer disk storage & MIME validation
│       │   └── error-handler.ts          # Standard JSON error responses
│       └── routes/
│           ├── setup.ts                  # /api/setup endpoints
│           ├── auth.ts                   # /api/auth endpoints
│           ├── admin.ts                  # /api/admin endpoints
│           ├── ai.ts                     # /api/ai secure proxy endpoints
│           ├── projects.ts               # /api/projects endpoints
│           └── assets.ts                 # /api/upload & /api/assets endpoints
├── web/                                  # Vite + React 19 Frontend SPA
│   ├── package.json
│   ├── vite.config.ts                    # Configured with /api & /uploads proxy to backend
│   └── src/
│       ├── router.tsx                    # Routes: /setup, /login, /admin, Canvas with guards
│       ├── services/api/
│       │   ├── client.ts                 # Axios instance with Bearer JWT interceptor
│       │   ├── auth.ts                   # Auth & setup API services
│       │   ├── admin.ts                  # Admin dashboard API services
│       │   ├── ai-proxy.ts               # Secure AI proxy API services
│       │   └── cloud-projects.ts         # Cloud projects & asset upload services
│       ├── stores/
│       │   ├── use-user-store.ts         # User session & auth state store
│       │   └── canvas/                   # Canvas state store
│       ├── pages/
│       │   ├── setup/                    # /setup First-time wizard page
│       │   ├── login/                    # /login Authentication page
│       │   └── admin/                    # /admin Ant Design management dashboard
│       │       ├── index.tsx
│       │       ├── components/           # AdminOverviewCard, AdminUserTable, AdminAiConfigPanel
│       │       └── hooks/                # useAdminData
│       └── components/
│           ├── layout/
│           │   ├── user-status-actions.tsx
│           │   └── user-profile-dropdown.tsx  # User info, logout, admin link
│           └── canvas/
│               ├── canvas-top-bar.tsx
│               └── cloud-project-modal.tsx    # Cloud project switcher / saver
├── data/                                 # Persistent runtime data
│   ├── canvas.db                         # SQLite database file
│   └── uploads/                          # Local asset upload directory
└── tests/                                # Test suites
    └── e2e/                              # E2E test runner and test tiers
```
