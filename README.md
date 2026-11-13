<div align="center">

# Smart Guide

Self-hosted platform for step-by-step corporate trainings, visual SOPs, and guided onboarding.

[![License: MIT](https://img.shields.io/badge/License-MIT-F39C12.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Expo](https://img.shields.io/badge/Expo-SDK%2057-000020?logo=expo&logoColor=white)](https://expo.dev/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](https://docs.docker.com/compose/)
[![i18n](https://img.shields.io/badge/i18n-pt--BR%20%7C%20en%20%7C%20es-2C3E50)](./sg-web/src/i18n/locales)

</div>

---

## What It Is

Smart Guide is a single-tenant, self-hosted training and documentation system composed of:

- **`sg-api`** — Node.js 22 + Fastify 5 REST API, Drizzle ORM + PostgreSQL 17 (`pg_trgm` trigram search), Better Auth, pluggable storage connectors (`local`, `s3`, `azure`), and self-hosted Swagger UI.
- **`sg-web`** — Universal client built with Expo SDK 57 (Expo Router) targeting Web (static bundle served by Nginx 1.27), iOS, and Android, with offline training/media download, PDF export, and QR Code server pairing.

---

## Core Capabilities

- **Structured Trainings & Step Ordering:** Rich-text descriptions and steps sanitized on both client and server (`sanitize-html`), image/video attachments, and transactional step/attachment reordering.
- **Role-Based Access Control (RBAC):** `admin`, `creator`, and `user` roles plus per-training sharing permissions (`owner`, `editor`, `viewer`).
- **Pluggable Media Storage (BYOS):** Switch between Local Disk, S3-compatible object storage (AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces), or Azure Blob Storage via `.env` without code changes. Supports HTTP `Range` (`206 Partial Content`) for video seeking.
- **Enterprise & Social SSO:** Email/password, Google OAuth, and Microsoft Entra ID via Better Auth, plus a deep-link OAuth bridge (`smartguide://auth-callback`) for native mobile apps.
- **Offline & Print-Ready PDF:** Authenticated offline bundle download on mobile and sanitized HTML-to-PDF manual generation.
- **External Integration API:** Scoped machine-to-machine endpoints (`/api/v1/ext/*`) authenticated via `x-api-key` (`SHA-256` hashed keys, `timingSafeEqual` verification).
- **Multilingual (`i18n`):** Complete UI, API error code mapping, PDF labels, and user guides in `pt-BR`, `en`, and `es`.

---

## Architecture

```mermaid
flowchart LR
    subgraph Clients["Clients (sg-web)"]
        Web["Web Browser (Expo Web / Nginx)"]
        Mobile["iOS & Android (Expo / BYOS QR)"]
        Ext["External Systems (ERP / HR)"]
    end

    subgraph API["sg-api (Node 22 + Fastify 5)"]
        Auth["Better Auth + RBAC Guards"]
        Core["Trainings, Steps, Attachments, Progress, Users"]
        ExtAPI["External API (/api/v1/ext/*)"]
        Storage["StorageConnector (local | s3 | azure)"]
    end

    subgraph Data["Persistence"]
        PG[("PostgreSQL 17\n(Drizzle ORM + pg_trgm)")]
        Disk[("Local / S3 / Azure")]
    end

    Web -->|/api & /docs| API
    Mobile -->|HTTPS / Bearer| API
    Ext -->|x-api-key| ExtAPI
    API --> PG
    Storage --> Disk
```

---

## Quickstart (Docker Compose)

### 1. Create `.env`

```bash
cp .env.example .env
```

Generate a 32-byte secret for Better Auth:

```bash
openssl rand -hex 32
```

Set at least these variables in `.env`:

```env
POSTGRES_PASSWORD=strong_db_password_here
DATABASE_URL=postgresql://smart_guide:strong_db_password_here@postgres:5432/smart_guide
BETTER_AUTH_SECRET=<64_hex_chars_from_openssl>
SEED_ADMIN_EMAIL=admin@yourdomain.com
SEED_ADMIN_PASSWORD=strong_initial_admin_password
```

### 2. Start the stack

```bash
docker compose up -d --build
```

To include a local **MinIO** S3-compatible container:

```bash
docker compose --profile s3 up -d --build
```

### 3. Verify

- **Web App:** `http://localhost:8080`
- **Swagger UI:** `http://localhost:8080/docs`
- **Healthcheck:** `http://localhost:8080/health`

On startup, `sg-api` acquires a PostgreSQL advisory lock (`pg_advisory_lock`), runs pending Drizzle migrations, and seeds the initial `admin` account only if no admin exists yet.

---

## Configuration Reference

All configuration lives in `.env` (see [`.env.example`](./.env.example) for the full template), validated at startup with Zod.

### Core & Auth

| Variable | Default | Notes |
| :--- | :--- | :--- |
| `API_PORT` / `WEB_PORT` | `3000` / `8080` | Host ports exposed by Docker Compose |
| `API_PUBLIC_URL` / `WEB_PUBLIC_URL` | `http://localhost:3000` / `8080` | Public URLs used for links and OAuth callbacks |
| `CORS_ORIGINS` | `http://localhost:8080,...` | Comma-separated browser origins (never `*` in production) |
| `BETTER_AUTH_SECRET` | — | Required in production; minimum 32 random bytes |
| `BETTER_AUTH_URL` | `http://localhost:3000` | Base URL seen by Better Auth |
| `AUTH_ALLOW_EMAIL_PASSWORD` | `true` | Enable/disable email + password login |
| `AUTH_ALLOW_PUBLIC_SIGNUP` | `false` | Allow self-registration or restrict to admin-created users |
| `GOOGLE_CLIENT_ID` / `SECRET` | empty | Enables Google OAuth when both are set |
| `MICROSOFT_CLIENT_ID` / `SECRET` / `TENANT_ID` | empty / `common` | Enables Microsoft Entra ID OAuth when set |
| `MOBILE_APP_SCHEME` | `smartguide` | Deep-link scheme allowlist for mobile OAuth |

### Storage Drivers (`STORAGE_DRIVER`)

| Driver | Required Variables | Notes |
| :--- | :--- | :--- |
| `local` (default) | `LOCAL_STORAGE_PATH` | Inside Docker, mapped to `/app/uploads` volume |
| `s3` | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | Works with AWS S3, MinIO (`S3_FORCE_PATH_STYLE=true`), Cloudflare R2, DigitalOcean Spaces |
| `azure` | `AZURE_STORAGE_CONNECTION_STRING` (or `ACCOUNT_NAME` + `ACCOUNT_KEY`), `AZURE_STORAGE_CONTAINER` | Uses `@azure/storage-blob` |

Media limits and access control:
- `STORAGE_MAX_IMAGE_MB=10`, `STORAGE_MAX_VIDEO_MB=150`
- `STORAGE_PUBLIC_MEDIA=false` — When `false`, media endpoints require a valid session or short-lived HMAC-signed query token.

---

## External Integration API

Create scoped API keys in **Admin -> API Keys** (`users:read`, `users:write`, `trainings:read`). Keys are shown once on creation and stored as `SHA-256` hashes.

Query-string authentication (`?api_key=`) is rejected. Always pass `x-api-key`:

```bash
curl -sS https://your-domain.com/api/v1/ext/trainings \
  -H "x-api-key: sg_live_your_key_here"
```

Full OpenAPI specification is served self-hosted at `/docs` (no external CDN dependencies).

---

## Security Controls

- **Upload Validation:** Server-side magic-byte inspection (`file-type`) + extension allowlist. `.svg`, HTML, and executables are rejected; responses include `X-Content-Type-Options: nosniff`.
- **XSS & PDF Injection Prevention:** Rich-text content is sanitized with a strict tag/attribute allowlist before persistence, rendering, and PDF generation.
- **Session & Role Derivation:** `userId` and `role` are always derived from the verified Better Auth session on the server, never from request payloads.
- **Mobile OAuth Open-Redirect Guard:** `redirect_uri` is validated against `MOBILE_APP_SCHEME` (`smartguide://...`), with single-use 60-second exchange codes.
- **Optional Outbound Tunnel:** Disabled by default. Activates only when both `SG_LICENSE_KEY` and `SG_CLOUD_RELAY_URL` are explicitly configured, forwarding only `/api/*`, `/health`, and `/docs*`.

---

## Local Development

### Backend (`sg-api`)

```bash
cd sg-api
npm install
npm run dev
```

Verification suite:

```bash
cd sg-api
npm test && npm run lint && npx tsc --noEmit
```

### Frontend (`sg-web`)

```bash
cd sg-web
npm install
npx expo start --web
```

Verification suite:

```bash
cd sg-web
npx tsc --noEmit && npx expo lint && npx expo export --platform web
```

---

## Backup & Restore

Scripts in `docker/scripts/` operate against the running `postgres` container:

```bash
# Create compressed backup in ./backups/ (14-day default retention)
./docker/scripts/backup-postgres.sh

# Restore from backup
./docker/scripts/restore-postgres.sh ./backups/smart-guide-smart_guide-YYYYMMDDTHHMMSSZ.sql.gz
```

Pass `--yes` as the second argument to `restore-postgres.sh` for non-interactive automation.

---

## Documentation

### Guides (`pt-BR`, `en`, `es`)

| Language | Getting Started | Admin | Creator | Learner & Mobile |
| :--- | :--- | :--- | :--- | :--- |
| **Português (BR)** | [getting-started.md](./docs/guides/pt-BR/getting-started.md) | [admin-guide.md](./docs/guides/pt-BR/admin-guide.md) | [creator-guide.md](./docs/guides/pt-BR/creator-guide.md) | [learner-mobile-guide.md](./docs/guides/pt-BR/learner-mobile-guide.md) |
| **English** | [getting-started.md](./docs/guides/en/getting-started.md) | [admin-guide.md](./docs/guides/en/admin-guide.md) | [creator-guide.md](./docs/guides/en/creator-guide.md) | [learner-mobile-guide.md](./docs/guides/en/learner-mobile-guide.md) |
| **Español** | [getting-started.md](./docs/guides/es/getting-started.md) | [admin-guide.md](./docs/guides/es/admin-guide.md) | [creator-guide.md](./docs/guides/es/creator-guide.md) | [learner-mobile-guide.md](./docs/guides/es/learner-mobile-guide.md) |

### System Reference

- [System Architecture](./docs/system/architecture.md)
- [Database Schema & ER Diagram](./docs/system/database-schema.md)
- [Authentication & Authorization](./docs/system/authentication.md)
- [Storage Connectors (`local`, `s3`, `azure`)](./docs/system/storage-connectors.md)
- [Security Controls](./docs/system/security.md)
- [REST & External API Reference](./docs/system/api-reference.md)

---

## License

MIT
