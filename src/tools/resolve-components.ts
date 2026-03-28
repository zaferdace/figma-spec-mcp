import { z } from "zod";
import { FigmaClient } from "../figma/client.js";
import { buildFreshness, SCHEMA_VERSION } from "../shared.js";
import type { ComponentMetadata, FigmaNode } from "../types/figma.js";
import type { ResolveComponentsInput, ResolveComponentsResult, ResolvedComponent } from "../types/tools.js";
import { registerTool } from "./registry.js";

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

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export async function resolveComponents(
  input: ResolveComponentsInput,
  clientOptions?: { ttlMs?: number; disableCache?: boolean }
): Promise<ResolveComponentsResult> {
  const client = new FigmaClient(input.access_token, clientOptions);
  const normalizedId = input.node_id?.replaceAll("-", ":");
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
  const uniqueComponentKeys = Array.from(
    new Set(
      instances
        .map((instance) => metadataById.get(instance.componentId)?.key)
        .filter((componentKey): componentKey is string => Boolean(componentKey))
    )
  );

  for (const keys of chunk(uniqueComponentKeys, 5)) {
    const results = await Promise.allSettled(keys.map((componentKey) => client.getComponent(componentKey)));
    results.forEach((result, index) => {
      const componentKey = keys[index];
      if (!componentKey) return;

      if (result.status === "fulfilled") {
        componentDetails.set(componentKey, {
          file_key: result.value.data.meta.file_key,
          node_id: result.value.data.meta.node_id,
        });
      } else {
        warnings.push(`Could not resolve component "${componentKey}" — may be from an external library.`);
      }
    });
  }

  for (const instance of instances) {
    const metadata = metadataById.get(instance.componentId);
    if (!metadata) {
      warnings.push(`Missing component metadata for instance "${instance.instanceNodeId}".`);
      continue;
    }

    const detail = componentDetails.get(metadata.key);
    if (!detail) {
      warnings.push(
        `Missing component detail for key "${metadata.key}" referenced by instance "${instance.instanceNodeId}".`
      );
      continue;
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
    schema_version: SCHEMA_VERSION,
    source: input.node_id ? { file_key: input.file_key, node_id: input.node_id } : { file_key: input.file_key },
    freshness: buildFreshness(cache),
    warnings,
    data: {
      components: resolved,
      cache,
    },
  };
}

registerTool({
  name: "resolve_components",
  description:
    "Scans a Figma subtree or full file for instances, resolves each unique component through the file component map and Figma component API, and returns the source file and node for each instance.",
  schema: resolveComponentsSchema,
  handler: resolveComponents,
});
