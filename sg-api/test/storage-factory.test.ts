import { Readable } from 'node:stream';
import type { ContainerClient } from '@azure/storage-blob';
import { describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../src/config/env.js';
import {
  AzureStorageConnector,
  createStorageConnector,
  LocalStorageConnector,
  RangeNotSatisfiableError,
  S3StorageConnector,
  StoragePathError,
} from '../src/storage/index.js';

const baseEnv = (overrides?: Record<string, string>) =>
  parseEnv({
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://smart_guide:secret@localhost:5432/smart_guide',
    BETTER_AUTH_SECRET: 'dev-secret-key-at-least-16-chars',
    CORS_ORIGINS: 'http://localhost:8080',
    ...overrides,
  });

describe('Storage factory & AzureStorageConnector', () => {
  it('createStorageConnector switches cleanly across local, s3, and azure drivers', () => {
    const local = createStorageConnector(
      baseEnv({ STORAGE_DRIVER: 'local', LOCAL_STORAGE_PATH: './uploads' }),
    );
    expect(local).toBeInstanceOf(LocalStorageConnector);
    expect(local.driver).toBe('local');

    const s3 = createStorageConnector(
      baseEnv({
        STORAGE_DRIVER: 's3',
        S3_ENDPOINT: 'http://minio:9000',
        S3_BUCKET: 'sg-media',
        S3_ACCESS_KEY_ID: 'ak',
        S3_SECRET_ACCESS_KEY: 'sk',
      }),
    );
    expect(s3).toBeInstanceOf(S3StorageConnector);
    expect(s3.driver).toBe('s3');

    const azure = createStorageConnector(
      baseEnv({
        STORAGE_DRIVER: 'azure',
        AZURE_STORAGE_ACCOUNT_NAME: 'sgstorage',
        AZURE_STORAGE_ACCOUNT_KEY: 'c2VjcmV0a2V5',
        AZURE_STORAGE_CONTAINER: 'smart-guide-media',
      }),
    );
    expect(azure).toBeInstanceOf(AzureStorageConnector);
    expect(azure.driver).toBe('azure');
  });

  it('AzureStorageConnector handles put, head, range get, batch delete, 404/416, and healthcheck', async () => {
    const deletedNames: string[] = [];
    const mockBlockBlob = {
      uploadData: vi.fn(async () => ({ etag: '"az-etag-1"' })),
      uploadStream: vi.fn(async () => ({ etag: '"az-etag-2"' })),
    };
    const mockBlobClient = {
      getProperties: vi.fn(async () => ({
        contentType: 'video/mp4',
        contentLength: 500,
        etag: '"az-etag-1"',
      })),
      download: vi.fn(async (offset: number, count?: number) => {
        if (offset >= 500) {
          throw Object.assign(new Error('InvalidRange'), { statusCode: 416 });
        }
        return {
          readableStreamBody: Readable.from([Buffer.from('chunk')]),
          contentType: 'video/mp4',
          contentLength: count ?? 500,
          contentRange: `bytes ${offset}-${offset + (count ?? 500) - 1}/500`,
        };
      }),
      deleteIfExists: vi.fn(async () => ({ succeeded: true })),
    };

    const mockContainerClient = {
      createIfNotExists: vi.fn(async () => ({ succeeded: true })),
      exists: vi.fn(async () => true),
      getBlockBlobClient: vi.fn(() => mockBlockBlob),
      getBlobClient: vi.fn((name: string) => {
        deletedNames.push(name);
        return mockBlobClient;
      }),
    } as unknown as ContainerClient;

    const connector = new AzureStorageConnector({
      containerName: 'media',
      containerClient: mockContainerClient,
    });

    await expect(connector.healthcheck()).resolves.toBe(true);

    const putRes = await connector.putObject({
      bucket: 'step-attachments',
      key: 't1/clip.mp4',
      body: Buffer.from('video-bytes'),
      contentType: 'video/mp4',
    });
    expect(putRes).toEqual({
      key: 't1/clip.mp4',
      contentType: 'video/mp4',
      contentLength: 11,
      etag: 'az-etag-1',
    });

    const head = await connector.headObject('step-attachments', 't1/clip.mp4');
    expect(head?.contentLength).toBe(500);

    const rangeRes = await connector.getObjectStream(
      'step-attachments',
      't1/clip.mp4',
      { start: 0, end: 4 },
    );
    expect(rangeRes?.statusCode).toBe(206);
    expect(rangeRes?.contentRange).toBe('bytes 0-4/500');
    expect(rangeRes?.totalLength).toBe(500);

    await expect(
      connector.getObjectStream('step-attachments', 't1/clip.mp4', { start: 999 }),
    ).rejects.toBeInstanceOf(RangeNotSatisfiableError);

    await expect(
      connector.headObject('step-attachments', '../bad.png'),
    ).rejects.toBeInstanceOf(StoragePathError);

    await connector.deleteObjects('step-attachments', ['a.png', 'b.png']);
    expect(deletedNames).toContain('step-attachments/a.png');
    expect(deletedNames).toContain('step-attachments/b.png');
  });
});

