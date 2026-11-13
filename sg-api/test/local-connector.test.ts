import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LocalStorageConnector,
  RangeNotSatisfiableError,
  StoragePathError,
} from '../src/storage/local.connector.js';

async function readStreamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describe('LocalStorageConnector', () => {
  const tempDirs: string[] = [];

  const createConnector = () => {
    const dir = mkdtempSync(join(tmpdir(), 'sg-local-storage-'));
    tempDirs.push(dir);
    return new LocalStorageConnector(dir);
  };

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stores, heads, streams, and deletes buffers and Readable streams', async () => {
    const connector = createConnector();
    await expect(connector.healthcheck()).resolves.toBe(true);

    const payload = Buffer.from('0123456789ABCDEF');
    const meta = await connector.putObject({
      bucket: 'step-attachments',
      key: 'trainings/t1/sample.mp4',
      body: payload,
      contentType: 'video/mp4',
    });

    expect(meta.contentLength).toBe(16);
    expect(meta.contentType).toBe('video/mp4');

    const head = await connector.headObject('step-attachments', 'trainings/t1/sample.mp4');
    expect(head).toMatchObject({
      key: 'trainings/t1/sample.mp4',
      contentType: 'video/mp4',
      contentLength: 16,
    });

    const full = await connector.getObjectStream('step-attachments', 'trainings/t1/sample.mp4');
    expect(full?.statusCode).toBe(200);
    expect(full?.contentLength).toBe(16);
    expect((await readStreamToBuffer(full!.stream)).toString()).toBe('0123456789ABCDEF');

    // Also test Readable stream upload
    const streamMeta = await connector.putObject({
      bucket: 'training-covers',
      key: 'covers/c1.png',
      body: Readable.from([Buffer.from('hello '), Buffer.from('world')]),
      contentType: 'image/png',
    });
    expect(streamMeta.contentLength).toBe(11);

    await connector.deleteObjects('step-attachments', ['trainings/t1/sample.mp4']);
    await expect(
      connector.headObject('step-attachments', 'trainings/t1/sample.mp4'),
    ).resolves.toBeNull();
  });

  it('supports HTTP 206 byte-range streaming and rejects unsatisfiable ranges', async () => {
    const connector = createConnector();
    await connector.putObject({
      bucket: 'step-attachments',
      key: 'videos/seek.mp4',
      body: Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
      contentType: 'video/mp4',
    });

    const partial = await connector.getObjectStream(
      'step-attachments',
      'videos/seek.mp4',
      { start: 2, end: 5 },
    );
    expect(partial?.statusCode).toBe(206);
    expect(partial?.contentLength).toBe(4);
    expect(partial?.contentRange).toBe('bytes 2-5/26');
    expect((await readStreamToBuffer(partial!.stream)).toString()).toBe('CDEF');

    const openEnd = await connector.getObjectStream(
      'step-attachments',
      'videos/seek.mp4',
      { start: 22 },
    );
    expect(openEnd?.statusCode).toBe(206);
    expect(openEnd?.contentRange).toBe('bytes 22-25/26');
    expect((await readStreamToBuffer(openEnd!.stream)).toString()).toBe('WXYZ');

    await expect(
      connector.getObjectStream('step-attachments', 'videos/seek.mp4', { start: 30 }),
    ).rejects.toBeInstanceOf(RangeNotSatisfiableError);
  });

  it('blocks all path-traversal and invalid storage key attempts', async () => {
    const connector = createConnector();

    const maliciousKeys = [
      '../secret.txt',
      'a/../../etc/passwd',
      'sub\\..\\escape.png',
      'file.png\0.jpg',
      'trainings/a.png.sgmeta.json',
      '',
    ];

    for (const badKey of maliciousKeys) {
      await expect(
        connector.headObject('step-attachments', badKey),
      ).rejects.toBeInstanceOf(StoragePathError);
      await expect(
        connector.deleteObject('step-attachments', badKey),
      ).rejects.toBeInstanceOf(StoragePathError);
    }
  });
});

