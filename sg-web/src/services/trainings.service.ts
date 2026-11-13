import type { Category, Training, TrainingStatus } from '@/types/database';
import { apiClient } from './apiClient';

interface ApiTrainingCategory {
  id: string;
  name: string;
  color: string;
  icon: string | null;
}

interface ApiTraining {
  id: string;
  title: string;
  description: string;
  coverUrl: string | null;
  status: TrainingStatus;
  isPublic: boolean;
  createdBy: string;
  creatorName?: string | null;
  categories?: ApiTrainingCategory[];
  stepCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface TrainingsListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: TrainingStatus;
  categoryId?: string;
  isPublic?: boolean;
}

export interface TrainingsListResponse {
  trainings: Training[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

function mapCategory(raw: ApiTrainingCategory): Category {
  return {
    id: raw.id,
    name: raw.name,
    color: raw.color,
    icon: raw.icon,
  };
}

function mapTraining(raw: ApiTraining): Training {
  return {
    id: raw.id,
    title: raw.title,
    description: raw.description,
    cover_url: raw.coverUrl,
    status: raw.status,
    is_public: raw.isPublic,
    created_by: raw.createdBy,
    created_at: raw.createdAt,
    updated_at: raw.updatedAt,
    categories: raw.categories ? raw.categories.map(mapCategory) : [],
    total_steps: raw.stepCount ?? 0,
  };
}

export const trainingsService = {
  async getTrainings(params?: TrainingsListParams): Promise<Training[]> {
    const result = await this.listTrainingsPaginated(params);
    return result.trainings;
  },

  async listTrainingsPaginated(
    params?: TrainingsListParams,
  ): Promise<TrainingsListResponse> {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    if (params?.search?.trim()) query.set('search', params.search.trim());
    if (params?.status) query.set('status', params.status);
    if (params?.categoryId) query.set('categoryId', params.categoryId);
    if (params?.isPublic !== undefined) {
      query.set('isPublic', String(params.isPublic));
    }

    const qs = query.toString();
    const res = await apiClient.get<{
      trainings: ApiTraining[];
      pagination: TrainingsListResponse['pagination'];
    }>(`/api/v1/trainings${qs ? `?${qs}` : ''}`);

    return {
      trainings: (res.trainings ?? []).map(mapTraining),
      pagination: res.pagination,
    };
  },

  async getTrainingById(id: string): Promise<Training> {
    const res = await apiClient.get<{ training: ApiTraining }>(
      `/api/v1/trainings/${id}`,
    );
    return mapTraining(res.training);
  },

  async createTraining(input: {
    title: string;
    description?: string;
    coverUrl?: string | null;
    status?: TrainingStatus;
    isPublic?: boolean;
    categoryIds?: string[];
  }): Promise<Training> {
    const res = await apiClient.post<{ training: ApiTraining }>('/api/v1/trainings', {
      title: input.title.trim(),
      description: input.description ?? '',
      coverUrl: input.coverUrl ?? null,
      status: input.status ?? 'draft',
      isPublic: input.isPublic ?? true,
      categoryIds: input.categoryIds ?? [],
    });
    return mapTraining(res.training);
  },

  async updateTraining(
    id: string,
    input: Partial<{
      title: string;
      description: string;
      coverUrl: string | null;
      status: TrainingStatus;
      isPublic: boolean;
      categoryIds: string[];
    }>,
  ): Promise<Training> {
    const res = await apiClient.patch<{ training: ApiTraining }>(
      `/api/v1/trainings/${id}`,
      input,
    );
    return mapTraining(res.training);
  },

  async deleteTraining(id: string): Promise<void> {
    await apiClient.delete(`/api/v1/trainings/${id}`);
  },
};
