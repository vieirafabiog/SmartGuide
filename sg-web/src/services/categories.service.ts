import type { Category } from '@/types/database';
import { apiClient } from './apiClient';

interface ApiCategory {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  createdAt: string;
}

function mapCategory(raw: ApiCategory): Category {
  return {
    id: raw.id,
    name: raw.name,
    color: raw.color,
    icon: raw.icon,
    created_at: raw.createdAt,
  };
}

export const categoriesService = {
  async getCategories(): Promise<Category[]> {
    const res = await apiClient.get<{ categories: ApiCategory[] }>('/api/v1/categories');
    return (res.categories ?? []).map(mapCategory);
  },

  async createCategory(input: {
    name: string;
    color?: string;
    icon?: string | null;
  }): Promise<Category> {
    const res = await apiClient.post<{ category: ApiCategory }>('/api/v1/categories', {
      name: input.name.trim(),
      color: input.color ?? '#3B82F6',
      icon: input.icon ?? null,
    });
    return mapCategory(res.category);
  },

  async updateCategory(
    id: string,
    input: Partial<{ name: string; color: string; icon: string | null }>,
  ): Promise<Category> {
    const res = await apiClient.patch<{ category: ApiCategory }>(
      `/api/v1/categories/${id}`,
      input,
    );
    return mapCategory(res.category);
  },

  async deleteCategory(id: string): Promise<void> {
    await apiClient.delete(`/api/v1/categories/${id}`);
  },
};
