# Primeiros Passos (Getting Started)

Este guia mostra como colocar sua instância própria do **Smart Guide** no ar rapidamente, configurar o arquivo `.env` e acessar a plataforma pela primeira vez.

---

## 1. Pré-requisitos

- **Docker** e **Docker Compose** (recomendado para produção), **ou**
- **Node.js 22+** e **PostgreSQL 17** (para execução local de desenvolvimento).

---

## 2. Configuração do `.env`

Na pasta raiz do projeto público, copie o arquivo de exemplo para criar a configuração da sua instância:

```bash
cp .env.example .env
```

Abra o `.env` e ajuste os campos principais:

| Variável | Para que serve | Exemplo |
| :--- | :--- | :--- |
| `INSTANCE_NAME` | Nome exibido no cabeçalho e nos PDFs | `Smart Guide Empresa` |
| `APP_DEFAULT_LOCALE` | Idioma padrão da instância (`pt-BR`, `en`, `es`) | `pt-BR` |
| `API_PUBLIC_URL` | URL pública da API (`sg-api`) | `https://api.treinamentos.suaempresa.com` |
| `WEB_PUBLIC_URL` | URL pública do portal web (`sg-web`) | `https://treinamentos.suaempresa.com` |
| `CORS_ORIGINS` | Origens de navegador autorizadas (separadas por vírgula) | `https://treinamentos.suaempresa.com` |
| `POSTGRES_PASSWORD` | Senha forte para o banco PostgreSQL | *(gerar senha forte)* |
| `BETTER_AUTH_SECRET` | Chave secreta usada para assinar sessões (`openssl rand -hex 32`) | *(64 caracteres hex)* |
| `SEED_ADMIN_EMAIL` | E-mail do administrador inicial | `admin@suaempresa.com` |
| `SEED_ADMIN_PASSWORD` | Senha inicial do administrador (troque após o primeiro acesso) | *(senha forte)* |

> **Dica:** Para armazenamento de imagens e vídeos, o padrão `STORAGE_DRIVER=local` salva os arquivos em disco (`LOCAL_STORAGE_PATH=./uploads`). Você também pode configurar `s3` (AWS S3, MinIO, Cloudflare R2) ou `azure` (Azure Blob Storage).

---

## 3. Subindo com Docker

Com o `.env` preenchido, inicie todos os serviços com um único comando:

```bash
docker compose up -d
```

Na inicialização, o backend aplica automaticamente as migrações do banco PostgreSQL e cria o usuário administrador inicial (caso ainda não exista nenhum administrador).

---

## 4. Executando localmente (Desenvolvimento)

Se preferir rodar sem Docker:

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

## 5. Primeiro Acesso

1. Abra o portal web no navegador (`http://localhost:8080` em Docker ou a URL exibida pelo Expo).
2. Faça login com o e-mail e a senha definidos em `SEED_ADMIN_EMAIL` e `SEED_ADMIN_PASSWORD`.
3. Acesse a aba **Admin** para ajustar o nome/logo da instância, cadastrar usuários ou configurar categorias.

---

## Próximos Passos

- [Guia do Administrador](./admin-guide.md) — Usuários, SSO (Google e Microsoft), Chaves de API e QR Code mobile.
- [Guia do Criador de Treinamentos](./creator-guide.md) — Como criar, estruturar etapas e compartilhar treinamentos.
- [Guia do Colaborador e App Mobile](./learner-mobile-guide.md) — Estudo online/offline, PDF e conexão por QR Code.
