import { z } from "zod";
import { FigmaClient } from "../figma/client.js";
import type { FigmaNode } from "../types/figma.js";
import type {
  InspectLayoutInput,
  InspectLayoutResult,
  NodeSummary,
  LayoutInfo,
  ConstraintInfo,
  AccessibilityWarning,
} from "../types/tools.js";

export const inspectLayoutSchema = z.object({
  file_key: z.string().describe("The Figma file key (from the file URL)"),
  node_id: z.string().describe("The node ID of the frame to inspect"),
  access_token: z.string().describe("Your Figma personal access token"),
});

function walkHierarchy(node: FigmaNode, depth: number, results: NodeSummary[]): void {
  const positioningMode =
    node.layoutMode && node.layoutMode !== "NONE" ? "auto-layout" : "absolute";

  results.push({
    id: node.id,
    name: node.name,
    type: node.type,
    depth,
    childCount: node.children?.length ?? 0,
    positioningMode,
  });

  node.children?.forEach((child) => walkHierarchy(child, depth + 1, results));
}

function collectAutoLayouts(node: FigmaNode, results: LayoutInfo[]): void {
  if (node.layoutMode && node.layoutMode !== "NONE") {
    results.push({
      nodeId: node.id,
      nodeName: node.name,
      mode: node.layoutMode === "HORIZONTAL" ? "horizontal" : "vertical",
      primaryAxisAlign: node.primaryAxisAlignItems ?? "MIN",
      counterAxisAlign: node.counterAxisAlignItems ?? "MIN",
      padding: {
        top: node.paddingTop ?? 0,
        right: node.paddingRight ?? 0,
        bottom: node.paddingBottom ?? 0,
        left: node.paddingLeft ?? 0,
      },
      gap: node.itemSpacing ?? 0,
      sizing: {
        width: node.primaryAxisSizingMode === "AUTO" ? "hug" : "fixed",
        height: node.counterAxisSizingMode === "AUTO" ? "hug" : "fixed",
      },
    });
  }

  node.children?.forEach((child) => collectAutoLayouts(child, results));
}

function collectConstraints(node: FigmaNode, results: ConstraintInfo[]): void {
  if (node.constraints && node.absoluteBoundingBox) {
    results.push({
      nodeId: node.id,
      nodeName: node.name,
      horizontal: node.constraints.horizontal,
      vertical: node.constraints.vertical,
      bounds: node.absoluteBoundingBox,
    });
  }

  node.children?.forEach((child) => collectConstraints(child, results));
}

const MIN_FONT_SIZE_PX = 11;
const MIN_TOUCH_TARGET_PX = 44;

function collectAccessibilityWarnings(node: FigmaNode, warnings: AccessibilityWarning[]): void {
  if (node.type === "TEXT" && node.style) {
    const size = node.style.fontSize;
    if (size < MIN_FONT_SIZE_PX) {
      warnings.push({
        nodeId: node.id,
        nodeName: node.name,
        rule: "min-font-size",
        severity: "warning",
        message: `Font size ${size}px is below the recommended minimum of ${MIN_FONT_SIZE_PX}px.`,
        evidence: `fontSize=${size}`,
      });
    }
  }

  if (node.absoluteBoundingBox) {
    const { width, height } = node.absoluteBoundingBox;
    const isInteractiveType =
      node.type === "COMPONENT" || node.type === "INSTANCE" || node.type === "FRAME";

    if (isInteractiveType && (width < MIN_TOUCH_TARGET_PX || height < MIN_TOUCH_TARGET_PX)) {
      warnings.push({
        nodeId: node.id,
        nodeName: node.name,
        rule: "min-touch-target",
        severity: "warning",
        message: `Node is ${width}x${height}px — below the recommended ${MIN_TOUCH_TARGET_PX}px touch target minimum.`,
        evidence: `width=${width}, height=${height}`,
      });
    }
  }

  node.children?.forEach((child) => collectAccessibilityWarnings(child, warnings));
}

export async function inspectLayout(
  input: InspectLayoutInput,
  clientOptions?: { ttlMs?: number; disableCache?: boolean }
): Promise<InspectLayoutResult> {
  const client = new FigmaClient(input.access_token, clientOptions);
  const normalizedId = input.node_id.replace(/-/g, ":");
  const response = await client.getFileNodes(input.file_key, [normalizedId]);

  const nodeData = response.data.nodes[normalizedId];
  if (!nodeData) {
    throw new Error(`Node "${input.node_id}" not found in file "${input.file_key}"`);
  }

  const frame = nodeData.document;
  const hierarchy: NodeSummary[] = [];
  const autoLayouts: LayoutInfo[] = [];
  const constraints: ConstraintInfo[] = [];
  const accessibilityWarnings: AccessibilityWarning[] = [];

  walkHierarchy(frame, 0, hierarchy);
  collectAutoLayouts(frame, autoLayouts);
  collectConstraints(frame, constraints);
  collectAccessibilityWarnings(frame, accessibilityWarnings);

  const autoLayoutNodeIds = new Set(autoLayouts.map((l) => l.nodeId));

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
      frameId: frame.id,
      frameName: frame.name,
      dimensions: {
        width: frame.absoluteBoundingBox?.width ?? 0,
        height: frame.absoluteBoundingBox?.height ?? 0,
      },
      hierarchy,
      autoLayouts,
      constraints,
      accessibilityWarnings,
      stats: {
        totalNodes: hierarchy.length,
        autoLayoutNodes: autoLayoutNodeIds.size,
        absoluteNodes: hierarchy.length - autoLayoutNodeIds.size,
        textNodeCount: hierarchy.filter((n) => n.type === "TEXT").length,
      },
      cache: response.cache,
    },
  };
}
