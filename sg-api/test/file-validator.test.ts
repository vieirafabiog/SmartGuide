import { describe, expect, it } from 'vitest';
import {
  buildStorageKey,
  MediaValidationError,
  sanitizeFileName,
  validateMediaBuffer,
} from '../src/security/file-validator.js';

const defaultLimits = {
  maxImageBytes: 5 * 1024 * 1024,
  maxVideoBytes: 50 * 1024 * 1024,
};

// Minimal valid magic-byte signatures recognized by `file-type`
const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52,
]);
const JPEG_HEADER = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);
const GIF_HEADER = Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00', 'binary');
const MP4_HEADER = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32,
  0x00, 0x00, 0x00, 0x00, 0x6d, 0x70, 0x34, 0x32, 0x69, 0x73, 0x6f, 0x6d,
]);

describe('magic-byte media validator', () => {
  it('accepts valid image and video files with matching magic bytes', async () => {
    const png = await validateMediaBuffer(PNG_HEADER, 'diagram.png', defaultLimits);
    expect(png).toMatchObject({
      fileType: 'image',
      mimeType: 'image/png',
      extension: 'png',
      sanitizedFileName: 'diagram.png',
    });

    const jpg = await validateMediaBuffer(JPEG_HEADER, 'photo.jpeg', defaultLimits);
    expect(jpg).toMatchObject({
      fileType: 'image',
      mimeType: 'image/jpeg',
      extension: 'jpg',
    });

    const gif = await validateMediaBuffer(GIF_HEADER, 'anim.gif', defaultLimits);
    expect(gif.fileType).toBe('image');
    expect(gif.mimeType).toBe('image/gif');

    const mp4 = await validateMediaBuffer(MP4_HEADER, 'demo.mp4', defaultLimits);
    expect(mp4).toMatchObject({
      fileType: 'video',
      mimeType: 'video/mp4',
      extension: 'mp4',
    });
  });

  it('explicitly rejects .svg files and spoofed SVG/HTML/executable payloads', async () => {
    const svgPayload = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

    await expect(
      validateMediaBuffer(svgPayload, 'icon.svg', defaultLimits),
    ).rejects.toMatchObject({ errorCode: 'SVG_FORBIDDEN', statusCode: 415 });

    await expect(
      validateMediaBuffer(svgPayload, 'spoofed.png', defaultLimits),
    ).rejects.toMatchObject({ errorCode: 'SVG_OR_HTML_FORBIDDEN', statusCode: 415 });

    const htmlPayload = Buffer.from('<!DOCTYPE html><html><script>alert(1)</script></html>');
    await expect(
      validateMediaBuffer(htmlPayload, 'page.jpg', defaultLimits),
    ).rejects.toMatchObject({ errorCode: 'SVG_OR_HTML_FORBIDDEN', statusCode: 415 });

    // Windows PE executable header ("MZ") renamed to .png
    const exePayload = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    await expect(
      validateMediaBuffer(exePayload, 'malware.png', defaultLimits),
    ).rejects.toBeInstanceOf(MediaValidationError);
  });

  it('rejects extension/MIME spoofing, empty files, and oversized payloads', async () => {
    await expect(
      validateMediaBuffer(MP4_HEADER, 'fake-video.png', defaultLimits),
    ).rejects.toMatchObject({ errorCode: 'MIME_EXTENSION_MISMATCH', statusCode: 415 });

    await expect(
      validateMediaBuffer(Buffer.alloc(0), 'empty.png', defaultLimits),
    ).rejects.toMatchObject({ errorCode: 'EMPTY_FILE', statusCode: 400 });

    await expect(
      validateMediaBuffer(PNG_HEADER, 'huge.png', {
        maxImageBytes: 8,
        maxVideoBytes: 100,
      }),
    ).rejects.toMatchObject({ errorCode: 'FILE_TOO_LARGE', statusCode: 413 });
  });

  it('sanitizes filenames against path traversal and generates UUID storage keys', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('..hidden file (1).png')).toBe('hidden_file_1_.png');

    const key = buildStorageKey('trainings/abc', 'step_1.png');
    expect(key).toMatch(/^trainings\/abc\/[0-9a-f-]{36}-step_1\.png$/);
  });
});

