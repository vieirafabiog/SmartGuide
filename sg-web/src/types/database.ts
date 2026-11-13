// ==============================================================================
// Single-Tenant Domain Types for Smart Guide (sg-web)
// ==============================================================================

export type SupportedLocale = 'pt-BR' | 'en' | 'es';

export type UserRole = 'admin' | 'creator' | 'user';

export type TrainingStatus = 'draft' | 'published' | 'archived';

export type AttachmentType = 'image' | 'video';

export type PermissionLevel = 'owner' | 'editor' | 'viewer';

export type ApiKeyScope = 'users:read' | 'users:write' | 'trainings:read';

export interface InstanceInfo {
  instanceUuid: string;
  name: string;
  logoUrl: string | null;
  defaultLocale: SupportedLocale;
  authProviders: {
    emailPassword: boolean;
    google: boolean;
    microsoft: boolean;
  };
  allowPublicSignup: boolean;
  licenseConfigured: boolean;
  licenseKeyHint: string | null;
}

export interface ApiKeySummary {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: ApiKeyScope[];
  isActive: boolean;
  createdBy: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface Profile {
  id: string;
  email: string;
  name: string;
  avatar_url?: string | null;
  role: UserRole;
  is_active: boolean;
  preferred_locale?: SupportedLocale;
  created_at?: string;
  updated_at?: string;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  icon?: string | null;
  created_at?: string;
}

export interface Training {
  id: string;
  title: string;
  description: string;
  cover_url?: string | null;
  status: TrainingStatus;
  is_public: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  categories?: Category[];
  total_steps?: number;
  user_progress?: number;
}

export interface TrainingStep {
  id: string;
  training_id: string;
  title: string;
  content: string;
  step_order: number;
  created_at?: string;
  updated_at?: string;
  attachments?: StepAttachment[];
}

export interface StepAttachment {
  id: string;
  step_id: string;
  file_name: string;
  storage_key?: string;
  file_url: string;
  file_type: AttachmentType;
  mime_type?: string;
  file_size?: number;
  att_order?: number;
  created_at?: string;
}

export interface TrainingPermission {
  id: string;
  training_id: string;
  user_id: string;
  permission: PermissionLevel;
  created_at?: string;
  user?: {
    name: string;
    email: string;
  };
}

export interface StepProgress {
  id: string;
  user_id: string;
  training_id: string;
  step_id: string;
  completed: boolean;
  completed_at?: string | null;
}
