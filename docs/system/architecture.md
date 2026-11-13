# System Architecture

Smart Guide is designed as a modular, self-hosted monorepo separating the backend API (`sg-api`) from the universal frontend (`sg-web`).

## High-Level Architecture

```mermaid
flowchart LR
    subgraph Clients["Clients (sg-web)"]
        Web["Web Browser (Expo Web / SPA)"]
        Mobile["iOS & Android App (Expo)"]
        Ext["External Integrations (ERP / HR)"]
    end

    subgraph Backend["sg-api (Fastify + TypeScript)"]
        Auth["Better Auth + RBAC Guards"]
        Modules["Domain Modules\n(Trainings, Steps, Attachments,\nPermissions, Progress, Users, Admin)"]
        ExtAPI["External API (/api/v1/ext/*)"]
        Security["Security Layer\n(Helmet, CORS, Rate Limit,\nSanitizer, Magic-Byte Validator)"]
        Storage["StorageConnector Abstraction"]
        Tunnel["Optional Outbound Tunnel Client\n(Opt-in via SG_LICENSE_KEY)"]
    end

    subgraph Data["Persistence & Object Storage"]
        PG[("PostgreSQL 17\n(Drizzle ORM + pg_trgm)")]
        LocalDisk[("Local Filesystem")]
        S3[("S3-Compatible\n(AWS / MinIO / R2)")]
        Azure[("Azure Blob Storage")]
    end

    Web -->|HTTPS / Session Cookie| Auth
    Mobile -->|HTTPS / Bearer Token| Auth
    Ext -->|HTTPS / x-api-key| ExtAPI

    Auth --> Modules
    Modules --> Security
    ExtAPI --> Security
    Modules --> PG
    Auth --> PG
    Modules --> Storage

    Storage --> LocalDisk
    Storage --> S3
    Storage --> Azure

    Tunnel -.->|Whitelisted /api/* & /health| Modules
```

---

## Core Components

### 1. Backend (`sg-api`)

- **Framework:** Fastify 5 with TypeScript (`ESM`), Zod schema validation, and `@fastify/swagger` + `@fastify/swagger-ui` (`/docs`).
- **Database Layer:** PostgreSQL accessed via `pg` connection pool and **Drizzle ORM** (`sg-api/src/db/`). SQL migrations live in `sg-api/drizzle/`.
- **Authentication:** **Better Auth** (`sg-api/src/auth/auth.ts`) backed by PostgreSQL tables (`user`, `session`, `account`, `verification`), supporting Email/Password, Google OAuth, and Microsoft Entra ID.
- **Storage Connectors:** Pluggable `StorageConnector` interface (`sg-api/src/storage/types.ts`) supporting `local`, `s3`, and `azure` drivers with HTTP `Range` streaming (`206 Partial Content`) for video playback.
- **Security Pipeline:** Strict CORS allowlist, Helmet CSP headers, tiered rate limiting, server-side HTML sanitization (`sanitize-html`), file magic-byte validation (`file-type`), and SHA-256 hashed API keys.
- **Outbound Tunnel Client (Opt-in):** `sg-api/src/tunnel/client.ts` only starts when both `SG_LICENSE_KEY` and `SG_CLOUD_RELAY_URL` are explicitly configured. It strictly forwards whitelisted HTTP paths (`/health`, `/api/auth/*`, `/api/v1/*`) using Fastify's in-process `app.inject()` without exposing the host OS or database.

### 2. Universal Frontend (`sg-web`)

- **Framework:** Expo SDK + Expo Router (`src/app/`) targeting Web, iOS, and Android from a single codebase.
- **Authentication & State:** `AuthContext` manages session tokens/cookies and user roles (`admin`, `creator`, `user`), while `serverConfig.service.ts` supports BYOS (Bring Your Own Server) connection via URL or QR code on mobile.
- **Internationalization (`i18n`):** `i18next` + `react-i18next` with bundled translations for `pt-BR`, `en`, and `es` (`src/i18n/locales/*.json`), synchronized with user profile preferences (`preferred_locale`) and instance defaults (`default_locale`).
- **Offline & PDF:** `offline.service.ts` caches training metadata, steps, and media attachments on the device; `pdf.service.ts` generates sanitized, localized multi-page PDF documents.

---

## Request Lifecycle

```mermaid
sequenceDiagram
    participant C as Client (sg-web)
    participant F as Fastify Server (sg-api)
    participant G as Auth & RBAC Guards
    participant D as PostgreSQL (Drizzle)
    participant S as StorageConnector

    C->>F: HTTP Request (Cookie / Bearer / x-api-key)
    F->>F: Helmet + CORS + Rate Limit Check
    F->>G: Resolve Session / API Key & Role
    G-->>F: Authorized Context (user / scopes)
    F->>D: Parameterized Drizzle Query
    D-->>F: Domain Rows
    opt Media Download / Stream
        F->>S: getObjectStream(bucket, key, range)
        S-->>F: Readable Stream (200 or 206)
    end
    F-->>C: JSON / Stream Response
```

---

## Related Documentation

- [Database Schema & ER Diagram](./database-schema.md)
- [Authentication & Authorization](./authentication.md)
- [Storage Connectors](./storage-connectors.md)
- [Security Controls](./security.md)
- [REST & External API Reference](./api-reference.md)
