import { createHash } from 'node:crypto';
import { constants, createReadStream, createWriteStream } from 'node:fs';
import {
  access,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type {
  ByteRange,
  GetObjectStreamResult,
  PutObjectInput,
  StorageBucket,
  StorageConnector,
  StorageObjectMetadata,
} from './types.js';

const META_SUFFIX = '.sgmeta.json';

const EXT_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
};

export class StoragePathError extends Error {
  readonly statusCode = 400;
  readonly errorCode = 'INVALID_STORAGE_KEY';

  constructor(message: string) {
    super(message);
    this.name = 'StoragePathError';
  }
}

export class RangeNotSatisfiableError extends Error {
  readonly statusCode = 416;
  readonly errorCode = 'RANGE_NOT_SATISFIABLE';
  readonly totalLength: number;

  constructor(totalLength: number) {
    super('Requested byte range is not satisfiable');
    this.name = 'RangeNotSatisfiableError';
    this.totalLength = totalLength;
  }
}

interface SidecarMetadata {
  contentType: string;
  contentLength: number;
  etag?: string;
}

export class LocalStorageConnector implements StorageConnector {
  readonly driver = 'local' as const;
  private readonly rootDir: string;

  constructor(basePath: string) {
    this.rootDir = resolve(basePath);
  }

  private resolveSafePath(bucket: StorageBucket, key: string): string {
    if (!key || key.includes('\0') || key.includes('\\')) {
      throw new StoragePathError('Invalid storage key');
    }

    const trimmed = key.replace(/^\/+/, '');
    if (!trimmed || trimmed.endsWith(META_SUFFIX)) {
      throw new StoragePathError('Invalid storage key');
    }

    const segments = trimmed.split('/');
    if (segments.some((seg) => seg === '' || seg === '.' || seg === '..')) {
      throw new StoragePathError('Path traversal segments are forbidden');
    }

    const bucketRoot = resolve(this.rootDir, bucket);
    const targetPath = resolve(bucketRoot, ...segments);
    const rel = relative(bucketRoot, targetPath);

    if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
      throw new StoragePathError('Resolved path escapes bucket root');
    }

    return targetPath;
  }

  private inferMimeType(filePath: string): string {
    return EXT_TO_MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  }

  private async readSidecar(targetPath: string): Promise<SidecarMetadata | null> {
    try {
      const raw = await readFile(`${targetPath}${META_SUFFIX}`, 'utf8');
      return JSON.parse(raw) as SidecarMetadata;
    } catch {
      return null;
    }
  }

  async putObject(input: PutObjectInput): Promise<StorageObjectMetadata> {
    const targetPath = this.resolveSafePath(input.bucket, input.key);
    await mkdir(dirname(targetPath), { recursive: true });

    if (Buffer.isBuffer(input.body)) {
      await writeFile(targetPath, input.body);
    } else if (input.body instanceof Readable) {
      await pipeline(input.body, createWriteStream(targetPath));
    } else {
      throw new TypeError('Unsupported putObject body type');
    }

    const fileStats = await stat(targetPath);
    const etag = createHash('sha256')
      .update(`${input.bucket}/${input.key}:${fileStats.size}:${fileStats.mtimeMs}`)
      .digest('hex')
      .slice(0, 32);

    const sidecar: SidecarMetadata = {
      contentType: input.contentType,
      contentLength: fileStats.size,
      etag,
    };
    await writeFile(`${targetPath}${META_SUFFIX}`, JSON.stringify(sidecar), 'utf8');

    return {
      key: input.key,
      contentType: input.contentType,
      contentLength: fileStats.size,
      etag,
    };
  }

  async headObject(
    bucket: StorageBucket,
    key: string,
  ): Promise<StorageObjectMetadata | null> {
    const targetPath = this.resolveSafePath(bucket, key);
    let fileStats;
    try {
      fileStats = await stat(targetPath);
    } catch {
      return null;
    }

    if (!fileStats.isFile()) return null;

    const sidecar = await this.readSidecar(targetPath);
    return {
      key,
      contentType: sidecar?.contentType ?? this.inferMimeType(targetPath),
      contentLength: fileStats.size,
      ...(sidecar?.etag ? { etag: sidecar.etag } : {}),
    };
  }

  async getObjectStream(
    bucket: StorageBucket,
    key: string,
    range?: ByteRange,
  ): Promise<GetObjectStreamResult | null> {
    const targetPath = this.resolveSafePath(bucket, key);
    let fileStats;
    try {
      fileStats = await stat(targetPath);
    } catch {
      return null;
    }

    if (!fileStats.isFile()) return null;

    const totalLength = fileStats.size;
    const sidecar = await this.readSidecar(targetPath);
    const contentType = sidecar?.contentType ?? this.inferMimeType(targetPath);

    if (!range) {
      return {
        stream: createReadStream(targetPath),
        contentType,
        contentLength: totalLength,
        totalLength,
        statusCode: 200,
      };
    }

    if (totalLength === 0) {
      throw new RangeNotSatisfiableError(0);
    }

    const start = range.start;
    const end = Math.min(range.end ?? totalLength - 1, totalLength - 1);

    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      start >= totalLength ||
      start > end
    ) {
      throw new RangeNotSatisfiableError(totalLength);
    }

    return {
      stream: createReadStream(targetPath, { start, end }),
      contentType,
      contentLength: end - start + 1,
      totalLength,
      contentRange: `bytes ${start}-${end}/${totalLength}`,
      statusCode: 206,
    };
  }

  async deleteObject(bucket: StorageBucket, key: string): Promise<void> {
    const targetPath = this.resolveSafePath(bucket, key);
    await rm(targetPath, { force: true });
    await rm(`${targetPath}${META_SUFFIX}`, { force: true });
  }

  async deleteObjects(bucket: StorageBucket, keys: readonly string[]): Promise<void> {
    await Promise.all(keys.map((key) => this.deleteObject(bucket, key)));
  }

  async healthcheck(): Promise<boolean> {
    try {
      await mkdir(this.rootDir, { recursive: true });
      await access(this.rootDir, constants.R_OK | constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
}

