import type { FigmaNode } from "../types/figma.js";

export function normalizeNodeId(nodeId: string): string {
  return nodeId.replaceAll("-", ":");
}

export function findNodeById(root: FigmaNode, nodeId: string): FigmaNode | null {
  const normalizedId = normalizeNodeId(nodeId);
  if (root.id === normalizedId) {
    return root;
  }

  for (const child of root.children ?? []) {
    const match = findNodeById(child, normalizedId);
    if (match) {
      return match;
    }
  }

  return null;
}

export function walkTree(
  node: FigmaNode,
  visitor: (node: FigmaNode, parent: FigmaNode | null, depth: number) => void,
  parent: FigmaNode | null = null,
  depth = 0
): void {
  visitor(node, parent, depth);
  node.children?.forEach((child) => walkTree(child, visitor, node, depth + 1));
}

export function isFrameLike(node: FigmaNode): boolean {
  return node.type === "FRAME" || node.type === "COMPONENT" || node.type === "COMPONENT_SET";
}
