import { z } from "zod";
import { FigmaClient } from "../figma/client.js";
import { buildFreshness, SCHEMA_VERSION } from "../shared.js";
import type { FlowToTestCasesInput, FlowToTestCasesResult } from "../types/tools.js";
import { buildFlowGraph } from "./flow-graph.js";
import { findNodeById } from "./figma-tree.js";
import { registerTool } from "./registry.js";

export const flowToTestCasesSchema = z.object({
  file_key: z.string().describe("The Figma file key (from the file URL)"),
  node_id: z.string().describe("The page or frame node ID to scan for prototype flows"),
  access_token: z.string().describe("Your Figma personal access token"),
});

export async function flowToTestCases(
  input: FlowToTestCasesInput,
  clientOptions?: { ttlMs?: number; disableCache?: boolean }
): Promise<FlowToTestCasesResult> {
  const client = new FigmaClient(input.access_token, clientOptions);
  const response = await client.getFile(input.file_key);
  const root = findNodeById(response.data.document, input.node_id);

  if (!root) {
    throw new Error(`Node "${input.node_id}" not found in file "${input.file_key}"`);
  }

  const graph = buildFlowGraph(root);
  const outgoing = new Map<string, number>();
  const incoming = new Map<string, number>();

  graph.frameIds.forEach((frameId) => {
    outgoing.set(frameId, 0);
    incoming.set(frameId, 0);
  });

  graph.flows.forEach((flow) => {
    outgoing.set(flow.fromNodeId, (outgoing.get(flow.fromNodeId) ?? 0) + 1);
    incoming.set(flow.toNodeId, (incoming.get(flow.toNodeId) ?? 0) + 1);
  });

  const deadEnds = graph.frameIds.filter((frameId) => (outgoing.get(frameId) ?? 0) === 0);
  const orphans = graph.frameIds.filter((frameId) => (incoming.get(frameId) ?? 0) === 0);

  return {
    schema_version: SCHEMA_VERSION,
    source: { file_key: input.file_key, node_id: input.node_id },
    freshness: buildFreshness(response.cache),
    warnings: graph.warnings,
    data: {
      testCases: graph.flows.map((flow) => ({
        title: `Navigate from ${flow.fromNodeName} to ${flow.toNodeName} via ${flow.trigger}`,
        preconditions: `User is on ${flow.fromNodeName} screen`,
        steps: [`1. Interact with ${flow.trigger} element`],
        expected: `${flow.toNodeName} screen is displayed`,
      })),
      edgeCaseGaps: [
        ...deadEnds.map((frameId) => `Dead end: ${graph.frameNames[frameId] ?? frameId} has no navigation`),
        ...orphans.map((frameId) => `Orphan: ${graph.frameNames[frameId] ?? frameId} is not reachable`),
      ],
      flowCoverage: {
        totalFrames: graph.frameIds.length,
        connectedFrames: new Set(graph.flows.flatMap((flow) => [flow.fromNodeId, flow.toNodeId])).size,
        deadEnds: deadEnds.length,
        orphans: orphans.length,
      },
      cache: response.cache,
    },
  };
}

registerTool({
  name: "flow_to_test_cases",
  description:
    "Converts Figma prototype transitions into deterministic navigation test cases and reports dead ends, unreachable screens, and basic flow coverage.",
  schema: flowToTestCasesSchema,
  handler: flowToTestCases,
});
