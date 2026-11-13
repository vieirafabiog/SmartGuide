# Guía del Administrador

Como **Administrador (`admin`)**, gestionas usuarios, inicio de sesión único corporativo (SSO), categorías, claves de API externas y la vinculación de la aplicación móvil con tu instancia.

---

## 1. Configuración de Inicio de Sesión Social (SSO)

Además de correo y contraseña, Smart Guide admite **Google OAuth** y **Microsoft Entra ID (Azure AD)**. Los botones aparecen automáticamente en la pantalla de inicio de sesión cuando completas sus credenciales en `.env`.

### Google OAuth

1. Abre [Google Cloud Console](https://console.cloud.google.com/) y crea o selecciona un proyecto.
2. En **APIs y servicios > Credenciales**, crea un **ID de cliente OAuth** de tipo **Aplicación web**.
3. Agrega la URI de redirección autorizada:
   - `https://<TU_API_PUBLIC_URL>/api/auth/callback/google`
4. Copia el **Client ID** y el **Client Secret** en `.env`:
   ```env
   GOOGLE_CLIENT_ID=tu-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=tu-client-secret
   ```

### Microsoft Entra ID (Azure AD)

1. Abre **Azure Portal > Microsoft Entra ID > Registros de aplicaciones > Nuevo registro**.
2. Configura la **URI de redirección (Web)**:
   - `https://<TU_API_PUBLIC_URL>/api/auth/callback/microsoft`
3. Crea un **Secreto de cliente** en **Certificados y secretos**.
4. Completa las variables en `.env`:
   ```env
   MICROSOFT_CLIENT_ID=id-de-la-aplicacion
   MICROSOFT_CLIENT_SECRET=secreto-del-cliente
   MICROSOFT_TENANT_ID=common
   ```
   *(Para restringir el acceso solo a tu organización, reemplaza `common` por el **Tenant ID** de tu empresa).*

---

## 2. Panel de Administración (`Admin`)

En la pestaña **Admin** encontrarás cuatro secciones:

### Usuarios
- **Crear usuario:** ingresa nombre, correo, contraseña inicial, rol (`admin`, `creator` o `user`) e idioma preferido (`pt-BR`, `en`, `es`).
- **Cambiar rol o desactivar:** actualiza el rol en cualquier momento o desactiva la cuenta sin eliminar el historial.

### Categorías y Métricas
- **Métricas de la instancia:** consulta el total de usuarios, capacitaciones, etapas y finalizaciones registradas.
- **Categorías:** crea etiquetas con colores (por ejemplo, *Seguridad*, *Inducción*, *Operaciones*) para organizar el catálogo.

### Claves de API (Integraciones Externas)
- Genera claves con permisos específicos (`sgk_live_...`) para conectar Smart Guide con sistemas de RR. HH. o ERP.
- Asigna únicamente los alcances necesarios: `users:read`, `users:write`, `trainings:read`.
- **Importante:** la clave completa se muestra una sola vez al crearla. Envíala siempre mediante el encabezado HTTP `x-api-key` o `Authorization: Bearer`.

### Configuración de la Instancia y Código QR Móvil
- Personaliza el **Nombre de la Instancia**, el **Logotipo**, el **Idioma Predeterminado** y si el **Registro Público** está habilitado (`false` es recomendable en entornos corporativos privados).
- Copia el **Enlace de Conexión** o muestra el **Código QR** para que los colaboradores conecten su aplicación móvil directamente al servidor de la empresa.

---

## Referencias Técnicas

- [Autenticación y Autorización](../../system/authentication.md)
- [Conectores de Almacenamiento](../../system/storage-connectors.md)
- [Referencia de la API REST y Externa](../../system/api-reference.md)
