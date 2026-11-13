# Administrator Guide

As an **Administrator (`admin`)**, you manage users, enterprise Single Sign-On (SSO), categories, external API keys, and mobile app pairing for your Smart Guide instance.

---

## 1. Configuring Social Login (SSO)

In addition to email and password, Smart Guide supports **Google OAuth** and **Microsoft Entra ID (Azure AD)**. Sign-in buttons appear automatically on the login screen when their credentials are configured in `.env`.

### Google OAuth

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create or select a project.
2. Go to **APIs & Services > Credentials** and create an **OAuth Client ID** (**Web application**).
3. Add the authorized redirect URI:
   - `https://<YOUR_API_PUBLIC_URL>/api/auth/callback/google`
4. Copy the **Client ID** and **Client Secret** into `.env`:
   ```env
   GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-client-secret
   ```

### Microsoft Entra ID (Azure AD)

1. Open **Azure Portal > Microsoft Entra ID > App registrations > New registration**.
2. Set the **Web Redirect URI** to:
   - `https://<YOUR_API_PUBLIC_URL>/api/auth/callback/microsoft`
3. Create a **Client Secret** under **Certificates & secrets**.
4. Set the values in `.env`:
   ```env
   MICROSOFT_CLIENT_ID=your-application-id
   MICROSOFT_CLIENT_SECRET=your-client-secret
   MICROSOFT_TENANT_ID=common
   ```
   *(To restrict access to your company directory only, replace `common` with your organization's **Tenant ID**).*

---

## 2. Admin Console (`Admin` Tab)

The **Admin** tab provides four management sections:

### Users
- **Create User:** Enter name, email, initial password, role (`admin`, `creator`, or `user`), and preferred language (`pt-BR`, `en`, `es`).
- **Update Role or Deactivate:** Change a user's role at any time or deactivate their account without deleting historical training data.

### Categories & Metrics
- **Instance Metrics:** View total users, trainings, steps, and recorded completions.
- **Categories:** Create color-coded tags (such as *Safety*, *Onboarding*, *Operations*) to organize the catalog.

### API Keys (External Integrations)
- Provision scoped API keys (`sgk_live_...`) to integrate Smart Guide with HR or ERP systems.
- Grant only the required scopes: `users:read`, `users:write`, `trainings:read`.
- **Important:** The full key is shown only once upon creation. Always send it via the `x-api-key` or `Authorization: Bearer` HTTP header.

### Instance Settings & Mobile QR Code
- Customize the **Instance Name**, **Logo**, **Default Language**, and toggle **Public Signup** (`false` is recommended for private company deployments).
- Copy the **Connection Link** or display the **QR Code** so employees can pair their mobile app directly with your server.

---

## Technical References

- [Authentication & Authorization](../../system/authentication.md)
- [Storage Connectors](../../system/storage-connectors.md)
- [REST & External API Reference](../../system/api-reference.md)
