# Primeros Pasos (Getting Started)

Esta guía explica cómo desplegar tu propia instancia de **Smart Guide**, configurar el archivo `.env` e iniciar sesión por primera vez.

---

## 1. Requisitos Previos

- **Docker** y **Docker Compose** (recomendado para producción), **o**
- **Node.js 22+** y **PostgreSQL 17** (para desarrollo local).

---

## 2. Configuración del `.env`

En la carpeta raíz del proyecto público, copia la plantilla de ejemplo para crear la configuración de tu instancia:

```bash
cp .env.example .env
```

Abre `.env` y ajusta las variables principales:

| Variable | Uso | Ejemplo |
| :--- | :--- | :--- |
| `INSTANCE_NAME` | Nombre mostrado en el encabezado y en los PDF | `Smart Guide Empresa` |
| `APP_DEFAULT_LOCALE` | Idioma predeterminado de la instancia (`pt-BR`, `en`, `es`) | `es` |
| `API_PUBLIC_URL` | URL pública de la API (`sg-api`) | `https://api.capacitacion.ejemplo.com` |
| `WEB_PUBLIC_URL` | URL pública del portal web (`sg-web`) | `https://capacitacion.ejemplo.com` |
| `CORS_ORIGINS` | Orígenes de navegador permitidos (separados por coma) | `https://capacitacion.ejemplo.com` |
| `POSTGRES_PASSWORD` | Contraseña segura para PostgreSQL | *(generar contraseña segura)* |
| `BETTER_AUTH_SECRET` | Clave secreta para firmar sesiones (`openssl rand -hex 32`) | *(64 caracteres hex)* |
| `SEED_ADMIN_EMAIL` | Correo del administrador inicial | `admin@ejemplo.com` |
| `SEED_ADMIN_PASSWORD` | Contraseña inicial del administrador (cámbiala tras el primer acceso) | *(contraseña segura)* |

> **Consejo:** Por defecto, `STORAGE_DRIVER=local` guarda imágenes y videos en disco (`LOCAL_STORAGE_PATH=./uploads`). También puedes usar `s3` (AWS S3, MinIO, Cloudflare R2) o `azure` (Azure Blob Storage).

---

## 3. Inicio con Docker

Con el `.env` configurado, inicia todos los servicios con un comando:

```bash
docker compose up -d
```

Al arrancar, `sg-api` ejecuta automáticamente las migraciones de PostgreSQL y crea el usuario administrador inicial si aún no existe ninguno.

---

## 4. Ejecución Local (Desarrollo)

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

## 5. Primer Acceso

1. Abre el portal web en tu navegador (`http://localhost:8080` con Docker o la URL mostrada por Expo).
2. Inicia sesión con `SEED_ADMIN_EMAIL` y `SEED_ADMIN_PASSWORD`.
3. Abre la pestaña **Admin** para personalizar el nombre y logotipo de la instancia, registrar usuarios o crear categorías.

---

## Siguientes Pasos

- [Guía del Administrador](./admin-guide.md) — Usuarios, SSO (Google y Microsoft), Claves de API y código QR móvil.
- [Guía del Creador de Capacitaciones](./creator-guide.md) — Cómo crear, organizar etapas y compartir capacitaciones.
- [Guía del Colaborador y App Móvil](./learner-mobile-guide.md) — Estudio en línea/sin conexión, PDF y conexión mediante código QR.
