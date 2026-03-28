import { z } from "zod";
import { FigmaClient } from "../figma/client.js";
import { buildFreshness, SCHEMA_VERSION } from "../shared.js";
import type { FigmaNode } from "../types/figma.js";
import type {
  ExtractFlowsInput,
  ExtractFlowsResult,
  FlowConnection,
} from "../types/tools.js";
import { registerTool } from "./registry.js";

export const extractFlowsSchema = z.object({
  file_key: z.string().describe("The Figma file key (from the file URL)"),
  access_token: z.string().describe("Your Figma personal access token"),
  node_id: z.string().describe("The page or top-level frame node ID to scan for flows"),
});

function buildNodeIndex(
  node: FigmaNode,
  parentFrame: FigmaNode | null,
  nodes: Map<string, FigmaNode>,
  frames: Map<string, FigmaNode>,
  nodeToFrame: Map<string, FigmaNode>
): void {
  nodes.set(node.id, node);
  const currentFrame =
    node.type === "FRAME" || node.type === "COMPONENT" || node.type === "COMPONENT_SET" ? node : parentFrame;

  if (currentFrame) {
    nodeToFrame.set(node.id, currentFrame);
    frames.set(currentFrame.id, currentFrame);
  }

  node.children?.forEach((child) => buildNodeIndex(child, currentFrame, nodes, frames, nodeToFrame));
}

function collectFlowEdges(
  node: FigmaNode,
  nodes: Map<string, FigmaNode>,
  nodeToFrame: Map<string, FigmaNode>,
  seen: Set<string>,
  flows: FlowConnection[],
  warnings: string[]
): void {
  if (node.transitionNodeID) {
    const fromFrame = nodeToFrame.get(node.id);
    const targetNode = nodes.get(node.transitionNodeID);
    const toFrame = targetNode ? nodeToFrame.get(targetNode.id) ?? targetNode : undefined;

    if (fromFrame) {
      const toNodeId = toFrame?.id ?? node.transitionNodeID;
      const toNodeName = toFrame?.name ?? "unknown (outside subtree)";
      const key = `${fromFrame.id}->${toNodeId}:${node.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        if (!toFrame) {
          warnings.push(`Flow target ${node.transitionNodeID} is outside the scanned subtree`);
        }
        flows.push({
          fromNodeId: fromFrame.id,
          fromNodeName: fromFrame.name,
          toNodeId,
          toNodeName,
          trigger: node.name,
          transitionType: node.transitionDuration !== undefined || node.transitionEasing ? "animated" : "instant",
        });
      }
    }
  }

  node.children?.forEach((child) => collectFlowEdges(child, nodes, nodeToFrame, seen, flows, warnings));
}

function topoSortFrameIds(frameIds: string[], flows: FlowConnection[]): string[] {
  const adjacency = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();

  frameIds.forEach((id) => {
    adjacency.set(id, new Set());
    inDegree.set(id, 0);
  });

  flows.forEach((flow) => {
    const targets = adjacency.get(flow.fromNodeId);
    if (targets && !targets.has(flow.toNodeId)) {
      targets.add(flow.toNodeId);
      inDegree.set(flow.toNodeId, (inDegree.get(flow.toNodeId) ?? 0) + 1);
    }
  });

  const queue = frameIds.filter((id) => (inDegree.get(id) ?? 0) === 0).sort();
  const order: string[] = [];
  const insertSorted = (value: string): void => {
    let index = queue.length;
    while (index > 0) {
      const previous = queue[index - 1];
      if (!previous || previous <= value) {
        break;
      }
      index -= 1;
    }
    queue.splice(index, 0, value);
  };

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    order.push(current);

    const targets = adjacency.get(current);
    targets?.forEach((target) => {
      const nextDegree = (inDegree.get(target) ?? 0) - 1;
      inDegree.set(target, nextDegree);
      if (nextDegree === 0) {
        insertSorted(target);
      }
    });
  }

  frameIds.forEach((id) => {
    if (!order.includes(id)) {
      order.push(id);
    }
  });

  return order;
}

export async function extractFlows(
  input: ExtractFlowsInput,
  clientOptions?: { ttlMs?: number; disableCache?: boolean }
): Promise<ExtractFlowsResult> {
  const client = new FigmaClient(input.access_token, clientOptions);
  const normalizedId = input.node_id.replace(/-/g, ":");
  const response = await client.getFileNodes(input.file_key, [normalizedId]);
  const root = response.data.nodes[normalizedId]?.document;

  if (!root) {
    throw new Error(`Node "${input.node_id}" not found in file "${input.file_key}"`);
  }

  const nodes = new Map<string, FigmaNode>();
  const frames = new Map<string, FigmaNode>();
  const nodeToFrame = new Map<string, FigmaNode>();
  buildNodeIndex(root, null, nodes, frames, nodeToFrame);

  const flows: FlowConnection[] = [];
  const warnings: string[] = [];
  collectFlowEdges(root, nodes, nodeToFrame, new Set<string>(), flows, warnings);

  return {
    schema_version: SCHEMA_VERSION,
    source: { file_key: input.file_key, node_id: input.node_id },
    freshness: buildFreshness(response.cache),
    warnings,
    data: {
      flows,
      flowOrder: topoSortFrameIds(Array.from(frames.keys()), flows),
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
