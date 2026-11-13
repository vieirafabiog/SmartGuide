import { describe, expect, it } from 'vitest';
import {
  generateApiKey,
  hasApiKeyScope,
  hashApiKey,
  verifyApiKey,
} from '../src/security/api-key.js';
import { sanitizeRichTextHtml } from '../src/security/html-sanitizer.js';

describe('HTML sanitizer & cryptographic API key helpers', () => {
  it('preserves allowed rich-text tags and strips XSS vectors', () => {
    const cleanInput =
      '<h1>Title</h1><p>Hello <strong>world</strong> and <em>team</em></p><ul><li>Item 1</li></ul>';
    expect(sanitizeRichTextHtml(cleanInput)).toBe(cleanInput);

    const xssPayload =
      '<p onclick="alert(1)">Hi</p><script>fetch("https://evil.tld")</script>' +
      '<img src=x onerror=alert(1)><svg onload=alert(1)></svg>' +
      '<a href="javascript:alert(1)">Click</a><iframe src="https://evil.tld"></iframe>';

    const sanitized = sanitizeRichTextHtml(xssPayload);
    expect(sanitized).toBe('<p>Hi</p>Click');
    expect(sanitized).not.toContain('<script');
    expect(sanitized).not.toContain('onerror');
    expect(sanitized).not.toContain('onclick');
    expect(sanitized).not.toContain('javascript:');
    expect(sanitized).not.toContain('<svg');
    expect(sanitized).not.toContain('<iframe');
  });

  it('generates 256-bit sg_live_ API keys, hashes with SHA-256, and verifies in constant time', () => {
    const k1 = generateApiKey();
    const k2 = generateApiKey();

    expect(k1.plaintextKey).toMatch(/^sg_live_[a-f0-9]{64}$/);
    expect(k1.keyPrefix).toBe(k1.plaintextKey.slice(0, 12));
    expect(k1.keyPrefix.startsWith('sg_live_')).toBe(true);
    expect(k1.keyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(k1.keyHash).toBe(hashApiKey(k1.plaintextKey));
    expect(k1.plaintextKey).not.toBe(k2.plaintextKey);

    expect(verifyApiKey(k1.plaintextKey, k1.keyHash)).toBe(true);
    expect(verifyApiKey(k2.plaintextKey, k1.keyHash)).toBe(false);
    expect(verifyApiKey('invalid_prefix_123', k1.keyHash)).toBe(false);
    expect(verifyApiKey(k1.plaintextKey, 'not-a-valid-hex-hash')).toBe(false);
  });

  it('checks API key scopes accurately', () => {
    const scopes = ['users:read', 'trainings:read'];
    expect(hasApiKeyScope(scopes, 'users:read')).toBe(true);
    expect(hasApiKeyScope(scopes, 'trainings:read')).toBe(true);
    expect(hasApiKeyScope(scopes, 'users:write')).toBe(false);
  });
});
