# Guia do Administrador

Como administrador (`admin`), você gerencia usuários, autenticação corporativa (SSO), categorias, integrações via API e a conexão do aplicativo móvel com a sua instância.

---

## 1. Configurando Login Social (SSO)

O Smart Guide suporta login com **Google** e **Microsoft Entra ID (Azure AD)** além de e-mail e senha. Os botões aparecem automaticamente na tela de login quando as credenciais estão preenchidas no `.env`.

### Google OAuth

1. Acesse o [Google Cloud Console](https://console.cloud.google.com/) e crie um projeto (ou selecione um existente).
2. Em **APIs e Serviços > Credenciais**, crie um **ID do cliente OAuth** do tipo **Aplicativo da Web**.
3. Adicione a URL de callback autorizada:
   - `https://<SUA_API_PUBLIC_URL>/api/auth/callback/google`
4. Copie o **Client ID** e o **Client Secret** para o `.env`:
   ```env
   GOOGLE_CLIENT_ID=seu-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=seu-client-secret
   ```

### Microsoft Entra ID (Azure AD)

1. Acesse o **Portal do Azure > Microsoft Entra ID > Registros de aplicativo > Novo registro**.
2. Em **URI de Redirecionamento (Web)**, informe:
   - `https://<SUA_API_PUBLIC_URL>/api/auth/callback/microsoft`
3. Crie um **Segredo do cliente** em **Certificados e segredos**.
4. Preencha no `.env`:
   ```env
   MICROSOFT_CLIENT_ID=id-do-aplicativo
   MICROSOFT_CLIENT_SECRET=segredo-do-cliente
   MICROSOFT_TENANT_ID=common
   ```
   *(Para restringir apenas aos usuários da sua organização, substitua `common` pelo **Tenant ID** da sua empresa).*

---

## 2. Painel Administrativo (`Admin`)

No menu principal, abra a aba **Admin** para acessar quatro áreas:

### Usuários
- **Criar usuário:** informe nome, e-mail, senha inicial, perfil (`admin`, `creator` ou `user`) e idioma preferido (`pt-BR`, `en`, `es`).
- **Alterar perfil ou desativar:** troque o papel de um colaborador a qualquer momento ou desative o acesso sem apagar o histórico de treinamentos.

### Categorias e Métricas
- **Métricas da instância:** acompanhe o total de usuários, treinamentos, etapas e conclusões registradas.
- **Categorias:** crie etiquetas coloridas (ex.: *Segurança*, *Onboarding*, *Operações*) para organizar o catálogo.

### Chaves de API (Integrações Externas)
- Gere chaves de acesso (`sgk_live_...`) para integrar o Smart Guide com sistemas de RH ou ERP.
- Escolha apenas os escopos necessários: `users:read`, `users:write` e `trainings:read`.
- **Importante:** a chave completa é exibida uma única vez no momento da criação. Envie-a sempre pelo cabeçalho HTTP `x-api-key` ou `Authorization: Bearer`.

### Configurações da Instância e QR Code Mobile
- Personalize o **Nome da Instância**, o **Logotipo**, o **Idioma Padrão** e defina se o **Cadastro Público** está liberado (`false` é recomendado para ambientes corporativos privados).
- Copie o **Link de Conexão** ou exiba o **QR Code** para que os colaboradores conectem o aplicativo mobile diretamente ao servidor da empresa.

---

## Referências Técnicas

- [Autenticação e Permissões](../../system/authentication.md)
- [Conectores de Armazenamento](../../system/storage-connectors.md)
- [Referência da API REST e Externa](../../system/api-reference.md)
