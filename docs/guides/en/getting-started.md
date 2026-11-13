# Getting Started

This guide walks you through deploying your self-hosted **Smart Guide** instance, configuring `.env`, and signing in for the first time.

---

## 1. Prerequisites

- **Docker** and **Docker Compose** (recommended for production), **or**
- **Node.js 22+** and **PostgreSQL 17** (for local development).

---

## 2. Environment Configuration (`.env`)

In the public project root directory, copy the example template to create your instance configuration:

```bash
cp .env.example .env
```

Open `.env` and set the required values:

| Variable | Purpose | Example |
| :--- | :--- | :--- |
| `INSTANCE_NAME` | Display name shown in the header and PDF exports | `Acme Smart Guide` |
| `APP_DEFAULT_LOCALE` | Default instance language (`pt-BR`, `en`, `es`) | `en` |
| `API_PUBLIC_URL` | Public URL of the backend API (`sg-api`) | `https://api.training.example.com` |
| `WEB_PUBLIC_URL` | Public URL of the web portal (`sg-web`) | `https://training.example.com` |
| `CORS_ORIGINS` | Comma-separated list of allowed browser origins | `https://training.example.com` |
| `POSTGRES_PASSWORD` | Strong password for PostgreSQL | *(generate a strong secret)* |
| `BETTER_AUTH_SECRET` | Secret used to sign auth sessions (`openssl rand -hex 32`) | *(64-char hex string)* |
| `SEED_ADMIN_EMAIL` | Initial administrator email | `admin@example.com` |
| `SEED_ADMIN_PASSWORD` | Initial administrator password (change after first login) | *(strong password)* |

> **Tip:** By default, `STORAGE_DRIVER=local` saves uploaded images and videos to disk (`LOCAL_STORAGE_PATH=./uploads`). You can also switch to `s3` (AWS S3, MinIO, Cloudflare R2) or `azure` (Azure Blob Storage).

---

## 3. Starting with Docker

Once `.env` is ready, start the stack with:

```bash
docker compose up -d
```

On startup, `sg-api` automatically applies PostgreSQL migrations and seeds the initial administrator account if no admin exists yet.

---

## 4. Running Locally (Development)

```bash
# Terminal 1 — Backend (sg-api)
cd sg-api
npm install
npm run db:migrate
npm run db:seed
npm run dev

# Terminal 2 — Web (sg-web)
cd sg-web
npm install
npx expo start --web
```

---

## 5. First Sign-In

1. Open the web portal in your browser (`http://localhost:8080` under Docker, or the URL printed by Expo).
2. Sign in using `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`.
3. Open the **Admin** tab to customize the instance name/logo, create user accounts, and organize categories.

---

## Next Steps

- [Administrator Guide](./admin-guide.md) — Users, SSO (Google & Microsoft), API Keys, and Mobile QR Code.
- [Training Creator Guide](./creator-guide.md) — Creating trainings, managing steps, and sharing access.
- [Learner & Mobile App Guide](./learner-mobile-guide.md) — Online/offline study, PDF export, and QR Code pairing.
