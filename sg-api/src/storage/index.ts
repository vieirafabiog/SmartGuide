import type { AppEnv } from '../config/env.js';
import { AzureStorageConnector } from './azure.connector.js';
import { LocalStorageConnector } from './local.connector.js';
import { S3StorageConnector } from './s3.connector.js';
import type { StorageConnector } from './types.js';

export * from './azure.connector.js';
export * from './local.connector.js';
export * from './s3.connector.js';
export * from './types.js';

/**
 * Instantiates the configured StorageConnector (`local` | `s3` | `azure`) from validated env.
 */
export function createStorageConnector(env: AppEnv): StorageConnector {
  switch (env.STORAGE_DRIVER) {
    case 'local':
      return new LocalStorageConnector(env.LOCAL_STORAGE_PATH);

    case 's3': {
      if (!env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
        throw new Error('Missing required S3 storage configuration');
      }
      return new S3StorageConnector({
        bucket: env.S3_BUCKET,
        region: env.S3_REGION,
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
        ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
      });
    }

    case 'azure':
      return new AzureStorageConnector({
        containerName: env.AZURE_STORAGE_CONTAINER,
        ...(env.AZURE_STORAGE_CONNECTION_STRING
          ? { connectionString: env.AZURE_STORAGE_CONNECTION_STRING }
          : {}),
        ...(env.AZURE_STORAGE_ACCOUNT_NAME
          ? { accountName: env.AZURE_STORAGE_ACCOUNT_NAME }
          : {}),
        ...(env.AZURE_STORAGE_ACCOUNT_KEY
          ? { accountKey: env.AZURE_STORAGE_ACCOUNT_KEY }
          : {}),
      });
  }
}

