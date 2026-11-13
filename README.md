# Smart Guide

**Smart Guide** is an open-source, self-hosted corporate training and SOP (Standard Operating Procedure) platform built with **Fastify + PostgreSQL + Drizzle ORM** (`sg-api`) and **Expo / React Native** (`sg-web`) for Web, iOS, and Android.

---

## Key Features

- **Step-by-Step Training Player:** Overview mode, sequential study mode, progress tracking per user and step, and interactive media lightbox (images and videos).
- **Rich-Text Training Editor:** Create and reorder steps, attach multiple images/videos, manage categories, draft/published/archived lifecycle, and granular collaboration permissions (`owner`, `editor`, `viewer`).
- **Offline Study & PDF Export:** Download trainings and media locally for offline study, or export formatted multi-page PDF guides with cover, table of contents, and step attachments.
- **Enterprise Authentication:** Powered by **Better Auth** with Email/Password, Google OAuth, and Microsoft Entra ID (Azure AD), plus role-based access control (`admin`, `creator`, `user`).
- **Pluggable Storage Connectors:** Store covers and media on **Local Disk**, **S3-Compatible** storage (AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces), or **Azure Blob Storage**, with HTTP `Range` video streaming and HMAC-signed media URLs.
- **External Integration API:** Provision scoped API keys (`users:read`, `users:write`, `trainings:read`) to synchronize users and catalog data with ERP/HR systems, documented via built-in Swagger UI (`/docs`).
- **Multilingual UI (`pt-BR`, `en`, `es`):** Full internationalization across web, mobile, PDF exports, offline sync messages, and API error codes.

---

## Repository Structure

```text
.
├── .env.example          # Global environment configuration template
├── sg-api/               # Backend REST API (Fastify, TypeScript, Drizzle ORM, PostgreSQL, Better Auth)
│   ├── drizzle/          # SQL migrations (core schema + pg_trgm search)
│   ├── src/              # Modular routes, auth, storage connectors, security & tests
│   └── test/             # Vitest integration & security test suites
├── sg-web/               # Universal client (Expo Router, React Native Web, iOS & Android)
│   └── src/              # Screens, admin console, i18n locales, offline & PDF services
└── docs/
    ├── system/           # Technical architecture, schema, auth, storage, security & API docs
    └── guides/           # Multilingual end-user & administrator guides (pt-BR, en, es)
```

---

## Quick Start (Local Development)

### Prerequisites

- **Node.js** `22+`
- **PostgreSQL** `17` (or `15+` with `pg_trgm` support)

### 1. Configure Environment

Copy `.env.example` to `.env` in this directory and fill in your database credentials and `BETTER_AUTH_SECRET`:

```bash
cp .env.example .env
# Generate a 32+ byte hex secret for BETTER_AUTH_SECRET:
openssl rand -hex 32
```

### 2. Start `sg-api`

```bash
cd sg-api
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

The API listens on `http://localhost:3000` by default, with interactive OpenAPI docs at `http://localhost:3000/docs` and health diagnostics at `http://localhost:3000/health`.

### 3. Start `sg-web`

```bash
cd sg-web
npm install
npx expo start --web
```

---

## System Documentation

- [System Architecture](./docs/system/architecture.md)
- [Database Schema & ER Diagram](./docs/system/database-schema.md)
- [Authentication & Authorization](./docs/system/authentication.md)
- [Storage Connectors](./docs/system/storage-connectors.md)
- [Security Controls](./docs/system/security.md)
- [REST & External API Reference](./docs/system/api-reference.md)

---

## Verification & Quality Checks

```bash
# Backend (sg-api)
cd sg-api && npm test && npm run lint && npx tsc --noEmit

# Frontend (sg-web)
cd sg-web && npx tsc --noEmit && npx expo lint && npx expo export --platform web
```
