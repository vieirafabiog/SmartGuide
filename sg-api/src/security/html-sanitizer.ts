import sanitizeHtml from 'sanitize-html';

export const ALLOWED_RICH_TEXT_TAGS: readonly string[] = [
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
];

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...ALLOWED_RICH_TEXT_TAGS],
  allowedAttributes: {},
  allowedSchemes: [],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
};

/**
 * Sanitizes rich-text HTML against stored XSS using a strict tag allowlist
 * and zero permitted attributes, scripts, event handlers, or URI schemes.
 */
export function sanitizeRichTextHtml(dirtyHtml: string): string {
  if (!dirtyHtml) return '';
  return sanitizeHtml(dirtyHtml, SANITIZE_OPTIONS).trim();
}

