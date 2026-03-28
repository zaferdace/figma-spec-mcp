import type { FigmaNode } from "../types/figma.js";
import type { FlowConnection } from "../types/tools.js";
import { isFrameLike } from "./figma-tree.js";

export interface FlowGraph {
  flows: FlowConnection[];
  frameIds: string[];
  frameNames: Record<string, string>;
  warnings: string[];
}

function buildNodeIndex(
  node: FigmaNode,
  parentFrame: FigmaNode | null,
  nodes: Map<string, FigmaNode>,
  frames: Map<string, FigmaNode>,
  nodeToFrame: Map<string, FigmaNode>
): void {
  nodes.set(node.id, node);
  const currentFrame = isFrameLike(node) ? node : parentFrame;

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
    const toFrame = targetNode ? (nodeToFrame.get(targetNode.id) ?? targetNode) : undefined;

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

export function buildFlowGraph(root: FigmaNode): FlowGraph {
  const nodes = new Map<string, FigmaNode>();
  const frames = new Map<string, FigmaNode>();
  const nodeToFrame = new Map<string, FigmaNode>();
  buildNodeIndex(root, null, nodes, frames, nodeToFrame);

  const flows: FlowConnection[] = [];
  const warnings: string[] = [];
  collectFlowEdges(root, nodes, nodeToFrame, new Set<string>(), flows, warnings);

  return {
    flows,
    frameIds: Array.from(frames.keys()),
    frameNames: Object.fromEntries(Array.from(frames.entries()).map(([id, frame]) => [id, frame.name])),
    warnings,
  };
}

export function topoSortFrameIds(frameIds: string[], flows: FlowConnection[]): string[] {
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

  const queue = frameIds.filter((id) => (inDegree.get(id) ?? 0) === 0).sort((a, b) => a.localeCompare(b));
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
    if (!current) {
      break;
    }
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
