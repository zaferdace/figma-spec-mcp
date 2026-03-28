import { z } from "zod";
import { FigmaClient } from "../figma/client.js";
import type { FigmaNode, TypeStyle } from "../types/figma.js";
import type {
  ExtractVariantsInput,
  ExtractVariantsResult,
  VariantInfo,
} from "../types/tools.js";

export const extractVariantsSchema = z.object({
  file_key: z.string().describe("The Figma file key (from the file URL)"),
  access_token: z.string().describe("Your Figma personal access token"),
  node_id: z.string().describe("The COMPONENT_SET node ID to inspect"),
});

function parseVariantProperties(name: string): Record<string, string> {
  const entries: Array<[string, string]> = [];

  name
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.includes("="))
    .forEach((part) => {
      const [key, ...value] = part.split("=");
      const trimmedKey = (key ?? "").trim();
      if (trimmedKey.length > 0) {
        entries.push([trimmedKey, value.join("=").trim()]);
      }
    });

  return Object.fromEntries(entries);
}

function findFirstTextStyle(node: FigmaNode): Partial<TypeStyle> | undefined {
  if (node.type === "TEXT" && node.style) {
    return node.style;
  }

  for (const child of node.children ?? []) {
    const style = findFirstTextStyle(child);
    if (style) {
      return style;
    }
  }

  return undefined;
}

function buildVariantInfo(node: FigmaNode): VariantInfo {
  return {
    name: node.name,
    properties: parseVariantProperties(node.name),
    dimensions: {
      width: node.absoluteBoundingBox?.width ?? 0,
      height: node.absoluteBoundingBox?.height ?? 0,
    },
    layoutInfo: {
      layoutMode: node.layoutMode ?? "NONE",
      itemSpacing: node.itemSpacing ?? 0,
      padding: {
        top: node.paddingTop ?? 0,
        right: node.paddingRight ?? 0,
        bottom: node.paddingBottom ?? 0,
        left: node.paddingLeft ?? 0,
      },
    },
    styles: {
      fills: node.fills ?? [],
      typography: findFirstTextStyle(node),
    },
  };
}

export async function extractVariants(
  input: ExtractVariantsInput,
  clientOptions?: { ttlMs?: number; disableCache?: boolean }
): Promise<ExtractVariantsResult> {
  const client = new FigmaClient(input.access_token, clientOptions);
  const normalizedId = input.node_id.replace(/-/g, ":");
  const response = await client.getFileNodes(input.file_key, [normalizedId]);
  const componentSet = response.data.nodes[normalizedId]?.document;

  if (!componentSet) {
    throw new Error(`Node "${input.node_id}" not found in file "${input.file_key}"`);
  }

  if (componentSet.type !== "COMPONENT_SET") {
    throw new Error(`Node "${input.node_id}" is not a COMPONENT_SET`);
  }

  return {
    schema_version: "0.1.0",
    source: { file_key: input.file_key, node_id: input.node_id },
    freshness: {
      cached: response.cache.fresh,
      timestamp: response.cache.cachedAt,
      ttl_ms: new Date(response.cache.expiresAt).getTime() - new Date(response.cache.cachedAt).getTime(),
    },
    warnings: [],
    data: {
      componentSetName: componentSet.name,
      variants: (componentSet.children ?? []).map((child) => buildVariantInfo(child)),
      cache: response.cache,
    },
  };
}
