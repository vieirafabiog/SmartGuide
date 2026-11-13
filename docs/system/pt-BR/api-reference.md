# Referência da API REST e Externa

A especificação OpenAPI 3.0 completa está disponível de forma auto-hospedada em `/docs` (Swagger UI).

## Principais Grupos de Rotas

- **Saúde e Instância:** `GET /health`, `GET /api/v1/instance/info`, `PATCH /api/v1/instance/settings` (`admin`).
- **Autenticação:** `ALL /api/auth/*` (Better Auth) e `/api/v1/auth/mobile/{start,finish,exchange}`.
- **Treinamentos e Etapas:** `GET/POST/PATCH/DELETE /api/v1/trainings`, `PUT /api/v1/trainings/:id/steps/reorder`, `PUT /api/v1/steps/:stepId/attachments/reorder`.
- **Mídia:** `POST /api/v1/media/upload` (`admin`/`creator`), `GET /api/v1/media/:bucket/*` (`206 Partial Content`).
- **Administração:** `/api/v1/users`, `/api/v1/admin/stats`, `/api/v1/api-keys`.

## External Integration API (`/api/v1/ext/*`)

Projetada para integrações com RH/ERP usando o header `x-api-key` e escopos granulares (`users:read`, `users:write`, `trainings:read`):

```bash
curl -sS https://sua-instancia.com/api/v1/ext/trainings \
  -H "x-api-key: sg_live_sua_chave_aqui"
```

Chaves enviadas via query string (`?api_key=`) retornam `401 Unauthorized`.
