# Autenticación y Autorización

Smart Guide utiliza **Better Auth** con adaptador Drizzle PostgreSQL, soportando sesiones por cookie segura (Web) y token Bearer (Móvil).

## Proveedores Soportados

- **Correo y Contraseña:** controlado por `AUTH_ALLOW_EMAIL_PASSWORD` (mínimo 8 caracteres). El registro público respeta `AUTH_ALLOW_PUBLIC_SIGNUP`.
- **Google OAuth:** habilitado cuando `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` están configurados.
- **Microsoft Entra ID:** habilitado cuando `MICROSOFT_CLIENT_ID` y `MICROSOFT_CLIENT_SECRET` están configurados (`MICROSOFT_TENANT_ID=common` por defecto).

## Flujo OAuth Móvil (Deep-Link Bridge)

1. La app móvil abre `/api/v1/auth/mobile/start?provider=google&redirect_uri=smartguide://auth-callback`.
2. El servidor valida `redirect_uri` contra `MOBILE_APP_SCHEME` (previniendo Open Redirect).
3. Tras el login, `/api/v1/auth/mobile/finish` emite un código criptográfico de un solo uso válido por 60 segundos.
4. La app intercambia el código en `POST /api/v1/auth/mobile/exchange` y recibe el token Bearer + perfil.

## Roles (RBAC)

- **`admin`:** acceso total a configuración, usuarios, API keys, categorías y capacitaciones.
- **`creator`:** crea y edita capacitaciones, pasos, adjuntos y gestiona permisos compartidos.
- **`user`:** consulta capacitaciones publicadas/públicas o compartidas y registra su progreso.
