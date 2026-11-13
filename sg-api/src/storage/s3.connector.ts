import { Readable } from 'node:stream';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { RangeNotSatisfiableError, StoragePathError } from './local.connector.js';
import type {
  ByteRange,
  GetObjectStreamResult,
  PutObjectInput,
  StorageBucket,
  StorageConnector,
  StorageObjectMetadata,
} from './types.js';

export interface S3ConnectorConfig {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  client?: S3Client;
}

function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e.name === 'NoSuchKey' ||
    e.name === 'NotFound' ||
    e.$metadata?.httpStatusCode === 404
  );
}

function isInvalidRangeError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === 'InvalidRange' || e.$metadata?.httpStatusCode === 416;
}

function toNodeReadable(body: unknown): Readable {
  if (body instanceof Readable) {
    return body;
  }
  if (body && typeof (body as { transformToWebStream?: unknown }).transformToWebStream === 'function') {
    const webStream = (body as { transformToWebStream: () => ReadableStream }).transformToWebStream();
    return Readable.fromWeb(webStream as NodeWebReadableStream);
  }
  if (Buffer.isBuffer(body) || typeof body === 'string') {
    return Readable.from([body]);
  }
  throw new Error('Unsupported S3 response body stream');
}

export class S3StorageConnector implements StorageConnector {
  readonly driver = 's3' as const;
  private readonly client: S3Client;
  private readonly bucketName: string;

  constructor(config: S3ConnectorConfig) {
    this.bucketName = config.bucket;
    this.client =
      config.client ??
      new S3Client({
        region: config.region,
        ...(config.endpoint ? { endpoint: config.endpoint } : {}),
        forcePathStyle: config.forcePathStyle ?? true,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      });
  }

  private buildObjectKey(bucket: StorageBucket, key: string): string {
    if (!key || key.includes('\0') || key.includes('\\')) {
      throw new StoragePathError('Invalid storage key');
    }
    const trimmed = key.replace(/^\/+/, '');
    const segments = trimmed.split('/');
    if (!trimmed || segments.some((seg) => seg === '' || seg === '.' || seg === '..')) {
      throw new StoragePathError('Invalid storage key segments');
    }
    return `${bucket}/${trimmed}`;
  }

  async putObject(input: PutObjectInput): Promise<StorageObjectMetadata> {
    const objectKey = this.buildObjectKey(input.bucket, input.key);

    const res = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: objectKey,
        Body: input.body,
        ContentType: input.contentType,
        ...(input.contentLength !== undefined
          ? { ContentLength: input.contentLength }
          : {}),
      }),
    );

    const resolvedLength =
      input.contentLength ??
      (Buffer.isBuffer(input.body) ? input.body.length : 0);

    return {
      key: input.key,
      contentType: input.contentType,
      contentLength: resolvedLength,
      ...(res.ETag ? { etag: res.ETag.replace(/"/g, '') } : {}),
    };
  }

  async headObject(
    bucket: StorageBucket,
    key: string,
  ): Promise<StorageObjectMetadata | null> {
    const objectKey = this.buildObjectKey(bucket, key);
    try {
      const res = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucketName,
          Key: objectKey,
        }),
      );
      return {
        key,
        contentType: res.ContentType ?? 'application/octet-stream',
        contentLength: res.ContentLength ?? 0,
        ...(res.ETag ? { etag: res.ETag.replace(/"/g, '') } : {}),
      };
    } catch (err) {
      if (isNotFoundError(err)) return null;
      throw err;
    }
  }

  async getObjectStream(
    bucket: StorageBucket,
    key: string,
    range?: ByteRange,
  ): Promise<GetObjectStreamResult | null> {
    const objectKey = this.buildObjectKey(bucket, key);
    const rangeHeader = range
      ? range.end !== undefined
        ? `bytes=${range.start}-${range.end}`
        : `bytes=${range.start}-`
      : undefined;

    try {
      const res = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucketName,
          Key: objectKey,
          ...(rangeHeader ? { Range: rangeHeader } : {}),
        }),
      );

      if (!res.Body) {
        return null;
      }

      const contentLength = res.ContentLength ?? 0;
      const contentType = res.ContentType ?? 'application/octet-stream';
      const isPartial = Boolean(range && res.ContentRange);

      let totalLength: number | undefined = contentLength;
      if (res.ContentRange) {
        const match = /\/(\d+)$/.exec(res.ContentRange);
        if (match?.[1]) {
          totalLength = Number(match[1]);
        }
      }

      return {
        stream: toNodeReadable(res.Body),
        contentType,
        contentLength,
        totalLength,
        ...(res.ContentRange ? { contentRange: res.ContentRange } : {}),
        statusCode: isPartial ? 206 : 200,
      };
    } catch (err) {
      if (isNotFoundError(err)) return null;
      if (isInvalidRangeError(err)) {
        throw new RangeNotSatisfiableError(0);
      }
      throw err;
    }
  }

  async deleteObject(bucket: StorageBucket, key: string): Promise<void> {
    const objectKey = this.buildObjectKey(bucket, key);
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: objectKey,
      }),
    );
  }

  async deleteObjects(bucket: StorageBucket, keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;

    const objectKeys = keys.map((key) => this.buildObjectKey(bucket, key));
    const chunkSize = 1000;

    for (let i = 0; i < objectKeys.length; i += chunkSize) {
      const batch = objectKeys.slice(i, i + chunkSize);
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucketName,
          Delete: {
            Objects: batch.map((Key) => ({ Key })),
            Quiet: true,
          },
        }),
      );
    }
  }

  async healthcheck(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucketName }));
      return true;
    } catch {
      return false;
    }
  }
}
