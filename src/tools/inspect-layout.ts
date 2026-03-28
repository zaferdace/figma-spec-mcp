import { z } from "zod";
import { FigmaClient } from "../figma/client.js";
import { buildFreshness, SCHEMA_VERSION } from "../shared.js";
import type { FigmaNode, TypeStyle } from "../types/figma.js";
import type {
  InspectLayoutInput,
  InspectLayoutResult,
  NodeSummary,
  LayoutInfo,
  ConstraintInfo,
  AccessibilityWarning,
  TextRun,
  AnnotationInfo,
} from "../types/tools.js";
import { registerTool } from "./registry.js";

export const inspectLayoutSchema = z.object({
  file_key: z.string().describe("The Figma file key (from the file URL)"),
  node_id: z.string().describe("The node ID of the frame to inspect"),
  access_token: z.string().describe("Your Figma personal access token"),
  max_depth: z.number().optional().default(10),
  framework: z.enum(["web", "react", "unity", "swiftui"]).optional(),
});

function isLayoutNode(node: FigmaNode): boolean {
  return Boolean(node.layoutMode && node.layoutMode !== "NONE");
}

function collectTextRuns(node: FigmaNode): TextRun[] | undefined {
  if (node.type !== "TEXT" || !node.characters || !node.style) {
    return undefined;
  }

  const overrides = node.characterStyleOverrides;
  if (!overrides || overrides.length === 0 || overrides.every((value) => value === 0)) {
    return undefined;
  }

  const runs: TextRun[] = [];
  let startIndex = 0;
  let currentOverride = overrides[0] ?? 0;

  const buildStyle = (overrideIndex: number): Partial<TypeStyle> => {
    if (overrideIndex === 0) {
      return { ...node.style };
    }

    return { ...node.style, ...(node.styleOverrideTable?.[String(overrideIndex)] ?? {}) };
  };

  for (let index = 1; index <= node.characters.length; index += 1) {
    const nextOverride = overrides[index] ?? currentOverride;
    if (index === node.characters.length || nextOverride !== currentOverride) {
      runs.push({
        text: node.characters.slice(startIndex, index),
        style: buildStyle(currentOverride),
        startIndex,
        endIndex: index,
      });
      startIndex = index;
      currentOverride = nextOverride;
    }
  }

  return runs;
}

function getFrameworkHints(node: FigmaNode, framework: InspectLayoutInput["framework"]): Record<string, string> | undefined {
  if (!framework) {
    return undefined;
  }

  const hints: Record<string, string> = {};

  switch (framework) {
    case "unity":
      if (node.type === "TEXT") {
        hints["component"] = "TextMeshProUGUI";
      }
      if (node.type === "IMAGE") {
        hints["component"] = "Image component";
      }
      if (node.type === "FRAME" && isLayoutNode(node)) {
        hints["layout"] =
          node.layoutMode === "HORIZONTAL" ? "HorizontalLayoutGroup" : "VerticalLayoutGroup";
      }
      break;
    case "react":
      if (node.type === "TEXT") {
        hints["element"] = "<p>/<span>";
      }
      if (node.type === "FRAME" && isLayoutNode(node)) {
        hints["container"] = "flex container";
        hints["layout"] = "display: flex";
      }
      break;
    case "swiftui":
      if (node.type === "TEXT") {
        hints["view"] = "Text view";
      }
      if (node.type === "FRAME" && isLayoutNode(node)) {
        hints["layout"] = node.layoutMode === "HORIZONTAL" ? "HStack" : "VStack";
      }
      break;
    case "web":
      if (node.type === "TEXT") {
        hints["element"] = "<p>";
      }
      if (node.type === "FRAME") {
        hints["element"] = "<div>";
      }
      break;
  }

  return Object.keys(hints).length > 0 ? hints : undefined;
}

function walkHierarchy(
  node: FigmaNode,
  depth: number,
  maxDepth: number,
  framework: InspectLayoutInput["framework"],
  results: NodeSummary[],
  state: { truncatedAtDepth: boolean }
): void {
  const positioningMode =
    node.layoutMode && node.layoutMode !== "NONE" ? "auto-layout" : "absolute";

  results.push({
    id: node.id,
    name: node.name,
    type: node.type,
    depth,
    childCount: node.children?.length ?? 0,
    positioningMode,
    textRuns: collectTextRuns(node),
    frameworkHints: getFrameworkHints(node, framework),
  });

  if (depth >= maxDepth) {
    if ((node.children?.length ?? 0) > 0) {
      state.truncatedAtDepth = true;
    }
    return;
  }

  node.children?.forEach((child) => walkHierarchy(child, depth + 1, maxDepth, framework, results, state));
}

