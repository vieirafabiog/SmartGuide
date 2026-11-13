import type { AttachmentType, StepAttachment } from '@/types/database';
import { apiClient } from './apiClient';
import { mapAttachment } from './steps.service';

interface ApiStepAttachment {
  id: string;
  stepId: string;
  fileName: string;
  storageKey: string;
  fileUrl: string;
  fileType: AttachmentType;
  mimeType: string;
  fileSize: number;
  attOrder: number;
  createdAt: string;
}

export const attachmentsService = {
  async getAttachments(stepId: string): Promise<StepAttachment[]> {
    const res = await apiClient.get<{ attachments: ApiStepAttachment[] }>(
      `/api/v1/steps/${stepId}/attachments`,
    );
    return (res.attachments ?? []).map(mapAttachment);
  },

  async createAttachment(
    stepId: string,
    input: {
      fileName: string;
      storageKey: string;
      fileUrl: string;
      fileType: AttachmentType;
      mimeType: string;
      fileSize: number;
      attOrder?: number;
    },
  ): Promise<StepAttachment> {
    const res = await apiClient.post<{ attachment: ApiStepAttachment }>(
      `/api/v1/steps/${stepId}/attachments`,
      input,
    );
    return mapAttachment(res.attachment);
  },

  async updateAttachment(
    attachmentId: string,
    input: Partial<{ fileName: string; attOrder: number }>,
  ): Promise<StepAttachment> {
    const res = await apiClient.patch<{ attachment: ApiStepAttachment }>(
      `/api/v1/attachments/${attachmentId}`,
      input,
    );
    return mapAttachment(res.attachment);
  },

  async deleteAttachment(attachmentId: string): Promise<void> {
    await apiClient.delete(`/api/v1/attachments/${attachmentId}`);
  },

  async reorderAttachments(
    stepId: string,
    attachmentIds: string[],
  ): Promise<StepAttachment[]> {
    const res = await apiClient.put<{ attachments: ApiStepAttachment[] }>(
      `/api/v1/steps/${stepId}/attachments/reorder`,
      { attachmentIds },
    );
    return (res.attachments ?? []).map(mapAttachment);
  },
};
