# Controles de Seguridad

Smart Guide aplica defensa en profundidad en la API y el cliente:

- **Validación por Magic Bytes:** `POST /api/v1/media/upload` inspecciona el contenido binario real (`file-type`) además de la extensión. `.svg`, HTML y ejecutables son rechazados.
- **Prevención contra XSS e Inyección en PDF:** El texto enriquecido pasa por `sanitizeRichTextHtml` antes de guardarse, renderizarse o exportarse a PDF.
- **API Keys Criptográficas:** Generadas con `crypto.randomBytes(32)` (`sg_live_<hex>`), almacenadas como hash `SHA-256` + prefijo y verificadas con `crypto.timingSafeEqual`. Se rechazan claves en query string (`?api_key=`).
- **Derivación Estricta de Sesión:** `userId` y `role` se obtienen únicamente de la sesión verificada en el servidor.
- **Headers y Rate Limiting:** `@fastify/helmet`, `CORS_ORIGINS` estricto y rate limiting dedicado en `/api/auth/*` y `/api/v1/ext/*`.
