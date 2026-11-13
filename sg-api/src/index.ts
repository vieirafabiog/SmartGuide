export interface RuntimeInfo {
  readonly service: 'sg-api';
  readonly nodeVersion: string;
}

/**
 * Returns basic runtime metadata for sg-api.
 */
export function getRuntimeInfo(): RuntimeInfo {
  return {
    service: 'sg-api',
    nodeVersion: process.version,
  };
}

