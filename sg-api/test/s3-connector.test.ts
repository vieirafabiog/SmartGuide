import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { RangeNotSatisfiableError, StoragePathError } from '../src/storage/local.connector.js';
import { S3StorageConnector } from '../src/storage/s3.connector.js';

describe('S3StorageConnector (AWS S3 / MinIO / R2 / Spaces)', () => {
  it('supports MinIO / S3 config and executes put, head, range get, batch delete, and healthcheck', async () => {
    const sentCommands: unknown[] = [];
    const mockClient = {
      send: vi.fn(async (cmd: unknown) => {
        sentCommands.push(cmd);
        if (cmd instanceof PutObjectCommand) {
          return { ETag: '"etag-123"' };
        }
        if (cmd instanceof HeadObjectCommand) {
          return { ContentType: 'video/mp4', ContentLength: 1024, ETag: '"etag-123"' };
        }
        if (cmd instanceof GetObjectCommand) {
          return {
            Body: Readable.from([Buffer.from('partial-bytes')]),
            ContentType: 'video/mp4',
            ContentLength: 13,
            ContentRange: 'bytes 0-12/1024',
          };
        }
        if (
          cmd instanceof DeleteObjectCommand ||
          cmd instanceof DeleteObjectsCommand ||
          cmd instanceof HeadBucketCommand
        ) {
          return {};
        }
        return {};
      }),
    } as unknown as S3Client;

    const connector = new S3StorageConnector({
      bucket: 'smart-guide-media',
      region: 'us-east-1',
      endpoint: 'http://minio:9000',
      forcePathStyle: true,
      accessKeyId: 'minioadmin',
      secretAccessKey: 'minioadmin123',
      client: mockClient,
    });

    await expect(connector.healthcheck()).resolves.toBe(true);

    const putRes = await connector.putObject({
      bucket: 'step-attachments',
      key: 'trainings/t1/video.mp4',
      body: Buffer.from('test-video'),
      contentType: 'video/mp4',
    });
    expect(putRes).toEqual({
      key: 'trainings/t1/video.mp4',
      contentType: 'video/mp4',
      contentLength: 10,
      etag: 'etag-123',
    });

    const headRes = await connector.headObject('step-attachments', 'trainings/t1/video.mp4');
    expect(headRes?.contentLength).toBe(1024);

    const streamRes = await connector.getObjectStream(
      'step-attachments',
      'trainings/t1/video.mp4',
      { start: 0, end: 12 },
    );
    expect(streamRes?.statusCode).toBe(206);
    expect(streamRes?.contentRange).toBe('bytes 0-12/1024');
    expect(streamRes?.totalLength).toBe(1024);

    const getCmd = sentCommands.find((c) => c instanceof GetObjectCommand) as GetObjectCommand;
    expect(getCmd.input.Range).toBe('bytes=0-12');
    expect(getCmd.input.Key).toBe('step-attachments/trainings/t1/video.mp4');

    // Batch delete chunks >1000 keys cleanly
    const keys = Array.from({ length: 1005 }, (_, i) => `k/${i}.png`);
    await connector.deleteObjects('training-covers', keys);
    const deleteBatchCmds = sentCommands.filter(
      (c) => c instanceof DeleteObjectsCommand,
    ) as DeleteObjectsCommand[];
    expect(deleteBatchCmds).toHaveLength(2);
    expect(deleteBatchCmds[0]?.input.Delete?.Objects).toHaveLength(1000);
    expect(deleteBatchCmds[1]?.input.Delete?.Objects).toHaveLength(5);
  });

  it('returns null on 404/NoSuchKey, throws RangeNotSatisfiableError on 416, and blocks bad keys', async () => {
    const mockClient = {
      send: vi.fn(async (cmd: unknown) => {
        if (cmd instanceof HeadObjectCommand) {
          const err = Object.assign(new Error('NotFound'), {
            name: 'NotFound',
            $metadata: { httpStatusCode: 404 },
          });
          throw err;
        }
        if (cmd instanceof GetObjectCommand) {
          const err = Object.assign(new Error('InvalidRange'), {
            name: 'InvalidRange',
            $metadata: { httpStatusCode: 416 },
          });
          throw err;
        }
        if (cmd instanceof HeadBucketCommand) {
          throw new Error('ECONNREFUSED');
        }
        return {};
      }),
    } as unknown as S3Client;

    const connector = new S3StorageConnector({
      bucket: 'smart-guide-media',
      region: 'us-east-1',
      accessKeyId: 'ak',
      secretAccessKey: 'sk',
      client: mockClient,
    });

    await expect(connector.healthcheck()).resolves.toBe(false);
    await expect(connector.headObject('step-attachments', 'missing.png')).resolves.toBeNull();
    await expect(
      connector.getObjectStream('step-attachments', 'video.mp4', { start: 9999 }),
    ).rejects.toBeInstanceOf(RangeNotSatisfiableError);
    await expect(
      connector.headObject('step-attachments', '../escape.png'),
    ).rejects.toBeInstanceOf(StoragePathError);
  });
});

