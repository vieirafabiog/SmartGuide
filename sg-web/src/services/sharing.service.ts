import type { PermissionLevel, TrainingPermission } from '@/types/database';
import { apiClient } from './apiClient';

export interface ShareableUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

interface ApiTrainingPermission {
  id: string;
  trainingId: string;
  userId: string;
  userName: string;
  userEmail: string;
  userImage?: string | null;
  permission: PermissionLevel;
  createdAt: string;
}

function mapPermission(raw: ApiTrainingPermission): TrainingPermission {
  return {
    id: raw.id,
    training_id: raw.trainingId,
    user_id: raw.userId,
    permission: raw.permission,
    created_at: raw.createdAt,
    user: {
      name: raw.userName,
      email: raw.userEmail,
    },
  };
}

export const sharingService = {
  async searchUsers(query: string, limit = 10): Promise<ShareableUser[]> {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    params.set('limit', String(limit));
    const res = await apiClient.get<{ users: ShareableUser[] }>(
      `/api/v1/users/search?${params.toString()}`,
    );
    return res.users ?? [];
  },

  async getPermissions(trainingId: string): Promise<{
    creator: { id: string; name: string | null; email: string | null };
    permissions: TrainingPermission[];
  }> {
    const res = await apiClient.get<{
      creator: { id: string; name: string | null; email: string | null };
      permissions: ApiTrainingPermission[];
    }>(`/api/v1/trainings/${trainingId}/permissions`);

    return {
      creator: res.creator,
      permissions: (res.permissions ?? []).map(mapPermission),
    };
  },

  async grantPermission(
    trainingId: string,
    userId: string,
    permission: PermissionLevel,
  ): Promise<TrainingPermission> {
    const res = await apiClient.post<{ permission: ApiTrainingPermission }>(
      `/api/v1/trainings/${trainingId}/permissions`,
      { userId, permission },
    );
    return mapPermission(res.permission);
  },

  async updatePermission(
    trainingId: string,
    userId: string,
    permission: PermissionLevel,
  ): Promise<TrainingPermission> {
    const res = await apiClient.patch<{ permission: ApiTrainingPermission }>(
      `/api/v1/trainings/${trainingId}/permissions/${userId}`,
      { permission },
    );
    return mapPermission(res.permission);
  },

  async removePermission(trainingId: string, userId: string): Promise<void> {
    await apiClient.delete(`/api/v1/trainings/${trainingId}/permissions/${userId}`);
  },
};
