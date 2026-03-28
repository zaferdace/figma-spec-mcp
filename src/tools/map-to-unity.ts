import { z } from "zod";
import { FigmaClient } from "../figma/client.js";
import { buildFreshness, SCHEMA_VERSION } from "../shared.js";
import type { FigmaNode } from "../types/figma.js";
import type {
  MapToUnityInput,
  MapToUnityResult,
  UnityNode,
  UnityRectTransform,
  UnityLayoutGroup,
} from "../types/tools.js";

export const mapToUnitySchema = z.object({
  file_key: z.string().describe("The Figma file key (from the file URL)"),
  node_id: z.string().describe("The node ID of the frame to produce a Unity mapping spec for"),
  access_token: z.string().describe("Your Figma personal access token"),
  canvas_width: z.number().optional().default(1080).describe("Target Unity canvas width in pixels"),
  canvas_height: z.number().optional().default(1920).describe("Target Unity canvas height in pixels"),
});

const H_ANCHOR_MAP: Record<string, [number, number]> = {
  LEFT: [0, 0],
  RIGHT: [1, 1],
  CENTER: [0.5, 0.5],
  LEFT_RIGHT: [0, 1],
  SCALE: [0, 1],
};

const V_ANCHOR_MAP: Record<string, [number, number]> = {
  TOP: [1, 1],
  BOTTOM: [0, 0],
  CENTER: [0.5, 0.5],
  TOP_BOTTOM: [0, 1],
  SCALE: [0, 1],
};

function figmaConstraintsToAnchor(
  horizontal: string,
  vertical: string,
  warnings: string[],
  nodeName: string
): { anchorMin: { x: number; y: number }; anchorMax: { x: number; y: number } } {
  const hEntry = H_ANCHOR_MAP[horizontal];
  const vEntry = V_ANCHOR_MAP[vertical];

  if (!hEntry) warnings.push(`"${nodeName}": unknown horizontal constraint "${horizontal}" — defaulted to LEFT.`);
  if (!vEntry) warnings.push(`"${nodeName}": unknown vertical constraint "${vertical}" — defaulted to TOP.`);

  const [hMin, hMax] = hEntry ?? [0, 0];
  const [vMin, vMax] = vEntry ?? [1, 1];

  return {
    anchorMin: { x: hMin, y: vMin },
    anchorMax: { x: hMax, y: vMax },
  };
}

function buildRectTransform(
  node: FigmaNode,
  parentBounds: { x: number; y: number; width: number; height: number } | null,
  canvasWidth: number,
  canvasHeight: number,
  warnings: string[]
): UnityRectTransform {
  const bounds = node.absoluteBoundingBox ?? { x: 0, y: 0, width: 100, height: 100 };
  const horizontal = node.constraints?.horizontal ?? "LEFT";
  const vertical = node.constraints?.vertical ?? "TOP";
  const { anchorMin, anchorMax } = figmaConstraintsToAnchor(horizontal, vertical, warnings, node.name);

  const refWidth = parentBounds?.width ?? canvasWidth;
  const refHeight = parentBounds?.height ?? canvasHeight;
  const refX = parentBounds?.x ?? 0;
  const refY = parentBounds?.y ?? 0;

  const localX = bounds.x - refX;
  const localY = bounds.y - refY;

  const anchoredX = localX + bounds.width * 0.5 - anchorMin.x * refWidth;
  const anchoredY = -(localY + bounds.height * 0.5 - (1 - anchorMax.y) * refHeight);

  return {
    anchorMin,
    anchorMax,
    anchoredPosition: { x: Math.round(anchoredX), y: Math.round(anchoredY) },
    sizeDelta: { x: Math.round(bounds.width), y: Math.round(bounds.height) },
    pivot: { x: 0.5, y: 0.5 },
  };
}

