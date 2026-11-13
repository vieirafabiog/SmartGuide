import type { StepProgress } from '@/types/database';
import { apiClient } from './apiClient';

export interface StepProgressSummaryItem {
  stepId: string;
  stepOrder: number;
  title: string;
  completed: boolean;
  completedAt: string | null;
  updatedAt: string | null;
}

export interface TrainingProgressSummary {
  trainingId: string;
  userId: string;
  totalSteps: number;
  completedSteps: number;
  percentage: number;
  steps: StepProgressSummaryItem[];
}

interface ApiStepProgress {
  id: string;
  userId: string;
  trainingId: string;
  stepId: string;
  completed: boolean;
  completedAt: string | null;
}

function mapProgress(raw: ApiStepProgress): StepProgress {
  return {
    id: raw.id,
    user_id: raw.userId,
    training_id: raw.trainingId,
    step_id: raw.stepId,
    completed: raw.completed,
    completed_at: raw.completedAt,
  };
}

export const progressService = {
  async getTrainingProgress(trainingId: string): Promise<TrainingProgressSummary> {
    const res = await apiClient.get<{ summary: TrainingProgressSummary }>(
      `/api/v1/trainings/${trainingId}/progress`,
    );
    return res.summary;
  },

  async setStepCompleted(
    trainingId: string,
    stepId: string,
    completed: boolean,
  ): Promise<{ progress: StepProgress; summary: TrainingProgressSummary }> {
    const res = await apiClient.put<{
      progress: ApiStepProgress;
      summary: TrainingProgressSummary;
    }>(`/api/v1/trainings/${trainingId}/steps/${stepId}/progress`, { completed });

    return {
      progress: mapProgress(res.progress),
      summary: res.summary,
    };
  },
};
