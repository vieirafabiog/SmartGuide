# Database Schema & ER Diagram

Smart Guide uses **PostgreSQL** managed through **Drizzle ORM** (`sg-api/src/db/schema/`). Migrations are stored in `sg-api/drizzle/` and executed via `npm run db:migrate`.

---

## Entity-Relationship Diagram

```mermaid
erDiagram
    user ||--o{ session : "has"
    user ||--o{ account : "links"
    user ||--o{ trainings : "creates"
    user ||--o{ training_permissions : "receives"
    user ||--o{ training_progress : "tracks"
    user ||--o{ api_keys : "provisions"

    trainings ||--o{ training_categories : "tagged_with"
    categories ||--o{ training_categories : "classifies"
    trainings ||--o{ training_steps : "contains"
    trainings ||--o{ training_permissions : "grants"
    trainings ||--o{ training_progress : "records"

    training_steps ||--o{ step_attachments : "includes"
    training_steps ||--o{ training_progress : "completed_in"

    user {
        text id PK
        text name
        text email UK
        boolean email_verified
        text image
        text role "admin | creator | user"
        boolean is_active
        text preferred_locale "pt-BR | en | es"
        timestamptz created_at
        timestamptz updated_at
    }

    session {
        text id PK
        timestamptz expires_at
        text token UK
        text ip_address
        text user_agent
        text user_id FK
    }

    account {
        text id PK
        text account_id
        text provider_id
        text user_id FK
        text password
    }

    verification {
        text id PK
        text identifier
        text value
        timestamptz expires_at
    }

    instance_settings {
        integer id PK "default 1"
        uuid instance_uuid UK
        text site_name
        text logo_url
        text default_locale "pt-BR | en | es"
        boolean allow_public_signup
        timestamptz updated_at
    }

    categories {
        uuid id PK
        text name UK
        text color
        text icon
        timestamptz created_at
    }

    trainings {
        uuid id PK
        text title
        text description
        text cover_url
        text status "draft | published | archived"
        boolean is_public
        text created_by FK
        timestamptz created_at
        timestamptz updated_at
    }

    training_categories {
        uuid training_id PK,FK
        uuid category_id PK,FK
    }

    training_steps {
        uuid id PK
        uuid training_id FK
        text title
        text content
        integer step_order
        timestamptz created_at
        timestamptz updated_at
    }

    step_attachments {
        uuid id PK
        uuid step_id FK
        text file_name
        text storage_key
        text file_url
        text file_type "image | video"
        text mime_type
        integer file_size
        integer att_order
        timestamptz created_at
    }

    training_permissions {
        uuid id PK
        uuid training_id FK
        text user_id FK
        text permission "owner | editor | viewer"
        timestamptz created_at
    }

    training_progress {
        uuid id PK
        text user_id FK
        uuid training_id FK
        uuid step_id FK
        boolean completed
        timestamptz completed_at
        timestamptz updated_at
    }

    api_keys {
        uuid id PK
        text name
        text key_prefix
        text key_hash UK
        text_array scopes
        boolean is_active
        text created_by FK
        timestamptz last_used_at
        timestamptz created_at
    }
```

---

## Tables & Indexing Summary

### Authentication Tables (`sg-api/src/db/schema/auth.ts`)

| Table | Purpose | Key Constraints / Indexes |
| :--- | :--- | :--- |
| `user` | User accounts, global roles (`admin`, `creator`, `user`), active flag, and `preferred_locale`. | `email` unique |
| `session` | Active Better Auth sessions with expiration, IP, and User-Agent metadata. | `token` unique; `session_user_id_idx` on `user_id`; cascades on user delete |
| `account` | OAuth provider links (Google, Microsoft) and hashed email/password credentials. | `account_user_id_idx` on `user_id`; cascades on user delete |
| `verification` | Verification/state tokens used by Better Auth flows. | `verification_identifier_idx` on `identifier` |

### Core Domain Tables (`sg-api/src/db/schema/core.ts`)

| Table | Purpose | Key Constraints / Indexes |
| :--- | :--- | :--- |
| `instance_settings` | Singleton (`id = 1`) holding `instance_uuid`, `site_name`, `logo_url`, `default_locale`, and `allow_public_signup`. | `instance_uuid` unique |
| `categories` | Training taxonomy tags with hex `color` and optional `icon`. | `name` unique |
| `trainings` | Training guides (`draft`, `published`, `archived`), visibility (`is_public`), and creator reference. | `trainings_created_by_idx`, `trainings_status_public_idx`; `created_by` uses `ON DELETE RESTRICT` |
| `training_categories` | Many-to-many join between `trainings` and `categories`. | Composite PK `(training_id, category_id)`; `training_categories_category_id_idx` |
| `training_steps` | Ordered steps belonging to a training with sanitized HTML `content`. | `training_steps_training_order_idx` on `(training_id, step_order)` |
| `step_attachments` | Media metadata (`image` / `video`, `storage_key`, `mime_type`, `file_size`, `att_order`). | `step_attachments_step_order_idx` on `(step_id, att_order)` |
| `training_permissions` | Per-training collaboration ACL (`owner`, `editor`, `viewer`). | Unique `(training_id, user_id)`; `training_permissions_user_id_idx` |
| `training_progress` | Per-user step completion tracking (`completed`, `completed_at`). | Unique `(user_id, step_id)`; `training_progress_user_training_idx` |
| `api_keys` | Hashed API keys (`key_prefix` + SHA-256 `key_hash`) and `scopes` (`users:read`, `users:write`, `trainings:read`). | `key_hash` unique; `created_by` uses `ON DELETE SET NULL` |

---

## Full-Text / Trigram Search (`pg_trgm`)

Migration `0001_enable_pg_trgm_search.sql` enables the PostgreSQL `pg_trgm` extension so catalog and user search queries stay responsive as the dataset grows.
