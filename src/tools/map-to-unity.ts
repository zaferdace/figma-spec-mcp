import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FigmaClient } from "../figma/client.js";
import { buildFreshness, SCHEMA_VERSION } from "../shared.js";
import type { FigmaNode } from "../types/figma.js";
import type {
  MapToUnityInput,
  MapToUnityResult,
  UnityNode,
  UnityRectTransform,
  UnityLayoutGroup,
  UnityExtractedText,
} from "../types/tools.js";
import { registerTool } from "./registry.js";

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
    controlWidth: isHorizontal ? node.primaryAxisSizingMode === "AUTO" : node.counterAxisSizingMode === "AUTO",
    controlHeight: isHorizontal ? node.counterAxisSizingMode === "AUTO" : node.primaryAxisSizingMode === "AUTO",
  };
}

type ConfidenceLevel = "high" | "medium" | "low";

interface GroupAsImageConfig {
  enabled: boolean;
  minNonTextChildren: number;
}

const GROUP_AS_IMAGE_DEFAULTS: GroupAsImageConfig = {
  enabled: true,
  minNonTextChildren: 1,
};

function loadGroupAsImageConfig(): GroupAsImageConfig {
  const configPath = resolve(process.cwd(), "figma-to-unity/config.json");

  if (!existsSync(configPath)) return GROUP_AS_IMAGE_DEFAULTS;

  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf-8")) as {
      groupAsImage?: Partial<GroupAsImageConfig>;
    };

    return {
      enabled: parsed.groupAsImage?.enabled ?? GROUP_AS_IMAGE_DEFAULTS.enabled,
      minNonTextChildren: parsed.groupAsImage?.minNonTextChildren ?? GROUP_AS_IMAGE_DEFAULTS.minNonTextChildren,
    };
  } catch {
    return GROUP_AS_IMAGE_DEFAULTS;
  }
}

const groupAsImageConfig = loadGroupAsImageConfig();

function inferComponents(
  node: FigmaNode,
  exportAsImage = false
): { components: string[]; confidence: ConfidenceLevel } {
  const components: string[] = ["RectTransform"];
  let confidence: ConfidenceLevel = "high";

  if (exportAsImage) {
    components.push("Image");
    return { components, confidence };
  }

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

function clampColorChannel(value: number | undefined): number {
  return Math.max(0, Math.min(255, Math.round((value ?? 0) * 255)));
}

function toHex(value: number): string {
  return value.toString(16).padStart(2, "0").toUpperCase();
}

function getTextColor(node: FigmaNode): string {
  const solidFill = node.fills?.find((fill) => fill.visible !== false && fill.type === "SOLID" && fill.color);

  if (!solidFill?.color) return "#000000";

  const alpha = solidFill.opacity ?? solidFill.color.a ?? 1;
  const hex = `#${toHex(clampColorChannel(solidFill.color.r))}${toHex(clampColorChannel(solidFill.color.g))}${toHex(
    clampColorChannel(solidFill.color.b)
  )}`;

  return alpha >= 1 ? hex : `${hex}${toHex(Math.max(0, Math.min(255, Math.round(alpha * 255))))}`;
}

function extractText(
  node: FigmaNode,
  parentBounds: { x: number; y: number; width: number; height: number }
): UnityExtractedText {
  const bounds = node.absoluteBoundingBox ?? { x: parentBounds.x, y: parentBounds.y, width: 0, height: 0 };

  return {
    name: node.name,
    content: node.characters ?? "",
    position: {
      x: Math.round(bounds.x - parentBounds.x),
      y: Math.round(bounds.y - parentBounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    },
    fontSize: Math.round(node.style?.fontSize ?? 16),
    fontFamily: node.style?.fontFamily ?? "Arial",
    fontWeight: node.style?.fontWeight ?? 400,
    color: getTextColor(node),
    alignment: {
      horizontal: (node.style?.textAlignHorizontal ?? "LEFT").toLowerCase(),
      vertical: (node.style?.textAlignVertical ?? "TOP").toLowerCase(),
    },
  };
}

function shouldExportGroupAsImage(node: FigmaNode): boolean {
  if (!groupAsImageConfig.enabled) return false;
  if (node.type !== "GROUP" && node.type !== "FRAME") return false;
  if (node.layoutMode && node.layoutMode !== "NONE") return false;

  const visibleChildren = (node.children ?? []).filter((child) => child.visible !== false);
  const textChildren = visibleChildren.filter((child) => child.type === "TEXT");
  const nonTextChildren = visibleChildren.filter((child) => child.type !== "TEXT");

  return textChildren.length > 0 && nonTextChildren.length >= groupAsImageConfig.minNonTextChildren;
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

  const exportAsImage = shouldExportGroupAsImage(node);
  const rectTransform = buildRectTransform(node, parentBounds, canvasWidth, canvasHeight, warnings);
  const layoutGroup = buildLayoutGroup(node);
  const { components: suggestedComponents, confidence } = inferComponents(node, exportAsImage);

  if (exportAsImage) {
    notes.push(
      `"${node.name}" (${node.type}) — export as a single PNG and recreate direct text children as TextMeshProUGUI.`
    );
  }

  const textChildren = exportAsImage
    ? (node.children ?? []).filter((child) => child.visible !== false && child.type === "TEXT")
    : [];
  const extractedTexts =
    exportAsImage && node.absoluteBoundingBox
      ? textChildren.map((child) =>
          extractText(child, node.absoluteBoundingBox as NonNullable<FigmaNode["absoluteBoundingBox"]>)
        )
      : undefined;

  const childNodes = exportAsImage ? textChildren : (node.children ?? []);
  const children: UnityNode[] = childNodes.map((child) =>
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
    exportAsImage: exportAsImage || undefined,
    extractedTexts,
    children,
  };
}

export async function mapToUnity(
  input: MapToUnityInput,
  clientOptions?: { ttlMs?: number; disableCache?: boolean }
): Promise<MapToUnityResult> {
  const client = new FigmaClient(input.access_token, clientOptions);
  const normalizedId = input.node_id.replaceAll("-", ":");
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

registerTool({
  name: "map_to_unity",
  description:
    "Produces a Unity UGUI mapping spec from a Figma frame. Maps Figma constraints to RectTransform anchors, auto-layout to HorizontalLayoutGroup/VerticalLayoutGroup, and suggests appropriate Unity components per node type. Includes confidence scores for inferred components and warnings for unknown constraints or unsupported effects.",
  schema: mapToUnitySchema,
  handler: mapToUnity,
});
