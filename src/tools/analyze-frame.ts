import { z } from "zod";
import { FigmaClient } from "../figma/client.js";
import type { FigmaNode } from "../types/figma.js";
import type {
  AnalyzeFrameInput,
  AnalyzeFrameResult,
  ComponentInfo,
  LayoutInfo,
  ConstraintInfo,
  AccessibilityWarning,
} from "../types/tools.js";

export const analyzeFrameSchema = z.object({
  file_key: z.string().describe("The Figma file key (from the file URL)"),
  node_id: z.string().describe("The node ID of the frame to analyze"),
  access_token: z.string().describe("Your Figma personal access token"),
});

function collectComponents(node: FigmaNode, results: ComponentInfo[]): void {
  const isComponent = node.type === "COMPONENT" || node.type === "COMPONENT_SET";
  const isInstance = node.type === "INSTANCE";

  if (isComponent || isInstance) {
    results.push({
      id: node.id,
      name: node.name,
      type: node.type,
      isComponent,
      isInstance,
    });
  }

  node.children?.forEach((child) => collectComponents(child, results));
}

function collectLayouts(node: FigmaNode, results: Record<string, LayoutInfo>): void {
  if (node.layoutMode && node.layoutMode !== "NONE") {
    results[node.id] = {
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
    };
  }

  node.children?.forEach((child) => collectLayouts(child, results));
}

function collectConstraints(node: FigmaNode, results: Record<string, ConstraintInfo>): void {
  if (node.constraints && node.absoluteBoundingBox) {
    results[node.id] = {
      horizontal: node.constraints.horizontal,
      vertical: node.constraints.vertical,
      bounds: node.absoluteBoundingBox,
    };
  }

  node.children?.forEach((child) => collectConstraints(child, results));
}

function collectAccessibilityWarnings(node: FigmaNode, warnings: AccessibilityWarning[]): void {
  if (node.type === "TEXT" && node.style) {
    if (node.style.fontSize < 12) {
      warnings.push({
        nodeId: node.id,
        nodeName: node.name,
        severity: "warning",
        message: `Text node "${node.name}" has a font size of ${node.style.fontSize}px, which may be too small for accessibility.`,
      });
    }
  }

  if (node.fills && node.fills.length === 0 && node.type === "FRAME") {
    warnings.push({
      nodeId: node.id,
      nodeName: node.name,
      severity: "info",
      message: `Frame "${node.name}" has no background fill — ensure this is intentional.`,
    });
  }

  node.children?.forEach((child) => collectAccessibilityWarnings(child, warnings));
}

function countNodesByType(node: FigmaNode, counts: Record<string, number>): void {
  counts[node.type] = (counts[node.type] ?? 0) + 1;
  node.children?.forEach((child) => countNodesByType(child, counts));
}

export async function analyzeFrame(input: AnalyzeFrameInput): Promise<AnalyzeFrameResult> {
  const client = new FigmaClient(input.access_token);
  const normalizedId = input.node_id.replace("-", ":");
  const response = await client.getFileNodes(input.file_key, [normalizedId]);

  const nodeData = response.nodes[normalizedId];
  if (!nodeData) {
    throw new Error(`Node "${input.node_id}" not found in file "${input.file_key}"`);
  }

  const frame = nodeData.document;
  const components: ComponentInfo[] = [];
  const layouts: Record<string, LayoutInfo> = {};
  const constraints: Record<string, ConstraintInfo> = {};
  const accessibilityWarnings: AccessibilityWarning[] = [];
  const typeCounts: Record<string, number> = {};

  collectComponents(frame, components);
  collectLayouts(frame, layouts);
  collectConstraints(frame, constraints);
  collectAccessibilityWarnings(frame, accessibilityWarnings);
  countNodesByType(frame, typeCounts);

  return {
    frameId: frame.id,
    frameName: frame.name,
    dimensions: {
      width: frame.absoluteBoundingBox?.width ?? 0,
      height: frame.absoluteBoundingBox?.height ?? 0,
    },
    components,
    layouts,
    constraints,
    accessibilityWarnings,
    stats: {
      totalNodes: Object.values(typeCounts).reduce((a, b) => a + b, 0),
      componentCount: components.filter((c) => c.isComponent).length,
      instanceCount: components.filter((c) => c.isInstance).length,
      textNodeCount: typeCounts["TEXT"] ?? 0,
      imageNodeCount: typeCounts["RECTANGLE"] ?? 0,
    },
  };
}
