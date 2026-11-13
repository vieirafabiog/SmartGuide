import type { InstanceInfo } from '@/types/database';

export interface LicenseCheckResult {
  allowed: boolean;
  reason?: string;
}

export type LicenseGateEvaluator = (
  instanceInfo: InstanceInfo,
) => Promise<LicenseCheckResult> | LicenseCheckResult;

let customEvaluator: LicenseGateEvaluator | null = null;

/**
 * Registers an optional custom mobile license evaluator at app startup.
 * Remains unset in the open-source distribution.
 */
export function setMobileLicenseGate(evaluator: LicenseGateEvaluator | null): void {
  customEvaluator = evaluator;
}

/**
 * Neutral pass-through hook for mobile BYOS server connections.
 * Always permits access in the open-source distribution.
 */
export async function checkMobileLicenseAccess(
  instanceInfo: InstanceInfo,
): Promise<LicenseCheckResult> {
  if (customEvaluator) {
    return customEvaluator(instanceInfo);
  }
  return { allowed: true };
}

