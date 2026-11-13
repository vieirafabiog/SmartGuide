# Conectores de Storage (`local`, `s3`, `azure`)

Toda mídia enviada (imagens e vídeos de etapas ou capas) passa pela interface `StorageConnector`, selecionada em tempo de inicialização via `STORAGE_DRIVER`.

## Drivers Disponíveis

| Driver | Variável `STORAGE_DRIVER` | Casos de Uso |
| :--- | :--- | :--- |
| **Disco Local** | `local` | Servidores single-node e Docker com volume montado em `/app/uploads` |
| **S3-Compatible** | `s3` | AWS S3, MinIO (`--profile s3`), Cloudflare R2, DigitalOcean Spaces |
| **Azure Blob** | `azure` | Ambientes corporativos Microsoft Azure |

## Streaming HTTP Range (`206 Partial Content`)

Todos os três conectores implementam leitura por faixa de bytes (`Range: bytes=start-end`), permitindo avanço instantâneo (*seeking*) em vídeos no player Web e Mobile sem carregar o arquivo inteiro na memória.

## Controle de Acesso à Mídia

- Com `STORAGE_PUBLIC_MEDIA=false` (padrão recomendado), `GET /api/v1/media/:bucket/*` exige sessão autenticada ou token HMAC de curta duração para tags `<video>`/`<img>`.
- Todas as respostas de mídia incluem `X-Content-Type-Options: nosniff`.
