# Modelo de Banco de Dados e Diagrama ER

O Smart Guide utiliza **PostgreSQL 17** com **Drizzle ORM** em arquitetura **single-tenant** (sem tabelas de empresas ou isolamento multi-tenant).

## Diagrama Entidade-Relacionamento

```mermaid
erDiagram
    user ||--o{ session : possui
    user ||--o{ account : possui
    user ||--o{ trainings : cria
    user ||--o{ training_permissions : recebe
    user ||--o{ training_progress : registra
    user ||--o{ api_keys : cria

    trainings ||--o{ training_steps : contem
    trainings ||--o{ training_categories : classifica
    categories ||--o{ training_categories : agrupa
    trainings ||--o{ training_permissions : compartilha
    training_steps ||--o{ step_attachments : anexa
    training_steps ||--o{ training_progress : acompanha
```

## Principais Tabelas

- **Autenticação (Better Auth):** `user` (`id`, `name`, `email`, `role` `'admin'|'creator'|'user'`, `isActive`, `preferredLocale`), `session`, `account`, `verification`.
- **Configuração da Instância:** `instance_settings` (singleton `id = 1` com `instanceUuid`, `siteName`, `logoUrl`, `defaultLocale`, `allowPublicSignup`).
- **Conteúdo:** `categories`, `trainings` (com índice GIN `pg_trgm` em `title` para busca rápida), `training_categories`, `training_steps` (`stepOrder` transacional) e `step_attachments` (`storageKey`, `fileType` `'image'|'video'`, `mimeType`, `fileSize`, `attOrder`).
- **Controle e Integração:** `training_permissions` (`'owner'|'editor'|'viewer'`), `training_progress` (`UNIQUE(userId, stepId)`) e `api_keys` (`keyPrefix`, `keyHash` SHA-256 único, `scopes`, `isActive`).
