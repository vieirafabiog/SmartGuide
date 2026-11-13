import type { Readable } from 'node:stream';

export type StorageDriver = 'local' | 's3' | 'azure';

export type StorageBucket = 'training-covers' | 'step-attachments' | 'instance-assets';

export interface ByteRange {
  start: number;
  end?: number;
}

export interface PutObjectInput {
  bucket: StorageBucket;
  key: string;
  body: Buffer | Readable;
  contentType: string;
  contentLength?: number;
}

export interface StorageObjectMetadata {
  key: string;
  contentType: string;
  contentLength: number;
  etag?: string;
}

export interface GetObjectStreamResult {
  stream: Readable;
  contentType: string;
  contentLength: number;
  totalLength?: number;
  contentRange?: string;
  statusCode: 200 | 206;
}

export interface StorageConnector {
  readonly driver: StorageDriver;
  putObject(input: PutObjectInput): Promise<StorageObjectMetadata>;
  getObjectStream(
    bucket: StorageBucket,
    key: string,
    range?: ByteRange,
  ): Promise<GetObjectStreamResult | null>;
  headObject(bucket: StorageBucket, key: string): Promise<StorageObjectMetadata | null>;
  deleteObject(bucket: StorageBucket, key: string): Promise<void>;
  deleteObjects(bucket: StorageBucket, keys: readonly string[]): Promise<void>;
  healthcheck(): Promise<boolean>;
}

