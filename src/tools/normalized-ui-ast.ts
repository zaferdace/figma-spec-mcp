import type { Color, FigmaNode, Paint, TypeStyle } from "../types/figma.js";

export interface NormalizedUINode {
  name: string;
  figmaId: string;
  figmaType: string;
  semantic: "container" | "text" | "image" | "icon" | "button" | "input" | "divider" | "unknown";
  layout: {
    direction: "row" | "column" | "none";
    gap: number;
    padding: { top: number; right: number; bottom: number; left: number };
    mainAxisAlignment: "start" | "center" | "end" | "space-between";
    crossAxisAlignment: "start" | "center" | "end" | "stretch";
    wrap: boolean;
  };
  sizing: {
    width: number | null;
    height: number | null;
    widthMode: "fixed" | "hug" | "fill";
    heightMode: "fixed" | "hug" | "fill";
    minWidth?: number;
    maxWidth?: number;
  };
  fills: Array<{
    type: "solid" | "gradient" | "image";
    color?: string;
    opacity?: number;
    gradientStops?: Array<{ color: string; position: number }>;
  }>;
  strokes: Array<{
    color: string;
    weight: number;
  }>;
  cornerRadius: number | { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number };
  opacity: number;
  effects: Array<{
    type: "drop-shadow" | "inner-shadow" | "blur";
    color?: string;
    offset?: { x: number; y: number };
    radius: number;
    spread?: number;
  }>;
  typography?: {
    content: string;
    fontFamily: string;
    fontSize: number;
    fontWeight: number;
    lineHeight: number | "auto";
    letterSpacing: number;
    textAlign: "left" | "center" | "right" | "justify";
    textDecoration: "none" | "underline" | "line-through";
    color: string;
  };
  componentInfo?: {
    isInstance: boolean;
    componentName?: string;
    variantProperties?: Record<string, string>;
  };
  children: NormalizedUINode[];
}

type ExtendedComponentProperty = {
  type?: string;
  value?: string | boolean;
  preferredValues?: Array<{ name: string; value: string }>;
};

type ExtendedFigmaNode = FigmaNode & {
  layoutSizingHorizontal?: "FIXED" | "HUG" | "FILL";
  layoutSizingVertical?: "FIXED" | "HUG" | "FILL";
  minWidth?: number;
  maxWidth?: number;
  strokeWeight?: number;
  rectangleCornerRadii?: [number, number, number, number];
  layoutWrap?: "NO_WRAP" | "WRAP";
  componentProperties?: Record<string, ExtendedComponentProperty>;
};

function getExtendedNode(node: FigmaNode): ExtendedFigmaNode {
  return node as ExtendedFigmaNode;
}

