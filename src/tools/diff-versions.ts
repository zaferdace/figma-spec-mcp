import { z } from "zod";
import { FigmaClient } from "../figma/client.js";
import { buildFreshness, SCHEMA_VERSION } from "../shared.js";
import type { FigmaNode } from "../types/figma.js";
import type { DiffVersionsInput, DiffVersionsResult, NodeChange } from "../types/tools.js";
import { registerTool } from "./registry.js";

export const diffVersionsSchema = z.object({
  file_key: z.string().describe("The Figma file key (from the file URL)"),
  access_token: z.string().describe("Your Figma personal access token"),
  version_a: z.string().describe("Base Figma file version"),
  version_b: z.string().describe("Target Figma file version"),
});

function indexNodes(node: FigmaNode, results: Map<string, FigmaNode>): void {
  results.set(node.id, node);
  node.children?.forEach((child) => indexNodes(child, results));
}

function stringify(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function getChanges(nodeA: FigmaNode, nodeB: FigmaNode): string[] {
  const changes: string[] = [];

  if (nodeA.name !== nodeB.name) changes.push("name");
  if (nodeA.type !== nodeB.type) changes.push("type");
  if (stringify(nodeA.absoluteBoundingBox) !== stringify(nodeB.absoluteBoundingBox)) {
    changes.push("absoluteBoundingBox");
  }
  if (stringify(nodeA.fills) !== stringify(nodeB.fills)) {
    changes.push("fills");
  }
  if (stringify(nodeA.characters) !== stringify(nodeB.characters)) {
    changes.push("characters");
  }
  if (stringify(nodeA.strokes) !== stringify(nodeB.strokes)) {
    changes.push("strokes");
  }
  if (stringify(nodeA.effects) !== stringify(nodeB.effects)) {
    changes.push("effects");
  }
  if (stringify(nodeA.opacity) !== stringify(nodeB.opacity)) {
    changes.push("opacity");
  }
  if (stringify(nodeA.cornerRadius) !== stringify(nodeB.cornerRadius)) {
    changes.push("cornerRadius");
  }
  if (stringify(nodeA.layoutMode) !== stringify(nodeB.layoutMode)) {
    changes.push("layoutMode");
  }
  if (stringify(nodeA.itemSpacing) !== stringify(nodeB.itemSpacing)) {
    changes.push("itemSpacing");
  }
  if (stringify(nodeA.paddingTop) !== stringify(nodeB.paddingTop)) {
    changes.push("paddingTop");
  }
  if (stringify(nodeA.paddingRight) !== stringify(nodeB.paddingRight)) {
    changes.push("paddingRight");
  }
  if (stringify(nodeA.paddingBottom) !== stringify(nodeB.paddingBottom)) {
    changes.push("paddingBottom");
  }
  if (stringify(nodeA.paddingLeft) !== stringify(nodeB.paddingLeft)) {
    changes.push("paddingLeft");
  }
  if (stringify(nodeA.styles) !== stringify(nodeB.styles) || stringify(nodeA.style) !== stringify(nodeB.style)) {
    changes.push("style");
  }

  return changes;
}

function toNodeChange(node: FigmaNode, changes?: string[]): NodeChange {
  return {
    nodeId: node.id,
    nodeName: node.name,
    nodeType: node.type,
    changes,
  };
}

export async function diffVersions(
  input: DiffVersionsInput,
  clientOptions?: { ttlMs?: number; disableCache?: boolean }
): Promise<DiffVersionsResult> {
  const client = new FigmaClient(input.access_token, clientOptions);
  const [versionAResponse, versionBResponse] = await Promise.all([
    client.getFile(input.file_key, input.version_a),
    client.getFile(input.file_key, input.version_b),
  ]);

  const nodesA = new Map<string, FigmaNode>();
  const nodesB = new Map<string, FigmaNode>();
  indexNodes(versionAResponse.data.document, nodesA);
  indexNodes(versionBResponse.data.document, nodesB);

  const added: NodeChange[] = [];
  const removed: NodeChange[] = [];
  const modified: NodeChange[] = [];

  nodesB.forEach((node, id) => {
    if (!nodesA.has(id)) {
      added.push(toNodeChange(node));
      return;
    }

    const original = nodesA.get(id);
    if (!original) return;
    const changes = getChanges(original, node);
    if (changes.length > 0) {
      modified.push(toNodeChange(node, changes));
    }
  });

  nodesA.forEach((node, id) => {
    if (!nodesB.has(id)) {
      removed.push(toNodeChange(node));
    }
  });

  return {
    schema_version: SCHEMA_VERSION,
    source: { file_key: input.file_key },
    freshness: {
      fresh: buildFreshness(versionAResponse.cache).fresh && buildFreshness(versionBResponse.cache).fresh,
      timestamp: versionBResponse.cache.cachedAt,
      ttl_ms: Math.min(buildFreshness(versionAResponse.cache).ttl_ms, buildFreshness(versionBResponse.cache).ttl_ms),
    },
    warnings: [],
    data: {
      added,
      removed,
      modified,
      cache: {
        versionA: versionAResponse.cache,
        versionB: versionBResponse.cache,
      },
    },
  };
}

registerTool({
  name: "diff_versions",
  description:
    "Fetches two Figma file versions and reports added, removed, and modified nodes by comparing names, types, geometry, fills, and style properties.",
  schema: diffVersionsSchema,
  handler: diffVersions,
});
