// ==============================================================================
// Tipos de dados do Banco de Dados (Database Types)
// Mantido o mais simples e direto possível para fácil compreensão
// ==============================================================================

// Empresa cliente (Tenant)
export interface Company {
  id: string;
  name: string;
  slug: string;
  logo_url?: string | null;
  is_active: boolean;
  api_key?: string | null;
  created_at?: string;
  updated_at?: string;
}

// Chave de API corporativa para integrações externas
export interface ApiKey {
  id: string;
  company_id: string;
  name: string;
  key: string;
  is_active: boolean;
  created_by?: string | null;
  created_at?: string;
  last_used_at?: string | null;
}

// Papéis de usuário permitidos no sistema
export type UserRole = 'super_admin' | 'company_admin' | 'creator' | 'user';

// Perfil de usuário conectado ao Supabase Auth
export interface Profile {
  id: string; // mesmo ID do auth.users
  company_id: string | null;
  email: string;
  name: string;
  avatar_url?: string | null;
  role: UserRole;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

// Categoria de treinamento (exclusiva de cada empresa)
export interface Category {
  id: string;
  company_id: string;
  name: string;
  color: string;
  icon?: string | null;
  created_at?: string;
}

// Status do treinamento
export type TrainingStatus = 'draft' | 'published' | 'archived';

// Treinamento
export interface Training {
  id: string;
  company_id: string;
  title: string;
  description: string;
  cover_url?: string | null;
  status: TrainingStatus;
  is_public: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  // Campos auxiliares opcionais (carregados via joins)
  categories?: Category[];
  total_steps?: number;
  user_progress?: number; // porcentagem (0 a 100)
}

// Etapa do treinamento
export interface TrainingStep {
  id: string;
  training_id: string;
  title: string;
  content: string; // Conteúdo HTML simples do editor de texto rico
  step_order: number;
  created_at?: string;
  updated_at?: string;
  // Anexos da etapa
  attachments?: StepAttachment[];
}

// Tipo de arquivo em anexo
export type AttachmentType = 'image' | 'video' | 'document';

// Anexo de uma etapa
export interface StepAttachment {
  id: string;
  step_id: string;
  file_name: string;
  file_url: string;
  file_type: AttachmentType;
  file_size?: number;
  att_order?: number;
  created_at?: string;
}

// Níveis de permissão que um usuário pode ter em um treinamento
export type PermissionLevel = 'owner' | 'editor' | 'viewer';

// Permissão de acesso a um treinamento
export interface TrainingPermission {
  id: string;
  training_id: string;
  user_id: string;
  permission: PermissionLevel;
  created_at?: string;
  // Dados do usuário associado (quando carregado junto)
  user?: {
    name: string;
    email: string;
  };
}

// Progresso do usuário em cada etapa
export interface StepProgress {
  id: string;
  user_id: string;
  training_id: string;
  step_id: string;
  completed: boolean;
  completed_at?: string | null;
}
