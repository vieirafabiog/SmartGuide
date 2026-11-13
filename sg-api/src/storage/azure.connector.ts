import { Readable } from 'node:stream';
import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  type ContainerClient,
} from '@azure/storage-blob';
import { RangeNotSatisfiableError, StoragePathError } from './local.connector.js';
import type {
  ByteRange,
  GetObjectStreamResult,
  PutObjectInput,
  StorageBucket,
  StorageConnector,
  StorageObjectMetadata,
} from './types.js';

export interface AzureConnectorConfig {
  containerName: string;
  connectionString?: string;
  accountName?: string;
  accountKey?: string;
  containerClient?: ContainerClient;
}

function getAzureStatusCode(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  return (err as { statusCode?: number }).statusCode;
}

function parseTotalFromContentRange(contentRange?: string): number | undefined {
  if (!contentRange) return undefined;
  const match = /\/(\d+)$/.exec(contentRange);
  return match?.[1] ? Number(match[1]) : undefined;
}

export class AzureStorageConnector implements StorageConnector {
  readonly driver = 'azure' as const;
  private readonly containerClient: ContainerClient;
  private containerVerified = false;

  constructor(config: AzureConnectorConfig) {
    if (config.containerClient) {
      this.containerClient = config.containerClient;
      return;
    }

    let serviceClient: BlobServiceClient;
    if (config.connectionString) {
      serviceClient = BlobServiceClient.fromConnectionString(config.connectionString);
    } else if (config.accountName && config.accountKey) {
      const credential = new StorageSharedKeyCredential(
        config.accountName,
        config.accountKey,
      );
      serviceClient = new BlobServiceClient(
        `https://${config.accountName}.blob.core.windows.net`,
        credential,
      );
    } else {
      throw new Error(
        'AzureStorageConnector requires connectionString or accountName + accountKey',
      );
    }

    this.containerClient = serviceClient.getContainerClient(config.containerName);
  }

  private buildBlobName(bucket: StorageBucket, key: string): string {
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

  private async ensureContainer(): Promise<void> {
    if (this.containerVerified) return;
    await this.containerClient.createIfNotExists();
    this.containerVerified = true;
  }

  async putObject(input: PutObjectInput): Promise<StorageObjectMetadata> {
    await this.ensureContainer();
    const blobName = this.buildBlobName(input.bucket, input.key);
    const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
    const options = {
      blobHTTPHeaders: {
        blobContentType: input.contentType,
      },
    };

    let etag: string | undefined;
    let contentLength = input.contentLength ?? 0;

    if (Buffer.isBuffer(input.body)) {
      const res = await blockBlobClient.uploadData(input.body, options);
      etag = res.etag?.replace(/"/g, '');
      contentLength = input.body.length;
    } else if (input.body instanceof Readable) {
      const res = await blockBlobClient.uploadStream(
        input.body,
        undefined,
        undefined,
        options,
      );
      etag = res.etag?.replace(/"/g, '');
    } else {
      throw new TypeError('Unsupported putObject body type');
    }

    return {
      key: input.key,
      contentType: input.contentType,
      contentLength,
      ...(etag ? { etag } : {}),
    };
  }

  async headObject(
    bucket: StorageBucket,
    key: string,
  ): Promise<StorageObjectMetadata | null> {
    const blobName = this.buildBlobName(bucket, key);
    const blobClient = this.containerClient.getBlobClient(blobName);
    try {
      const props = await blobClient.getProperties();
      return {
        key,
        contentType: props.contentType ?? 'application/octet-stream',
        contentLength: props.contentLength ?? 0,
        ...(props.etag ? { etag: props.etag.replace(/"/g, '') } : {}),
      };
    } catch (err) {
      if (getAzureStatusCode(err) === 404) return null;
      throw err;
    }
  }

  async getObjectStream(
    bucket: StorageBucket,
    key: string,
    range?: ByteRange,
  ): Promise<GetObjectStreamResult | null> {
    const blobName = this.buildBlobName(bucket, key);
    const blobClient = this.containerClient.getBlobClient(blobName);

    let offset = 0;
    let count: number | undefined;
    if (range) {
      if (range.start < 0 || (range.end !== undefined && range.end < range.start)) {
        throw new RangeNotSatisfiableError(0);
      }
      offset = range.start;
      count = range.end !== undefined ? range.end - range.start + 1 : undefined;
    }

    try {
      const res = await blobClient.download(offset, count);
      const stream = res.readableStreamBody as Readable | undefined;
      if (!stream) return null;

      const contentLength = res.contentLength ?? 0;
      const totalLength = parseTotalFromContentRange(res.contentRange) ?? contentLength;
      const isPartial = Boolean(range && res.contentRange);

      return {
        stream,
        contentType: res.contentType ?? 'application/octet-stream',
        contentLength,
        totalLength,
        ...(res.contentRange ? { contentRange: res.contentRange } : {}),
        statusCode: isPartial ? 206 : 200,
      };
    } catch (err) {
      const status = getAzureStatusCode(err);
      if (status === 404) return null;
      if (status === 416) throw new RangeNotSatisfiableError(0);
      throw err;
    }
  }

  async deleteObject(bucket: StorageBucket, key: string): Promise<void> {
    const blobName = this.buildBlobName(bucket, key);
    const blobClient = this.containerClient.getBlobClient(blobName);
    await blobClient.deleteIfExists();
  }

  async deleteObjects(bucket: StorageBucket, keys: readonly string[]): Promise<void> {
    await Promise.all(keys.map((key) => this.deleteObject(bucket, key)));
  }

  async healthcheck(): Promise<boolean> {
    try {
      await this.containerClient.exists();
      return true;
    } catch {
      return false;
    }
  }
}

