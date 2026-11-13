const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'b',
  'strong',
  'i',
  'em',
  'u',
  'h1',
  'h2',
  'h3',
  'ul',
  'ol',
  'li',
]);

const VOID_TAGS = new Set(['br']);

const DANGEROUS_BLOCK_REGEX =
  /<\s*(script|style|iframe|object|embed|svg|math|noscript|template)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;

const DANGEROUS_SELF_CLOSING_REGEX =
  /<\s*(script|style|iframe|object|embed|svg|math|noscript|template)\b[^>]*\/?\s*>/gi;

const COMMENT_REGEX = /<!--[\s\S]*?-->/g;

const TAG_REGEX = /<\s*(\/?)\s*([a-zA-Z0-9-]+)(?:\s[^>]*)?\s*(\/?)\s*>/g;

/**
 * Sanitizes rich-text HTML using a strict tag allowlist (`p, br, b, strong, i, em, u, h1, h2, h3, ul, ol, li`)
 * and zero permitted attributes, stripping scripts, event handlers, comments, and dangerous tags.
 * Safe for both `RichTextEditor` and `pdf.service.ts` across Web, iOS, and Android.
 */
export function sanitizeRichTextHtml(dirtyHtml: string): string {
  if (!dirtyHtml) return '';

  let cleaned = dirtyHtml
    .replace(COMMENT_REGEX, '')
    .replace(DANGEROUS_BLOCK_REGEX, '')
    .replace(DANGEROUS_SELF_CLOSING_REGEX, '');

  cleaned = cleaned.replace(
    TAG_REGEX,
    (_match, closingSlash: string, rawTagName: string) => {
      const tag = rawTagName.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) {
        return '';
      }

      const isClosing = closingSlash === '/';
      if (VOID_TAGS.has(tag)) {
        return isClosing ? '' : `<${tag}>`;
      }

      return isClosing ? `</${tag}>` : `<${tag}>`;
    },
  );

  return cleaned.trim();
}

/**
 * Strips all HTML tags and normalizes whitespace for plain-text previews.
 */
export function stripHtmlToPlainText(html: string): string {
  if (!html) return '';
  return sanitizeRichTextHtml(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h1|h2|h3|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

