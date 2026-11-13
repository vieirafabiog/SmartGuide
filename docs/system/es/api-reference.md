# Referencia de API REST y Externa

La especificación OpenAPI 3.0 completa está disponible en `/docs` (Swagger UI auto-hospedado).

## Grupos Principales de Rutas

- **Salud e Instancia:** `GET /health`, `GET /api/v1/instance/info`, `PATCH /api/v1/instance/settings` (`admin`).
- **Autenticación:** `ALL /api/auth/*` y `/api/v1/auth/mobile/{start,finish,exchange}`.
- **Capacitaciones y Pasos:** `GET/POST/PATCH/DELETE /api/v1/trainings`, `PUT /api/v1/trainings/:id/steps/reorder`, `PUT /api/v1/steps/:stepId/attachments/reorder`.
- **Multimedia:** `POST /api/v1/media/upload` (`admin`/`creator`), `GET /api/v1/media/:bucket/*` (`206 Partial Content`).
- **Administración:** `/api/v1/users`, `/api/v1/admin/stats`, `/api/v1/api-keys`.

## External Integration API (`/api/v1/ext/*`)

Autenticada exclusivamente mediante el header `x-api-key` con scopes (`users:read`, `users:write`, `trainings:read`):

```bash
curl -sS https://tu-instancia.com/api/v1/ext/trainings \
  -H "x-api-key: sg_live_tu_clave_aqui"
```

Las claves enviadas por query string (`?api_key=`) devuelven `401 Unauthorized`.
