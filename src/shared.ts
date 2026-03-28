import type { CacheMetadata } from "./figma/client.js";

export const SCHEMA_VERSION = "0.1.0" as const;
export const SERVER_VERSION = "0.3.0";

export function buildFreshness(cache: CacheMetadata): { cached: boolean; timestamp: string; ttl_ms: number } {
  return {
    cached: cache.fresh,
    timestamp: cache.cachedAt,
    ttl_ms: new Date(cache.expiresAt).getTime() - new Date(cache.cachedAt).getTime(),
  };
}
