# Security Controls

Smart Guide applies defense-in-depth across HTTP transport, authentication, content rendering, file uploads, API keys, and optional outbound tunneling.

---

## 1. HTTP Headers, CORS & Rate Limiting (`sg-api/src/server.ts`)

- **Security Headers (`@fastify/helmet`):** Enforces Content Security Policy (`objectSrc: 'none'`, `frameAncestors: 'none'`) and safe resource policies.
- **Strict CORS Allowlist:** Only origins listed in `CORS_ORIGINS` are permitted with `credentials: true`. Wildcard `*` origins are rejected in production configuration.
- **Tiered Rate Limiting (`@fastify/rate-limit`):** Applies distinct rate-limit windows for general API traffic, authentication endpoints (`/api/auth/*`, `/api/v1/auth/mobile/*`), and external API integrations (`/api/v1/ext/*`).

---

## 2. Stored XSS & PDF Injection Prevention

- **Server-Side Sanitization (`sg-api/src/security/html-sanitizer.ts`):** All rich-text fields (`trainings.description`, `training_steps.content`) are sanitized with `sanitize-html` using a strict tag allowlist (`p`, `br`, `b`, `strong`, `i`, `em`, `u`, `h1`, `h2`, `h3`, `ul`, `ol`, `li`), zero permitted HTML attributes, and zero URI schemes (`allowedAttributes: {}`, `allowedSchemes: []`).
- **Client-Side Defense (`sg-web`):** `RichTextEditor` and `RichTextViewer` sanitize HTML before rendering; `pdf.service.ts` escapes all interpolated text (`title`, `step.title`, attachment names, dates) and sanitizes rich-text blocks before generating print/PDF HTML.

---

## 3. Media Upload Hardening (`sg-api/src/security/file-validator.ts`)

Client-supplied `Content-Type` headers and filenames are never trusted on their own:

- **Magic-Byte Inspection:** Uploaded buffers are inspected with `file-type` (`fileTypeFromBuffer`) and cross-checked against the file extension.
- **Strict Allowlist:**
  - **Images:** `jpg`/`jpeg`, `png`, `webp`, `gif`, `avif`
  - **Videos:** `mp4`, `webm`, `mov`, `mkv`
- **Active Content Rejection:** Files starting with `<svg`, `<?xml`, `<!doctype`, `<html`, or `<script` (including `.svg` uploads) are explicitly rejected to eliminate SVG-based XSS vectors.
- **Filename & Key Normalization:** Filenames are stripped of path segments and unsafe characters (`sanitizeFileName`), and objects are stored under UUID-prefixed keys.
- **Private Media Delivery:** With `STORAGE_PUBLIC_MEDIA=false`, media endpoints require an authenticated session or a short-lived HMAC token.

---

## 4. API Keys & External Integrations (`sg-api/src/security/api-key.ts`)

- **Key Format:** Generated with Node's `crypto.randomBytes` using the `sgk_live_` prefix.
- **Zero Plaintext Persistence:** Only a display prefix (`key_prefix`) and a **SHA-256** digest (`key_hash`) are stored in PostgreSQL; the full key is displayed once upon creation.
- **Constant-Time Verification:** Incoming keys are verified using `crypto.timingSafeEqual` against the stored digest.
- **Header-Only Transport:** Keys are accepted only via `x-api-key` or `Authorization: Bearer <key>` headers (never via URL query parameters like `?api_key=`, preventing leaks in reverse-proxy logs and browser history).
- **Least-Privilege Scopes:** Every key is restricted to explicit scopes (`users:read`, `users:write`, `trainings:read`).

---

## 5. Mobile OAuth Deep-Link Allowlist

`sg-api/src/auth/mobile-oauth.ts` validates mobile OAuth redirect targets against `MOBILE_APP_SCHEME` (default `smartguide://`) and uses single-use, short-lived exchange codes (`POST /api/v1/auth/mobile/exchange`), preventing open-redirect token theft.

---

## 6. Outbound Tunnel Client Isolation (`sg-api/src/tunnel/client.ts`)

When opted into via `SG_LICENSE_KEY` + `SG_CLOUD_RELAY_URL`, the outbound tunnel client forwards requests strictly in-process via Fastify's `app.inject()` and enforces an explicit route whitelist (`/health`, `/api/auth/*`, `/api/v1/*`). It cannot execute shell commands, access arbitrary local files, or expose PostgreSQL ports.
