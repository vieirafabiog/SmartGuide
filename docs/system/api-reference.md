# REST & External API Reference

`sg-api` exposes a versioned REST API under `/api/v1/*`, Better Auth endpoints under `/api/auth/*`, health diagnostics at `/health`, and interactive OpenAPI 3 documentation (Swagger UI) at `/docs`.

---

## Conventions

- **Base URL:** `http://localhost:3000` (configured via `API_PUBLIC_URL`)
- **Authentication (Internal API):** Better Auth session cookie or `Authorization: Bearer <session-token>`
- **Authentication (External API):** `x-api-key: sgk_live_...` or `Authorization: Bearer sgk_live_...`
- **Standard Error Payload:**

```json
{
  "errorCode": "VALIDATION_ERROR",
  "message": "Human-readable error description",
  "details": {}
}
```

Common `errorCode` values mapped by `sg-web` (`src/i18n/errorMapper.ts`): `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_ERROR`, `CONFLICT`, `RATE_LIMITED`, `INTERNAL_ERROR`.

---

## Health & Instance

| Method | Path | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/health` | Public | Returns service, database, and storage connector health status. |
| `GET` | `/api/v1/instance/info` | Public | Returns `instance_uuid`, `site_name`, `logo_url`, `default_locale`, `allow_public_signup`, and enabled OAuth providers. |
| `PATCH` | `/api/v1/instance/settings` | `admin` | Updates `site_name`, `logo_url`, `default_locale`, and `allow_public_signup`. |

---

## Authentication (`/api/auth/*` & `/api/v1/auth/mobile/*`)

| Method | Path | Auth | Description |
| :--- | :--- | :--- | :--- |
| `*` | `/api/auth/*` | Public / Session | Better Auth endpoints (email/password sign-in, sign-up, Google/Microsoft OAuth, session, sign-out). |
| `GET` | `/api/v1/auth/mobile/start` | Public | Initiates mobile OAuth flow with `MOBILE_APP_SCHEME` validation. |
| `GET` | `/api/v1/auth/mobile/finish` | Session | Issues single-use exchange code and redirects to app deep link. |
| `POST` | `/api/v1/auth/mobile/exchange` | Public | Exchanges one-time code for `{ token, user }`. |

---

## Trainings, Steps, Attachments & Progress

| Method | Path | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/trainings` | Session | List trainings (`catalog` or `manage` scope, search, status/category filters). |
| `GET` | `/api/v1/trainings/:id` | Session | Get training details (enforces visibility & permission ACL). |
| `POST` | `/api/v1/trainings` | `admin` / `creator` | Create a new training (`draft` by default). |
| `PATCH` | `/api/v1/trainings/:id` | `owner` / `editor` / `admin` | Update training details, status, categories, or cover URL. |
| `DELETE` | `/api/v1/trainings/:id` | `owner` / `admin` | Delete training and cascade steps/attachments/permissions. |
| `GET` | `/api/v1/trainings/:id/steps` | Session | List ordered steps and attachments for a training. |
| `POST` | `/api/v1/trainings/:id/steps` | `owner` / `editor` / `admin` | Create a new step with sanitized HTML content. |
| `PUT` | `/api/v1/trainings/:id/steps/reorder` | `owner` / `editor` / `admin` | Persist new `stepIds` ordering in PostgreSQL. |
| `PATCH` | `/api/v1/steps/:stepId` | `owner` / `editor` / `admin` | Update step title or content. |
| `DELETE` | `/api/v1/steps/:stepId` | `owner` / `editor` / `admin` | Delete a step. |
| `GET` | `/api/v1/steps/:stepId/attachments` | Session | List attachments for a step. |
| `POST` | `/api/v1/steps/:stepId/attachments` | `owner` / `editor` / `admin` | Attach uploaded media metadata to a step. |
| `PUT` | `/api/v1/steps/:stepId/attachments/reorder` | `owner` / `editor` / `admin` | Persist new `attachmentIds` ordering. |
| `PATCH` | `/api/v1/attachments/:attachmentId` | `owner` / `editor` / `admin` | Update attachment metadata. |
| `DELETE` | `/api/v1/attachments/:attachmentId` | `owner` / `editor` / `admin` | Remove attachment record and stored object. |
| `GET` | `/api/v1/trainings/:id/progress` | Session | Get current user's completion summary for a training. |
| `PUT` | `/api/v1/trainings/:id/steps/:stepId/progress` | Session | Mark a step completed or incomplete for the current user. |

---

## Permissions & Categories

| Method | Path | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/trainings/:id/permissions` | `owner` / `admin` | List collaborators and their access levels (`owner`, `editor`, `viewer`). |
| `POST` | `/api/v1/trainings/:id/permissions` | `owner` / `admin` | Grant or update collaborator access. |
| `PATCH` | `/api/v1/trainings/:id/permissions/:userId` | `owner` / `admin` | Update collaborator permission level. |
| `DELETE` | `/api/v1/trainings/:id/permissions/:userId` | `owner` / `admin` | Revoke collaborator access (creator is protected). |
| `GET` | `/api/v1/categories` | Session | List all training categories. |
| `POST` | `/api/v1/categories` | `admin` | Create a category. |
| `PATCH` | `/api/v1/categories/:id` | `admin` | Update category name, color, or icon. |
| `DELETE` | `/api/v1/categories/:id` | `admin` | Delete a category. |

---

## Media Upload & Streaming

| Method | Path | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/media/upload` | `admin` / `creator` | Multipart upload (`bucket`: `training-covers`, `step-attachments`, `instance-assets`). Validates magic bytes and size limits. |
| `GET` | `/api/v1/media/:bucket/*` | Session or `?sig=&exp=` | Stream media object with `Accept-Ranges` / `206 Partial Content` support. |

---

## Users, Admin Stats & API Keys

| Method | Path | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/users/search` | Session | Search active users by name or email (used for training sharing). |
| `GET` | `/api/v1/users` | `admin` | List all users. |
| `POST` | `/api/v1/users` | `admin` | Provision a user account with role and locale. |
| `PATCH` | `/api/v1/users/:id` | `admin` (or self for locale/name) | Update user role, `isActive`, name, or `preferredLocale`. |
| `DELETE` | `/api/v1/users/:id` | `admin` | Delete user account. |
| `GET` | `/api/v1/admin/stats` | `admin` | Instance metrics (users, trainings, steps, completions). |
| `GET` | `/api/v1/api-keys` | `admin` | List provisioned API keys (prefix, scopes, last used timestamp). |
| `POST` | `/api/v1/api-keys` | `admin` | Create a scoped API key (returns plaintext key once). |
| `PATCH` | `/api/v1/api-keys/:id` | `admin` | Toggle `isActive` or update name/scopes. |
| `DELETE` | `/api/v1/api-keys/:id` | `admin` | Revoke/delete an API key. |

---

## External Integration API (`/api/v1/ext/*`)

Authenticated with `x-api-key` or `Authorization: Bearer <api-key>`.

| Method | Path | Required Scope | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/ext/users` | `users:read` | List users for HR/ERP directory sync. |
| `POST` | `/api/v1/ext/users` | `users:write` | Provision a new user externally. |
| `PATCH` | `/api/v1/ext/users/:id` | `users:write` | Update user profile, role, or active status. |
| `GET` | `/api/v1/ext/trainings` | `trainings:read` | List published trainings and metadata. |
