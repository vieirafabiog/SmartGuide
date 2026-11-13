import type { AttachmentType, StepAttachment, TrainingStep } from '@/types/database';
import { apiClient } from './apiClient';

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

interface ApiStep {
  id: string;
  trainingId: string;
  title: string;
  content: string;
  stepOrder: number;
  attachments?: ApiStepAttachment[];
  createdAt: string;
  updatedAt: string;
}

export function mapAttachment(raw: ApiStepAttachment): StepAttachment {
  return {
    id: raw.id,
    step_id: raw.stepId,
    file_name: raw.fileName,
    storage_key: raw.storageKey,
    file_url: raw.fileUrl,
    file_type: raw.fileType,
    mime_type: raw.mimeType,
    file_size: raw.fileSize,
    att_order: raw.attOrder,
    created_at: raw.createdAt,
  };
}

function mapStep(raw: ApiStep): TrainingStep {
  return {
    id: raw.id,
    training_id: raw.trainingId,
    title: raw.title,
    content: raw.content,
    step_order: raw.stepOrder,
    created_at: raw.createdAt,
    updated_at: raw.updatedAt,
    attachments: (raw.attachments ?? []).map(mapAttachment),
  };
}

export const stepsService = {
  async getSteps(trainingId: string): Promise<TrainingStep[]> {
    const res = await apiClient.get<{ steps: ApiStep[] }>(
      `/api/v1/trainings/${trainingId}/steps`,
    );
    return (res.steps ?? []).map(mapStep);
  },

  async createStep(
    trainingId: string,
    input: { title: string; content?: string; stepOrder?: number },
  ): Promise<TrainingStep> {
    const res = await apiClient.post<{ step: ApiStep }>(
      `/api/v1/trainings/${trainingId}/steps`,
      {
        title: input.title.trim(),
        content: input.content ?? '',
        ...(input.stepOrder !== undefined ? { stepOrder: input.stepOrder } : {}),
      },
    );
    return mapStep(res.step);
  },

  async updateStep(
    stepId: string,
    input: Partial<{ title: string; content: string; stepOrder: number }>,
  ): Promise<TrainingStep> {
    const res = await apiClient.patch<{ step: ApiStep }>(
      `/api/v1/steps/${stepId}`,
      input,
    );
    return mapStep(res.step);
  },

  async deleteStep(stepId: string): Promise<void> {
    await apiClient.delete(`/api/v1/steps/${stepId}`);
  },

  async reorderSteps(trainingId: string, stepIds: string[]): Promise<TrainingStep[]> {
    const res = await apiClient.put<{ steps: ApiStep[] }>(
      `/api/v1/trainings/${trainingId}/steps/reorder`,
      { stepIds },
    );
    return (res.steps ?? []).map(mapStep);
  },
};
