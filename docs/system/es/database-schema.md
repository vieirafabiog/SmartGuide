# Modelo de Base de Datos y Diagrama ER

Smart Guide utiliza **PostgreSQL 17** con **Drizzle ORM** en arquitectura **single-tenant**.

## Diagrama Entidad-Relación

```mermaid
erDiagram
    user ||--o{ session : posee
    user ||--o{ account : posee
    user ||--o{ trainings : crea
    user ||--o{ training_permissions : recibe
    user ||--o{ training_progress : registra
    user ||--o{ api_keys : crea

    trainings ||--o{ training_steps : contiene
    trainings ||--o{ training_categories : clasifica
    categories ||--o{ training_categories : agrupa
    trainings ||--o{ training_permissions : comparte
    training_steps ||--o{ step_attachments : adjunta
    training_steps ||--o{ training_progress : sigue
```

## Tablas Principales

- **Autenticación (Better Auth):** `user` (`role`: `'admin'|'creator'|'user'`, `isActive`, `preferredLocale`), `session`, `account`, `verification`.
- **Configuración:** `instance_settings` (singleton `id = 1` con `instanceUuid`, `siteName`, `logoUrl`, `defaultLocale`, `allowPublicSignup`).
- **Contenido:** `categories`, `trainings` (índice GIN `pg_trgm` en `title`), `training_categories`, `training_steps` (`stepOrder` transaccional) y `step_attachments` (`storageKey`, `fileType`, `mimeType`, `fileSize`, `attOrder`).
- **Control e Integración:** `training_permissions` (`'owner'|'editor'|'viewer'`), `training_progress` (`UNIQUE(userId, stepId)`) y `api_keys` (`keyPrefix`, `keyHash` SHA-256 único, `scopes`, `isActive`).
