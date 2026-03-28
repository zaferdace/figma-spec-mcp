import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { FigmaClient } from "../figma/client.js";
import type { FigmaNode } from "../types/figma.js";
import type {
  BridgeToCodebaseInput,
  BridgeToCodebaseResult,
  CodebaseMapping,
} from "../types/tools.js";

export const bridgeToCodebaseSchema = z.object({
  file_key: z.string().describe("The Figma file key (from the file URL)"),
  access_token: z.string().describe("Your Figma personal access token"),
  project_path: z.string().describe("Local project path to scan for matching component files"),
  file_extensions: z.array(z.string()).optional().default([".tsx", ".jsx", ".vue", ".svelte", ".cs"]),
});

function collectComponents(node: FigmaNode, results: Array<{ id: string; name: string }>): void {
  if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
    results.push({ id: node.id, name: node.name });
  }

  node.children?.forEach((child) => collectComponents(child, results));
}

function loadGitignorePatterns(projectPath: string): string[] {
  const gitignorePath = path.join(projectPath, ".gitignore");
  if (!existsSync(gitignorePath)) {
    return [];
  }

  return readFileSync(gitignorePath, "utf-8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function shouldIgnore(relativePath: string, patterns: string[]): boolean {
  const normalized = relativePath.split(path.sep).join("/");
  return patterns.some((pattern) => {
    const cleaned = pattern.replace(/\/$/u, "");
    if (cleaned.includes("*")) {
      const regex = new RegExp(
        `^${cleaned
          .split("*")
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
          .join(".*")}$`,
        "i"
      );
      return regex.test(normalized);
    }

    return normalized === cleaned || normalized.startsWith(`${cleaned}/`) || normalized.endsWith(`/${cleaned}`);
  });
}

function scanProjectFiles(projectPath: string, extensions: Set<string>, patterns: string[], results: string[], currentPath = projectPath): void {
  const entries = readdirSync(currentPath, { withFileTypes: true });

  entries.forEach((entry) => {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") {
      return;
    }

    const fullPath = path.join(currentPath, entry.name);
    const relativePath = path.relative(projectPath, fullPath);
    if (shouldIgnore(relativePath, patterns)) {
      return;
    }

    if (entry.isDirectory()) {
      scanProjectFiles(projectPath, extensions, patterns, results, fullPath);
      return;
    }

    if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
      results.push(fullPath);
    }
  });
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function emptyMatch(componentName: string): CodebaseMapping {
  return {
    figmaComponentName: componentName,
    figmaComponentId: "",
    matchedFile: null,
    matchType: "none",
    confidence: 0,
  };
}

function scoreMatch(componentName: string, filePath: string): CodebaseMapping {
  const fileName = path.basename(filePath, path.extname(filePath));
  const exactName = componentName;
  const normalizedComponent = normalizeName(componentName);
  const normalizedFile = normalizeName(fileName);

  if (fileName === exactName) {
    return {
      figmaComponentName: componentName,
      figmaComponentId: "",
      matchedFile: filePath,
      matchType: "exact",
      confidence: 1,
    };
  }

  if (fileName.toLowerCase() === exactName.toLowerCase()) {
    return {
      figmaComponentName: componentName,
      figmaComponentId: "",
      matchedFile: filePath,
      matchType: "case-insensitive",
      confidence: 0.9,
    };
  }

  if (
    normalizedComponent.includes(normalizedFile) ||
    normalizedFile.includes(normalizedComponent)
  ) {
    const ratio = Math.min(normalizedComponent.length, normalizedFile.length) /
      Math.max(normalizedComponent.length, normalizedFile.length);
    return {
      figmaComponentName: componentName,
      figmaComponentId: "",
      matchedFile: filePath,
      matchType: "partial",
      confidence: Number((0.5 + ratio * 0.3).toFixed(2)),
    };
  }

  return emptyMatch(componentName);
}

export async function bridgeToCodebase(
  input: BridgeToCodebaseInput,
  clientOptions?: { ttlMs?: number; disableCache?: boolean }
): Promise<BridgeToCodebaseResult> {
  const projectStats = statSync(input.project_path);
  if (!projectStats.isDirectory()) {
    throw new Error(`Project path "${input.project_path}" is not a directory`);
  }

  const client = new FigmaClient(input.access_token, clientOptions);
  const { data: file, cache } = await client.getFile(input.file_key);
  const components: Array<{ id: string; name: string }> = [];
  collectComponents(file.document, components);

  const extensions = new Set((input.file_extensions ?? [".tsx", ".jsx", ".vue", ".svelte", ".cs"]).map((ext) => ext.toLowerCase()));
  const projectFiles: string[] = [];
  scanProjectFiles(input.project_path, extensions, loadGitignorePatterns(input.project_path), projectFiles);

  const mappings: CodebaseMapping[] = components.map((component) => {
    let best = emptyMatch(component.name);

    projectFiles.forEach((filePath) => {
      const candidate = scoreMatch(component.name, filePath);
      if (candidate.confidence > best.confidence) {
        best = candidate;
      }
    });

    return {
      ...best,
      figmaComponentName: component.name,
      figmaComponentId: component.id,
    };
  });

  return {
    schema_version: "0.1.0",
    source: { file_key: input.file_key },
    freshness: {
      cached: cache.fresh,
      timestamp: cache.cachedAt,
      ttl_ms: new Date(cache.expiresAt).getTime() - new Date(cache.cachedAt).getTime(),
    },
    warnings: [],
    data: {
      mappings,
      cache,
    },
  };
}
