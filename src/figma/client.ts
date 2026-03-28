import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FigmaComponentResponse, FigmaFileResponse, FigmaNode } from "../types/figma.js";

const FIGMA_API_BASE = "https://api.figma.com/v1";
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CacheEntry<T> {
  data: T;
  cachedAt: number;
  expiresAt: number;
  fileVersion: string;
}

export interface CacheMetadata {
  cachedAt: string;
  expiresAt: string;
  fileVersion: string;
  fresh: boolean;
}

export interface CachedResult<T> {
  data: T;
  cache: CacheMetadata;
}

export interface FigmaClientOptions {
  ttlMs?: number;
  cacheDir?: string;
  disableCache?: boolean;
}

export class FigmaRateLimitError extends Error {
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super(`Figma API rate limited. Retry after ${retryAfterMs}ms`);
    this.name = "FigmaRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export class FigmaClient {
  private readonly accessToken: string;
  private readonly ttlMs: number;
  private readonly cacheDir: string;
  private readonly disableCache: boolean;

  constructor(accessToken: string, options: FigmaClientOptions = {}) {
    this.accessToken = accessToken;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.cacheDir = options.cacheDir ?? join(tmpdir(), "figma-spec-cache");
    this.disableCache = options.disableCache ?? false;

    if (!this.disableCache) {
      mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  private cacheKey(parts: string[]): string {
    return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
  }

  private cachePath(key: string): string {
    return join(this.cacheDir, `${key}.json`);
  }

  private getFileCacheKey(fileKey: string, version?: string): string {
    return this.cacheKey([fileKey, "file", version ?? "latest"]);
  }

  private getFileNodesCacheKey(fileKey: string, nodeIds: string[], fileVersion?: string): string {
    const sortedIds = [...nodeIds].sort((a, b) => a.localeCompare(b));
    return this.cacheKey([fileKey, ...sortedIds, fileVersion ?? "latest"]);
  }

  private getImagesCacheKey(
    fileKey: string,
    nodeIds: string[],
    format: "png" | "jpg" | "svg" | "pdf",
    scale: number
  ): string {
    const sortedIds = [...nodeIds].sort((a, b) => a.localeCompare(b));
    return this.cacheKey([fileKey, "images", format, String(scale), ...sortedIds]);
  }

  private readCache<T>(key: string): CacheEntry<T> | null {
    if (this.disableCache) return null;
    const path = this.cachePath(key);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, "utf-8")) as CacheEntry<T>;
    } catch {
      return null;
    }
  }

  private writeCache<T>(key: string, data: T, fileVersion: string): void {
    if (this.disableCache) return;
    const now = Date.now();
    const entry: CacheEntry<T> = {
      data,
      cachedAt: now,
      expiresAt: now + this.ttlMs,
      fileVersion,
    };
    writeFileSync(this.cachePath(key), JSON.stringify(entry));
  }

  invalidateCache(fileKey: string, nodeId?: string): void {
    if (this.disableCache) return;

    const key = nodeId ? this.getFileNodesCacheKey(fileKey, [nodeId]) : this.getFileCacheKey(fileKey);

    const path = this.cachePath(key);
    if (existsSync(path)) {
      unlinkSync(path);
    }
  }

  private buildCacheMetadata(entry: CacheEntry<unknown>): CacheMetadata {
    return {
      cachedAt: new Date(entry.cachedAt).toISOString(),
      expiresAt: new Date(entry.expiresAt).toISOString(),
      fileVersion: entry.fileVersion,
      fresh: Date.now() < entry.expiresAt,
    };
  }

  private buildFreshMetadata(fileVersion: string): CacheMetadata {
    const now = Date.now();
    return {
      cachedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.ttlMs).toISOString(),
      fileVersion,
      fresh: true,
    };
  }

  private async request<T>(path: string): Promise<T> {
    const response = await fetch(`${FIGMA_API_BASE}${path}`, {
      headers: { "X-Figma-Token": this.accessToken },
    });

    if (!response.ok) {
      if (response.status === 429) {
        const retryAfterHeader = response.headers.get("Retry-After");
        const retryAfterMs = this.parseRetryAfterMs(retryAfterHeader);
        throw new FigmaRateLimitError(retryAfterMs);
      }

      const body = await response.text();
      const sanitized = body.replaceAll(/figd_[A-Za-z0-9_-]+/g, "[REDACTED]");
      throw new Error(`Figma API error ${response.status}: ${sanitized}`);
    }

    return response.json() as Promise<T>;
  }

  private parseRetryAfterMs(retryAfterHeader: string | null): number {
    if (!retryAfterHeader) {
      return 1000;
    }

    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }

    const retryAt = Date.parse(retryAfterHeader);
    if (!Number.isNaN(retryAt)) {
      return Math.max(retryAt - Date.now(), 0);
    }

    return 1000;
  }

  async getFile(fileKey: string, version?: string): Promise<CachedResult<FigmaFileResponse>> {
    const key = this.getFileCacheKey(fileKey, version);
    const cached = this.readCache<FigmaFileResponse>(key);

    if (cached && Date.now() < cached.expiresAt) {
      return { data: cached.data, cache: this.buildCacheMetadata(cached) };
    }

    const params = version ? `?version=${encodeURIComponent(version)}` : "";
    const data = await this.request<FigmaFileResponse>(`/files/${fileKey}${params}`);
    this.writeCache(key, data, data.version);
    const entry = this.readCache<FigmaFileResponse>(key);
    const cache = entry ? this.buildCacheMetadata(entry) : this.buildFreshMetadata(data.version);
    return { data, cache };
  }

  async getFileNodes(
    fileKey: string,
    nodeIds: string[],
    fileVersion?: string
  ): Promise<CachedResult<{ nodes: Record<string, { document: FigmaNode } | null> }>> {
    const key = this.getFileNodesCacheKey(fileKey, nodeIds, fileVersion);
    const cached = this.readCache<{ nodes: Record<string, { document: FigmaNode } | null> }>(key);

    if (cached && Date.now() < cached.expiresAt) {
      return { data: cached.data, cache: this.buildCacheMetadata(cached) };
    }

    const ids = nodeIds.join(",");
    const versionParam = fileVersion ? `&version=${encodeURIComponent(fileVersion)}` : "";
    const data = await this.request<{ nodes: Record<string, { document: FigmaNode } | null> }>(
      `/files/${fileKey}/nodes?ids=${encodeURIComponent(ids)}${versionParam}`
    );

    const version = fileVersion ?? "unknown";
    this.writeCache(key, data, version);
    const entry = this.readCache<{ nodes: Record<string, { document: FigmaNode } | null> }>(key);
    const cache = entry ? this.buildCacheMetadata(entry) : this.buildFreshMetadata(version);
    return { data, cache };
  }

  async getStyles(fileKey: string): Promise<CachedResult<{ styles: Record<string, unknown> }>> {
    const key = this.cacheKey([fileKey, "styles"]);
    const cached = this.readCache<{ styles: Record<string, unknown> }>(key);

    if (cached && Date.now() < cached.expiresAt) {
      return { data: cached.data, cache: this.buildCacheMetadata(cached) };
    }

    const data = await this.request<{ styles: Record<string, unknown> }>(`/files/${fileKey}/styles`);
    this.writeCache(key, data, "unknown");
    const entry = this.readCache<{ styles: Record<string, unknown> }>(key);
    const cache = entry ? this.buildCacheMetadata(entry) : this.buildFreshMetadata("unknown");
    return { data, cache };
  }

  async getComponent(componentKey: string): Promise<CachedResult<FigmaComponentResponse>> {
    const key = this.cacheKey(["component", componentKey]);
    const cached = this.readCache<FigmaComponentResponse>(key);

    if (cached && Date.now() < cached.expiresAt) {
      return { data: cached.data, cache: this.buildCacheMetadata(cached) };
    }

    const data = await this.request<FigmaComponentResponse>(`/components/${componentKey}`);
    this.writeCache(key, data, "unknown");
    const entry = this.readCache<FigmaComponentResponse>(key);
    const cache = entry ? this.buildCacheMetadata(entry) : this.buildFreshMetadata("unknown");
    return { data, cache };
  }

  async getImages(
    fileKey: string,
    nodeIds: string[],
    format: "png" | "jpg" | "svg" | "pdf",
    scale: number
  ): Promise<CachedResult<{ images: Record<string, string | null> }>> {
    const key = this.getImagesCacheKey(fileKey, nodeIds, format, scale);
    const cached = this.readCache<{ images: Record<string, string | null> }>(key);

    if (cached && Date.now() < cached.expiresAt) {
      return { data: cached.data, cache: this.buildCacheMetadata(cached) };
    }

    const ids = nodeIds.join(",");
    const data = await this.request<{ images: Record<string, string | null> }>(
      `/images/${fileKey}?ids=${encodeURIComponent(ids)}&format=${encodeURIComponent(format)}&scale=${encodeURIComponent(String(scale))}`
    );

    this.writeCache(key, data, "unknown");
    const entry = this.readCache<{ images: Record<string, string | null> }>(key);
    const cache = entry ? this.buildCacheMetadata(entry) : this.buildFreshMetadata("unknown");
    return { data, cache };
  }
}