export function rgbaToHex(color: { r: number; g: number; b: number; a?: number }, opacity?: number): string {
  const red = Math.round((color.r ?? 0) * 255);
  const green = Math.round((color.g ?? 0) * 255);
  const blue = Math.round((color.b ?? 0) * 255);
  const alpha = Math.round(((color.a ?? 1) * (opacity ?? 1) || 0) * 255);

  return `#${[red, green, blue, alpha]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

function parseVariantPropertiesFromName(name: string): Record<string, string> {
  return Object.fromEntries(
    name
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.includes("="))
      .map((part) => {
        const [key, ...rest] = part.split("=");
        return [(key ?? "").trim(), rest.join("=").trim()] as const;
      })
      .filter(([key]) => key.length > 0)
  );
}

function extractVariantProperties(node: ExtendedFigmaNode): Record<string, string> | undefined {
  const parsedProperties = Object.entries(node.componentProperties ?? {})
    .map(([rawKey, property]) => {
      const key = rawKey.split("#")[0]?.trim() ?? rawKey.trim();
      const value = typeof property?.value === "string" ? property.value : undefined;
      return key.length > 0 && value ? ([key, value] as const) : undefined;
    })
    .filter((entry): entry is readonly [string, string] => Boolean(entry));

  if (parsedProperties.length > 0) {
    return Object.fromEntries(parsedProperties);
  }

  const fromName = parseVariantPropertiesFromName(node.name);
  return Object.keys(fromName).length > 0 ? fromName : undefined;
}

function hasImageFill(node: FigmaNode): boolean {
  return (node.fills ?? []).some((fill) => fill.visible !== false && fill.type === "IMAGE");
}

function isThinDivider(node: FigmaNode): boolean {
  const width = node.absoluteBoundingBox?.width ?? 0;
  const height = node.absoluteBoundingBox?.height ?? 0;
  return width < 4 || height < 4;
}

function hasTextChild(node: FigmaNode): boolean {
  return (node.children ?? []).some((child) => child.type === "TEXT");
}

function hasVisibleFill(node: FigmaNode): boolean {
  return (node.fills ?? []).some((fill) => fill.visible !== false);
}

export function inferSemantic(node: FigmaNode): NormalizedUINode["semantic"] {
  const lowerName = node.name.toLowerCase();
  const width = node.absoluteBoundingBox?.width ?? 0;
  const height = node.absoluteBoundingBox?.height ?? 0;

  if (node.type === "TEXT") return "text";

  if (node.type === "VECTOR" || node.type === "BOOLEAN_OPERATION") {
    return width < 48 && height < 48 ? "icon" : "image";
  }

  if (node.type === "RECTANGLE" || node.type === "ELLIPSE") {
    if (hasImageFill(node)) return "image";
    if (isThinDivider(node)) return "divider";
    return "container";
  }

  if (node.type === "FRAME" || node.type === "COMPONENT" || node.type === "INSTANCE") {
    if (/input|field|textfield|search/i.test(lowerName)) {
      return "input";
    }

    if (
      /button|btn|cta/i.test(lowerName) ||
      (width <= 320 && height <= 80 && hasTextChild(node) && hasVisibleFill(node))
    ) {
      return "button";
    }

    return "container";
  }

  return "unknown";
}

export function mapAlignment(figmaValue: string | undefined): "start" | "center" | "end" | "space-between" | "stretch" {
  switch (figmaValue) {
    case "MIN":
      return "start";
    case "CENTER":
      return "center";
    case "MAX":
      return "end";
    case "SPACE_BETWEEN":
      return "space-between";
    case "STRETCH":
      return "stretch";
    default:
      return "start";
  }
}

function mapTextAlign(value: TypeStyle["textAlignHorizontal"] | undefined): "left" | "center" | "right" | "justify" {
  switch (value) {
    case "RIGHT":
      return "right";
    case "CENTER":
      return "center";
    case "JUSTIFIED":
      return "justify";
    default:
      return "left";
  }
}

function mapTextDecoration(value: TypeStyle["textDecoration"] | undefined): "none" | "underline" | "line-through" {
  switch (value) {
    case "UNDERLINE":
      return "underline";
    case "STRIKETHROUGH":
      return "line-through";
    default:
      return "none";
  }
}

function mapSizingMode(value: "FIXED" | "HUG" | "FILL" | undefined): "fixed" | "hug" | "fill" {
  switch (value) {
    case "HUG":
      return "hug";
    case "FILL":
      return "fill";
    default:
      return "fixed";
  }
}

function firstVisibleSolidFill(fills: Paint[] | undefined): Paint | undefined {
  return fills?.find((fill) => fill.visible !== false && fill.type === "SOLID" && fill.color);
}

function buildTypography(node: FigmaNode): NormalizedUINode["typography"] | undefined {
  if (node.type !== "TEXT" || !node.style) {
    return undefined;
  }

  const textFill = firstVisibleSolidFill(node.fills);
  return {
    content: node.characters ?? "",
    fontFamily: node.style.fontFamily,
    fontSize: node.style.fontSize,
    fontWeight: node.style.fontWeight,
    lineHeight: node.style.lineHeightPx ?? "auto",
    letterSpacing: node.style.letterSpacing ?? 0,
    textAlign: mapTextAlign(node.style.textAlignHorizontal),
    textDecoration: mapTextDecoration(node.style.textDecoration),
    color: textFill?.color ? rgbaToHex(textFill.color, textFill.opacity) : "#000000FF",
  };
}

function buildFills(node: FigmaNode): NormalizedUINode["fills"] {
  const fills: NormalizedUINode["fills"] = [];

  for (const fill of node.fills ?? []) {
    if (fill.visible === false) continue;

    if (fill.type === "SOLID" && fill.color) {
      fills.push({ type: "solid", color: rgbaToHex(fill.color, fill.opacity), opacity: fill.opacity ?? 1 });
      continue;
    }

    if ((fill.type === "GRADIENT_LINEAR" || fill.type === "GRADIENT_RADIAL") && fill.gradientStops) {
      fills.push({
        type: "gradient",
        opacity: fill.opacity ?? 1,
        gradientStops: fill.gradientStops.map((stop) => ({
          color: rgbaToHex(stop.color),
          position: stop.position,
        })),
      });
      continue;
    }

    if (fill.type === "IMAGE") {
      fills.push({ type: "image" });
    }
  }

  return fills;
}

function buildStrokes(node: ExtendedFigmaNode): NormalizedUINode["strokes"] {
  return (node.strokes ?? [])
    .filter((stroke) => stroke.visible !== false && stroke.type === "SOLID" && stroke.color)
    .map((stroke) => ({
      color: rgbaToHex(stroke.color as Color, stroke.opacity),
      weight: node.strokeWeight ?? 1,
    }));
}

function buildEffects(node: FigmaNode): NormalizedUINode["effects"] {
  const effects: NormalizedUINode["effects"] = [];

  for (const effect of node.effects ?? []) {
    if (effect.visible === false) continue;

    if (effect.type === "DROP_SHADOW") {
      const mapped: NormalizedUINode["effects"][number] = {
        type: "drop-shadow",
        radius: effect.radius,
      };
      if (effect.color) mapped.color = rgbaToHex(effect.color);
      if (effect.offset) mapped.offset = effect.offset;
      if (typeof effect.spread === "number") mapped.spread = effect.spread;
      effects.push(mapped);
      continue;
    }

    if (effect.type === "INNER_SHADOW") {
      const mapped: NormalizedUINode["effects"][number] = {
        type: "inner-shadow",
        radius: effect.radius,
      };
      if (effect.color) mapped.color = rgbaToHex(effect.color);
      if (effect.offset) mapped.offset = effect.offset;
      if (typeof effect.spread === "number") mapped.spread = effect.spread;
      effects.push(mapped);
      continue;
    }

    if (effect.type === "LAYER_BLUR") {
      effects.push({ type: "blur", radius: effect.radius });
    }
  }

  return effects;
}

function buildCornerRadius(node: ExtendedFigmaNode): NormalizedUINode["cornerRadius"] {
  if (typeof node.cornerRadius === "number") {
    return node.cornerRadius;
  }

  if (node.rectangleCornerRadii) {
    return {
      topLeft: node.rectangleCornerRadii[0] ?? 0,
      topRight: node.rectangleCornerRadii[1] ?? 0,
      bottomRight: node.rectangleCornerRadii[2] ?? 0,
      bottomLeft: node.rectangleCornerRadii[3] ?? 0,
    };
  }

  return 0;
}

function buildChildren(node: FigmaNode, maxDepth: number, depth: number): NormalizedUINode[] {
  if (depth >= maxDepth) {
    return [];
  }

  return (node.children ?? []).map((child) => buildNormalizedUIAST(child, maxDepth, depth + 1));
}

export function buildNormalizedUIAST(node: FigmaNode, maxDepth = 10, depth = 0): NormalizedUINode {
  const extendedNode = getExtendedNode(node);
  const typography = buildTypography(node);
  const sizing: NormalizedUINode["sizing"] = {
    width: node.absoluteBoundingBox?.width ?? null,
    height: node.absoluteBoundingBox?.height ?? null,
    widthMode: mapSizingMode(extendedNode.layoutSizingHorizontal),
    heightMode: mapSizingMode(extendedNode.layoutSizingVertical),
  };
  if (typeof extendedNode.minWidth === "number") sizing.minWidth = extendedNode.minWidth;
  if (typeof extendedNode.maxWidth === "number") sizing.maxWidth = extendedNode.maxWidth;

  let componentInfo: NormalizedUINode["componentInfo"];
  if (node.type === "INSTANCE") {
    componentInfo = {
      isInstance: true,
      componentName: node.name,
    };

    const variantProperties = extractVariantProperties(extendedNode);
    if (variantProperties) {
      componentInfo.variantProperties = variantProperties;
    }
  }

  const normalizedNode: NormalizedUINode = {
    name: node.name,
    figmaId: node.id,
    figmaType: node.type,
    semantic: inferSemantic(node),
    layout: {
      direction: node.layoutMode === "HORIZONTAL" ? "row" : node.layoutMode === "VERTICAL" ? "column" : "none",
      gap: node.itemSpacing ?? 0,
      padding: {
        top: node.paddingTop ?? 0,
        right: node.paddingRight ?? 0,
        bottom: node.paddingBottom ?? 0,
        left: node.paddingLeft ?? 0,
      },
      mainAxisAlignment: mapAlignment(node.primaryAxisAlignItems) as "start" | "center" | "end" | "space-between",
      crossAxisAlignment: (node.counterAxisAlignItems === "BASELINE"
        ? "start"
        : mapAlignment(node.counterAxisAlignItems)) as "start" | "center" | "end" | "stretch",
      wrap: extendedNode.layoutWrap === "WRAP",
    },
    sizing,
    fills: buildFills(node),
    strokes: buildStrokes(extendedNode),
    cornerRadius: buildCornerRadius(extendedNode),
    opacity: node.opacity ?? 1,
    effects: buildEffects(node),
    children: buildChildren(node, maxDepth, depth),
  };

  if (typography) {
    normalizedNode.typography = typography;
  }

  if (componentInfo) {
    normalizedNode.componentInfo = componentInfo;
  }

  return normalizedNode;
}
