import type { AttachmentType } from '@/types/database';
import { apiClient } from './apiClient';
import { getApiBaseUrl } from './serverConfig.service';

export type StorageBucket = 'training-covers' | 'step-attachments' | 'instance-assets';

export interface UploadedMediaResult {
  bucket: StorageBucket;
  storageKey: string;
  fileName: string;
  fileType: AttachmentType;
  mimeType: string;
  fileSize: number;
  url: string;
  signedUrl: string;
}

export interface NativeUploadFile {
  uri: string;
  name: string;
  type: string;
}

export const storageService = {
  async uploadMedia(
    bucket: StorageBucket,
    file: File | Blob | NativeUploadFile,
    fileName?: string,
  ): Promise<UploadedMediaResult> {
    const formData = new FormData();

    if (typeof Blob !== 'undefined' && file instanceof Blob) {
      const resolvedName =
        fileName ?? (typeof File !== 'undefined' && file instanceof File ? file.name : 'upload.bin');
      formData.append('file', file, resolvedName);
    } else {
      const nativeFile = file as NativeUploadFile;
      formData.append('file', {
        uri: nativeFile.uri,
        name: fileName ?? nativeFile.name,
        type: nativeFile.type || 'application/octet-stream',
      } as unknown as Blob);
    }

    return apiClient.uploadFormData<UploadedMediaResult>(
      `/api/v1/media/upload?bucket=${encodeURIComponent(bucket)}`,
      formData,
      { timeoutMs: 120_000 },
    );
  },

  async resolveMediaUrl(pathOrUrl: string | null | undefined): Promise<string> {
    if (!pathOrUrl) return '';
    if (/^https?:\/\//i.test(pathOrUrl) || pathOrUrl.startsWith('file://') || pathOrUrl.startsWith('data:')) {
      return pathOrUrl;
    }
    const baseUrl = await getApiBaseUrl();
    const normalized = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
    return `${baseUrl}${normalized}`;
  },
};
