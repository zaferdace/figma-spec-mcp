import { z } from "zod";
import { FigmaClient } from "../figma/client.js";
import { buildFreshness, SCHEMA_VERSION } from "../shared.js";
import type { ExtractFlowsInput, ExtractFlowsResult } from "../types/tools.js";
import { buildFlowGraph, topoSortFrameIds } from "./flow-graph.js";
import { normalizeNodeId } from "./figma-tree.js";
import { registerTool } from "./registry.js";

export const extractFlowsSchema = z.object({
  file_key: z.string().describe("The Figma file key (from the file URL)"),
  access_token: z.string().describe("Your Figma personal access token"),
  node_id: z.string().describe("The page or top-level frame node ID to scan for flows"),
});

export async function extractFlows(
  input: ExtractFlowsInput,
  clientOptions?: { ttlMs?: number; disableCache?: boolean }
): Promise<ExtractFlowsResult> {
  const client = new FigmaClient(input.access_token, clientOptions);
  const normalizedId = normalizeNodeId(input.node_id);
  const response = await client.getFileNodes(input.file_key, [normalizedId]);
  const root = response.data.nodes[normalizedId]?.document;

  if (!root) {
    throw new Error(`Node "${input.node_id}" not found in file "${input.file_key}"`);
  }

  const graph = buildFlowGraph(root);

  return {
    schema_version: SCHEMA_VERSION,
    source: { file_key: input.file_key, node_id: input.node_id },
    freshness: buildFreshness(response.cache),
    warnings: graph.warnings,
    data: {
      flows: graph.flows,
      flowOrder: topoSortFrameIds(graph.frameIds, graph.flows),
      cache: response.cache,
    },
  };
}

registerTool({
  name: "extract_flows",
  description:
    "Extracts prototype flows from a page or frame by finding transition links in the node tree, then returns directed frame-to-frame connections and a deterministic traversal order.",
  schema: extractFlowsSchema,
  handler: extractFlows,
});
