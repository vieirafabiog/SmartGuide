# Arquitectura del Sistema

**Smart Guide** es un monorepo modular y auto-hospedado que separa la API REST (`sg-api`) del cliente universal (`sg-web`), operando en modelo **single-tenant** con PostgreSQL 17.

## Visión General

```mermaid
flowchart LR
    subgraph Clients["Clientes (sg-web)"]
        Web["Navegador Web (Expo Web / Nginx)"]
        Mobile["App iOS y Android (Expo / BYOS)"]
        Ext["Integraciones Externas (ERP / RRHH)"]
    end

    subgraph Backend["sg-api (Fastify 5 + TypeScript)"]
        Auth["Better Auth + Guards RBAC"]
        Modules["Módulos de Dominio\n(Trainings, Steps, Attachments,\nPermissions, Progress, Users, Admin)"]
        ExtAPI["External API (/api/v1/ext/*)"]
        Security["Capa de Seguridad\n(Helmet, CORS, Rate Limit,\nSanitizer, Magic-Byte Validator)"]
        Storage["StorageConnector Abstraction"]
        Tunnel["Tunnel Client Opt-in\n(Activo solo con SG_LICENSE_KEY)"]
    end

    subgraph Data["Persistencia y Storage"]
        PG[("PostgreSQL 17\n(Drizzle ORM + pg_trgm)")]
        LocalDisk[("Disco Local")]
        S3[("S3-Compatible\n(AWS / MinIO / R2)")]
        Azure[("Azure Blob Storage")]
    end

    Web -->|/api y /docs| Backend
    Mobile -->|HTTPS / Bearer| Backend
    Ext -->|x-api-key| ExtAPI
    Modules --> PG
    Auth --> PG
    Storage --> LocalDisk
    Storage --> S3
    Storage --> Azure
```

## Documentos Relacionados

- [Modelo de Base de Datos y Diagrama ER](../database-schema/)
- [Autenticación y Autorización](../authentication/)
- [Conectores de Almacenamiento](../storage-connectors/)
- [Controles de Seguridad](../security/)
- [Referencia de API REST y Externa](../api-reference/)
