# Controles de Segurança

O Smart Guide aplica defesa em profundidade em todas as camadas da API e do cliente:

- **Validação de Upload por Magic Bytes:** Arquivos enviados em `POST /api/v1/media/upload` são inspecionados pelo conteúdo binário real (`file-type`) além da extensão. `.svg`, HTML e executáveis são rejeitados explicitamente.
- **Prevenção contra XSS e Injeção em PDF:** Descrições e conteúdos de etapas passam por `sanitizeRichTextHtml` (whitelist estrita de tags e atributos, bloqueando `<script>`, handlers `on*` e URIs `javascript:`) antes de salvar, renderizar e gerar PDF.
- **API Keys Criptográficas:** Geradas com `crypto.randomBytes(32)` (`sg_live_<hex>`), armazenadas apenas como hash `SHA-256` + prefixo e comparadas com `crypto.timingSafeEqual`. Chaves na query string (`?api_key=`) são rejeitadas.
- **Derivação Estrita de Sessão:** `userId` e `role` são sempre extraídos da sessão verificada no servidor (Better Auth), nunca de parâmetros enviados pelo cliente.
- **Headers e Rate Limiting:** `@fastify/helmet`, `CORS_ORIGINS` estrito (sem `*` em produção) e rate limiting dedicado para `/api/auth/*` e `/api/v1/ext/*`.