function buildLayoutGroup(node: FigmaNode): UnityLayoutGroup | undefined {
  if (!node.layoutMode || node.layoutMode === "NONE") return undefined;

  const alignMap: Record<string, string> = {
    MIN: "UpperLeft",
    CENTER: "MiddleCenter",
    MAX: "LowerRight",
    SPACE_BETWEEN: "UpperLeft",
  };

  const isHorizontal = node.layoutMode === "HORIZONTAL";

  return {
    type: isHorizontal ? "HorizontalLayoutGroup" : "VerticalLayoutGroup",
    spacing: node.itemSpacing ?? 0,
    padding: {
      top: node.paddingTop ?? 0,
      right: node.paddingRight ?? 0,
      bottom: node.paddingBottom ?? 0,
      left: node.paddingLeft ?? 0,
    },
    childAlignment: alignMap[node.primaryAxisAlignItems ?? "MIN"] ?? "UpperLeft",
    // primaryAxis controls the layout direction; counterAxis controls the cross axis
    controlWidth: isHorizontal
      ? node.primaryAxisSizingMode === "AUTO"
      : node.counterAxisSizingMode === "AUTO",
    controlHeight: isHorizontal
      ? node.counterAxisSizingMode === "AUTO"
      : node.primaryAxisSizingMode === "AUTO",
  };
}

type ConfidenceLevel = "high" | "medium" | "low";

function inferComponents(node: FigmaNode): { components: string[]; confidence: ConfidenceLevel } {
  const components: string[] = ["RectTransform"];
  let confidence: ConfidenceLevel = "high";

  switch (node.type) {
    case "TEXT":
      components.push("TextMeshProUGUI");
      break;
    case "FRAME":
    case "COMPONENT":
    case "INSTANCE":
      if (node.fills && node.fills.length > 0) components.push("Image");
      if (node.layoutMode && node.layoutMode !== "NONE") {
        components.push(node.layoutMode === "HORIZONTAL" ? "HorizontalLayoutGroup" : "VerticalLayoutGroup");
      }
      break;
    case "RECTANGLE":
    case "ELLIPSE":
      components.push("Image");
      break;
    case "VECTOR":
    case "BOOLEAN_OPERATION":
      components.push("Image");
      confidence = "medium";
      break;
    default:
      confidence = "low";
  }

  return { components, confidence };
}

function mapNode(
  node: FigmaNode,
  parentBounds: { x: number; y: number; width: number; height: number } | null,
  canvasWidth: number,
  canvasHeight: number,
  notes: string[],
  warnings: string[]
): UnityNode {
  if (node.type === "VECTOR" || node.type === "BOOLEAN_OPERATION") {
    notes.push(`"${node.name}" (${node.type}) — export as sprite for Unity Image component.`);
  }

  if (node.effects && node.effects.length > 0) {
    const hasBlur = node.effects.some((e) => e.type === "LAYER_BLUR" || e.type === "BACKGROUND_BLUR");
    if (hasBlur) {
      warnings.push(`"${node.name}" has blur effects — Unity UGUI does not natively support blur.`);
    }
  }

  const rectTransform = buildRectTransform(node, parentBounds, canvasWidth, canvasHeight, warnings);
  const layoutGroup = buildLayoutGroup(node);
  const { components: suggestedComponents, confidence } = inferComponents(node);

  const children: UnityNode[] = (node.children ?? []).map((child) =>
    mapNode(child, node.absoluteBoundingBox ?? null, canvasWidth, canvasHeight, notes, warnings)
  );

  return {
    name: node.name,
    figmaId: node.id,
    figmaType: node.type,
    rectTransform,
    layoutGroup,
    suggestedComponents,
    confidence,
    children,
  };
}

export async function mapToUnity(
  input: MapToUnityInput,
  clientOptions?: { ttlMs?: number; disableCache?: boolean }
): Promise<MapToUnityResult> {
  const client = new FigmaClient(input.access_token, clientOptions);
  const normalizedId = input.node_id.replace(/-/g, ":");
  const response = await client.getFileNodes(input.file_key, [normalizedId]);

  const nodeData = response.data.nodes[normalizedId];
  if (!nodeData) {
    throw new Error(`Node "${input.node_id}" not found in file "${input.file_key}"`);
  }

  const canvasWidth = input.canvas_width ?? 1080;
  const canvasHeight = input.canvas_height ?? 1920;
  const notes: string[] = [];
  const warnings: string[] = [];

  const rootNode = mapNode(nodeData.document, null, canvasWidth, canvasHeight, notes, warnings);

  return {
    schema_version: SCHEMA_VERSION,
    source: { file_key: input.file_key, node_id: input.node_id },
    freshness: buildFreshness(response.cache),
    warnings,
    data: {
      rootNode,
      canvasSize: { width: canvasWidth, height: canvasHeight },
      notes,
      cache: response.cache,
    },
  };
}
