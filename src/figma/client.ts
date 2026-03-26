import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FigmaFileResponse, FigmaNode } from "../types/figma.js";

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
    const pattern = nodeId
      ? this.cacheKey([fileKey, nodeId])
      : this.cacheKey([fileKey]);

    const path = this.cachePath(pattern);
    if (existsSync(path)) {
      writeFileSync(path, "");
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

  private async request<T>(path: string): Promise<T> {
    const response = await fetch(`${FIGMA_API_BASE}${path}`, {
      headers: { "X-Figma-Token": this.accessToken },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Figma API error ${response.status}: ${body}`);
    }

    return response.json() as Promise<T>;
  }

  async getFile(fileKey: string): Promise<CachedResult<FigmaFileResponse>> {
    const key = this.cacheKey([fileKey, "file"]);
    const cached = this.readCache<FigmaFileResponse>(key);

    if (cached && Date.now() < cached.expiresAt) {
      return { data: cached.data, cache: this.buildCacheMetadata(cached) };
    }

    const data = await this.request<FigmaFileResponse>(`/files/${fileKey}`);
    this.writeCache(key, data, data.version);
    const entry = this.readCache<FigmaFileResponse>(key)!;
    return { data, cache: this.buildCacheMetadata(entry) };
  }

  async getFileNodes(
    fileKey: string,
    nodeIds: string[],
    fileVersion?: string
  ): Promise<CachedResult<{ nodes: Record<string, { document: FigmaNode }> }>> {
    const sortedIds = [...nodeIds].sort();
    const key = this.cacheKey([fileKey, ...sortedIds]);
    const cached = this.readCache<{ nodes: Record<string, { document: FigmaNode }> }>(key);

    if (cached && Date.now() < cached.expiresAt) {
      return { data: cached.data, cache: this.buildCacheMetadata(cached) };
    }

    const ids = nodeIds.join(",");
    const data = await this.request<{ nodes: Record<string, { document: FigmaNode }> }>(
      `/files/${fileKey}/nodes?ids=${encodeURIComponent(ids)}`
    );

    const version = fileVersion ?? "unknown";
    this.writeCache(key, data, version);
    const entry = this.readCache<{ nodes: Record<string, { document: FigmaNode }> }>(key)!;
    return { data, cache: this.buildCacheMetadata(entry) };
  }

  async getStyles(fileKey: string): Promise<CachedResult<{ styles: Record<string, unknown> }>> {
    const key = this.cacheKey([fileKey, "styles"]);
    const cached = this.readCache<{ styles: Record<string, unknown> }>(key);

    if (cached && Date.now() < cached.expiresAt) {
      return { data: cached.data, cache: this.buildCacheMetadata(cached) };
    }

    const data = await this.request<{ styles: Record<string, unknown> }>(`/files/${fileKey}/styles`);
    this.writeCache(key, data, "unknown");
    const entry = this.readCache<{ styles: Record<string, unknown> }>(key)!;
    return { data, cache: this.buildCacheMetadata(entry) };
  }
}
