# Conectores de Almacenamiento (`local`, `s3`, `azure`)

Todos los archivos multimedia pasan por la interfaz `StorageConnector`, seleccionada al inicio mediante `STORAGE_DRIVER`.

## Drivers Disponibles

| Driver | Variable `STORAGE_DRIVER` | Uso Típico |
| :--- | :--- | :--- |
| **Disco Local** | `local` | Servidores single-node y Docker con volumen en `/app/uploads` |
| **S3-Compatible** | `s3` | AWS S3, MinIO (`--profile s3`), Cloudflare R2, DigitalOcean Spaces |
| **Azure Blob** | `azure` | Entornos corporativos Microsoft Azure |

## Streaming HTTP Range (`206 Partial Content`)

Los tres conectores soportan lectura por rangos de bytes (`Range: bytes=start-end`), permitiendo reproducción y salto instantáneo en videos sin cargar archivos completos en memoria.

## Control de Acceso

Con `STORAGE_PUBLIC_MEDIA=false`, `GET /api/v1/media/:bucket/*` requiere sesión autenticada o token HMAC de corta duración, devolviendo siempre `X-Content-Type-Options: nosniff`.
