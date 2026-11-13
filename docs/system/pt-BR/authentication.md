# Autenticação e Autorização

O Smart Guide utiliza **Better Auth** com adaptador Drizzle PostgreSQL, suportando sessões por cookie seguro (Web) e token Bearer (Mobile).

## Provedores Suportados

- **E-mail e Senha:** controlado por `AUTH_ALLOW_EMAIL_PASSWORD` (mínimo 8 caracteres). O auto-cadastro público respeita `AUTH_ALLOW_PUBLIC_SIGNUP`.
- **Google OAuth:** habilitado automaticamente quando `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` estão definidos.
- **Microsoft Entra ID:** habilitado quando `MICROSOFT_CLIENT_ID` e `MICROSOFT_CLIENT_SECRET` estão definidos (com `MICROSOFT_TENANT_ID=common` por padrão).

A disponibilidade dos provedores é exposta sem segredos em `GET /api/v1/instance/info`.

## Fluxo OAuth Mobile (Deep-Link Bridge)

1. O app mobile abre `/api/v1/auth/mobile/start?provider=google&redirect_uri=smartguide://auth-callback`.
2. O servidor valida `redirect_uri` contra a allowlist `MOBILE_APP_SCHEME` (prevenindo Open Redirect).
3. Após o login no provedor, `/api/v1/auth/mobile/finish` gera um código criptográfico de uso único válido por 60 segundos.
4. O app troca o código em `POST /api/v1/auth/mobile/exchange` e recebe o token Bearer + perfil do usuário.

## Papéis e Permissões (RBAC)

- **`admin`:** acesso total a configurações da instância, usuários, API keys, categorias e treinamentos. Não pode rebaixar a si mesmo nem remover o último admin.
- **`creator`:** cria e edita treinamentos, etapas, anexos e compartilha com outros usuários.
- **`user`:** visualiza treinamentos publicados/públicos ou compartilhados consigo via `training_permissions` e registra seu próprio progresso.
