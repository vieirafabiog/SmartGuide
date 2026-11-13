import type { PermissionLevel, TrainingStatus, UserRole } from '../db/schema/index.js';

export interface TrainingAccessSubject {
  createdBy: string;
  status: TrainingStatus;
  isPublic: boolean;
}

/**
 * Checks whether a user role satisfies at least one allowed role.
 */
export function hasRequiredRole(
  role: UserRole,
  allowedRoles: readonly UserRole[],
): boolean {
  return allowedRoles.includes(role);
}

/**
 * Only administrators can update instance settings, manage users, or issue API keys.
 */
export function canManageInstance(role: UserRole): boolean {
  return role === 'admin';
}

/**
 * Administrators and creators can create new trainings and manage categories.
 */
export function canCreateTraining(role: UserRole): boolean {
  return role === 'admin' || role === 'creator';
}

/**
 * Determines whether a user can read a training and its steps/attachments.
 */
export function canViewTraining(
  role: UserRole,
  userId: string,
  training: TrainingAccessSubject,
  permissionLevel: PermissionLevel | null,
): boolean {
  if (role === 'admin') return true;
  if (training.createdBy === userId) return true;
  if (permissionLevel !== null) return true;
  return training.status === 'published' && training.isPublic;
}

/**
 * Determines whether a user can modify training metadata, steps, or attachments.
 */
export function canEditTraining(
  role: UserRole,
  userId: string,
  training: Pick<TrainingAccessSubject, 'createdBy'>,
  permissionLevel: PermissionLevel | null,
): boolean {
  if (role === 'admin') return true;
  if (training.createdBy === userId && role === 'creator') return true;
  return permissionLevel === 'owner' || permissionLevel === 'editor';
}

/**
 * Determines whether a user can delete a training or manage its sharing permissions.
 */
export function canManageTrainingOwnership(
  role: UserRole,
  userId: string,
  training: Pick<TrainingAccessSubject, 'createdBy'>,
  permissionLevel: PermissionLevel | null,
): boolean {
  if (role === 'admin') return true;
  if (training.createdBy === userId && role === 'creator') return true;
  return permissionLevel === 'owner';
}