function collectAutoLayouts(
  node: FigmaNode,
  depth: number,
  maxDepth: number,
  results: LayoutInfo[],
  state: { truncatedAtDepth: boolean }
): void {
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

  if (depth >= maxDepth) {
    if ((node.children?.length ?? 0) > 0) {
      state.truncatedAtDepth = true;
    }
    return;
  }

  node.children?.forEach((child) => collectAutoLayouts(child, depth + 1, maxDepth, results, state));
}

function collectConstraints(
  node: FigmaNode,
  depth: number,
  maxDepth: number,
  results: ConstraintInfo[],
  state: { truncatedAtDepth: boolean }
): void {
  if (node.constraints && node.absoluteBoundingBox) {
    results.push({
      nodeId: node.id,
      nodeName: node.name,
      horizontal: node.constraints.horizontal,
      vertical: node.constraints.vertical,
      bounds: node.absoluteBoundingBox,
    });
  }

  if (depth >= maxDepth) {
    if ((node.children?.length ?? 0) > 0) {
      state.truncatedAtDepth = true;
    }
    return;
  }

  node.children?.forEach((child) => collectConstraints(child, depth + 1, maxDepth, results, state));
}

const MIN_FONT_SIZE_PX = 11;
const MIN_TOUCH_TARGET_PX = 44;

function collectAccessibilityWarnings(
  node: FigmaNode,
  depth: number,
  maxDepth: number,
  warnings: AccessibilityWarning[],
  state: { truncatedAtDepth: boolean }
): void {
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

  if (depth >= maxDepth) {
    if ((node.children?.length ?? 0) > 0) {
      state.truncatedAtDepth = true;
    }
    return;
  }

  node.children?.forEach((child) =>
    collectAccessibilityWarnings(child, depth + 1, maxDepth, warnings, state)
  );
}

function collectAnnotations(
  node: FigmaNode,
  depth: number,
  maxDepth: number,
  results: AnnotationInfo[],
  state: { truncatedAtDepth: boolean }
): void {
  for (const annotation of node.annotations ?? []) {
    results.push({
      nodeId: node.id,
      nodeName: node.name,
      label: annotation.label,
      properties: annotation.properties,
    });
  }

  if (depth >= maxDepth) {
    if ((node.children?.length ?? 0) > 0) {
      state.truncatedAtDepth = true;
    }
    return;
  }

  node.children?.forEach((child) => collectAnnotations(child, depth + 1, maxDepth, results, state));
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
  const maxDepth = input.max_depth ?? 10;
  const hierarchy: NodeSummary[] = [];
  const autoLayouts: LayoutInfo[] = [];
  const constraints: ConstraintInfo[] = [];
  const annotations: AnnotationInfo[] = [];
  const accessibilityWarnings: AccessibilityWarning[] = [];
  const state = { truncatedAtDepth: false };

  walkHierarchy(frame, 0, maxDepth, input.framework, hierarchy, state);
  collectAutoLayouts(frame, 0, maxDepth, autoLayouts, state);
  collectConstraints(frame, 0, maxDepth, constraints, state);
  collectAnnotations(frame, 0, maxDepth, annotations, state);
  collectAccessibilityWarnings(frame, 0, maxDepth, accessibilityWarnings, state);

  const autoLayoutNodeIds = new Set(autoLayouts.map((l) => l.nodeId));

  return {
    schema_version: SCHEMA_VERSION,
    source: { file_key: input.file_key, node_id: input.node_id },
    freshness: buildFreshness(response.cache),
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
      annotations,
      accessibilityWarnings,
      stats: {
        totalNodes: hierarchy.length,
        autoLayoutNodes: autoLayoutNodeIds.size,
        absoluteNodes: hierarchy.length - autoLayoutNodeIds.size,
        textNodeCount: hierarchy.filter((n) => n.type === "TEXT").length,
        truncatedAtDepth: state.truncatedAtDepth,
      },
      cache: response.cache,
    },
  };
}

registerTool({
  name: "inspect_layout",
  description:
    "Inspects a Figma frame and returns deterministic layout data: node hierarchy, auto-layout vs absolute positioning, spacing, padding, constraints, and accessibility warnings (touch targets, font sizes). Output is a versioned JSON envelope — stable and predictable for downstream tooling.",
  schema: inspectLayoutSchema,
  handler: inspectLayout,
});
