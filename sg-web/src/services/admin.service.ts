import type {
  ApiKeyScope,
  ApiKeySummary,
  InstanceInfo,
  Profile,
  SupportedLocale,
  UserRole,
} from '@/types/database';
import { apiClient } from './apiClient';

export interface AdminStats {
  totalUsers: number;
  activeUsers: number;
  totalTrainings: number;
  publishedTrainings: number;
  totalCategories: number;
  totalSteps: number;
  activeApiKeys: number;
}

interface ApiSafeUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  preferredLocale: SupportedLocale;
  image: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapUser(raw: ApiSafeUser): Profile {
  return {
    id: raw.id,
    name: raw.name,
    email: raw.email,
    role: raw.role,
    is_active: raw.isActive,
    preferred_locale: raw.preferredLocale,
    avatar_url: raw.image,
    created_at: raw.createdAt,
    updated_at: raw.updatedAt,
  };
}

export const adminService = {
  async getStats(): Promise<AdminStats> {
    const res = await apiClient.get<{ stats: AdminStats }>('/api/v1/admin/stats');
    return res.stats;
  },

  async getInstanceInfo(): Promise<InstanceInfo> {
    return apiClient.get<InstanceInfo>('/api/v1/instance/info');
  },

  async updateInstanceSettings(input: {
    siteName?: string;
    logoUrl?: string | null;
    defaultLocale?: SupportedLocale;
    allowPublicSignup?: boolean;
  }): Promise<void> {
    await apiClient.patch('/api/v1/instance/settings', input);
  },

  async listUsers(params?: {
    page?: number;
    pageSize?: number;
    search?: string;
    role?: UserRole;
    isActive?: boolean;
  }): Promise<{
    users: Profile[];
    pagination: { page: number; pageSize: number; total: number; totalPages: number };
  }> {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    if (params?.search?.trim()) query.set('search', params.search.trim());
    if (params?.role) query.set('role', params.role);
    if (params?.isActive !== undefined) query.set('isActive', String(params.isActive));
    const qs = query.toString();

    const res = await apiClient.get<{
      users: ApiSafeUser[];
      pagination: { page: number; pageSize: number; total: number; totalPages: number };
    }>(`/api/v1/users${qs ? `?${qs}` : ''}`);

    return {
      users: (res.users ?? []).map(mapUser),
      pagination: res.pagination,
    };
  },

  async createUser(input: {
    name: string;
    email: string;
    password: string;
    role?: UserRole;
    preferredLocale?: SupportedLocale;
  }): Promise<Profile> {
    const res = await apiClient.post<{ user: ApiSafeUser }>('/api/v1/users', input);
    return mapUser(res.user);
  },

  async updateUser(
    userId: string,
    input: Partial<{
      name: string;
      role: UserRole;
      isActive: boolean;
      preferredLocale: SupportedLocale;
    }>,
  ): Promise<Profile> {
    const res = await apiClient.patch<{ user: ApiSafeUser }>(
      `/api/v1/users/${userId}`,
      input,
    );
    return mapUser(res.user);
  },

  async deleteUser(userId: string): Promise<void> {
    await apiClient.delete(`/api/v1/users/${userId}`);
  },

  async listApiKeys(): Promise<ApiKeySummary[]> {
    const res = await apiClient.get<{ apiKeys: ApiKeySummary[] }>('/api/v1/api-keys');
    return res.apiKeys ?? [];
  },

  async createApiKey(input: {
    name: string;
    scopes?: ApiKeyScope[];
  }): Promise<{ apiKey: ApiKeySummary; plaintextKey: string }> {
    return apiClient.post<{ apiKey: ApiKeySummary; plaintextKey: string }>(
      '/api/v1/api-keys',
      input,
    );
  },

  async updateApiKey(
    id: string,
    input: Partial<{ name: string; scopes: ApiKeyScope[]; isActive: boolean }>,
  ): Promise<ApiKeySummary> {
    const res = await apiClient.patch<{ apiKey: ApiKeySummary }>(
      `/api/v1/api-keys/${id}`,
      input,
    );
    return res.apiKey;
  },

  async deleteApiKey(id: string): Promise<void> {
    await apiClient.delete(`/api/v1/api-keys/${id}`);
  },
};
