import { z } from "zod";
import { FigmaClient } from "../figma/client.js";
import type { ComponentMetadata, FigmaNode } from "../types/figma.js";
import type {
  ResolveComponentsInput,
  ResolveComponentsResult,
  ResolvedComponent,
} from "../types/tools.js";

export const resolveComponentsSchema = z.object({
  file_key: z.string().describe("The Figma file key (from the file URL)"),
  access_token: z.string().describe("Your Figma personal access token"),
  node_id: z.string().optional().describe("Optional node ID to limit the scan to a subtree"),
});

function collectInstances(node: FigmaNode, results: Array<{ instanceNodeId: string; componentId: string }>): void {
  if (node.type === "INSTANCE" && node.componentId) {
    results.push({ instanceNodeId: node.id, componentId: node.componentId });
  }

  node.children?.forEach((child) => collectInstances(child, results));
}

export async function resolveComponents(
  input: ResolveComponentsInput,
  clientOptions?: { ttlMs?: number; disableCache?: boolean }
): Promise<ResolveComponentsResult> {
  const client = new FigmaClient(input.access_token, clientOptions);
  const normalizedId = input.node_id?.replace(/-/g, ":");
  const fileResponse = await client.getFile(input.file_key);
  const nodeResponse = normalizedId
    ? await client.getFileNodes(input.file_key, [normalizedId], fileResponse.data.version)
    : undefined;
  const root = normalizedId ? nodeResponse?.data.nodes[normalizedId]?.document : fileResponse.data.document;

  if (!root) {
    throw new Error(`Node "${input.node_id}" not found in file "${input.file_key}"`);
  }

  const instances: Array<{ instanceNodeId: string; componentId: string }> = [];
  collectInstances(root, instances);

  const metadataById = new Map<string, ComponentMetadata>();
  Object.entries(fileResponse.data.components).forEach(([componentId, metadata]) => {
    metadataById.set(componentId, metadata);
  });

  const componentDetails = new Map<string, { file_key: string; node_id: string }>();
  const warnings: string[] = [];
  const resolved: ResolvedComponent[] = [];

  for (const instance of instances) {
    const metadata = metadataById.get(instance.componentId);
    if (!metadata) {
      warnings.push(`Missing component metadata for instance "${instance.instanceNodeId}".`);
      continue;
    }

    let detail = componentDetails.get(metadata.key);
    if (!detail) {
      const componentResponse = await client.getComponent(metadata.key);
      detail = {
        file_key: componentResponse.data.file_key,
        node_id: componentResponse.data.node_id,
      };
      componentDetails.set(metadata.key, detail);
    }

    resolved.push({
      instanceNodeId: instance.instanceNodeId,
      componentName: metadata.name,
      componentKey: metadata.key,
      sourceFileKey: detail.file_key,
      sourceNodeId: detail.node_id,
      description: metadata.description,
    });
  }

  const cache = fileResponse.cache;

  return {
    schema_version: "0.1.0",
    source: input.node_id ? { file_key: input.file_key, node_id: input.node_id } : { file_key: input.file_key },
    freshness: {
      cached: cache.fresh,
      timestamp: cache.cachedAt,
      ttl_ms: new Date(cache.expiresAt).getTime() - new Date(cache.cachedAt).getTime(),
    },
    warnings,
    data: {
      components: resolved,
      cache,
    },
  };
}
