import { z } from "zod";
import { FigmaClient } from "../figma/client.js";
import { SCHEMA_VERSION, buildFreshness } from "../shared.js";
import type {
  AssetHint,
  MapToSwiftUIInput,
  MapToSwiftUIResult,
  SwiftUIColorAsset,
  SwiftUINode,
} from "../types/tools.js";
import { buildNormalizedUIAST, type NormalizedUINode } from "./normalized-ui-ast.js";
import { registerTool } from "./registry.js";

export const mapToSwiftUISchema = z.object({
  access_token: z.string().describe("Figma personal access token"),
  file_key: z.string().describe("Figma file key"),
  node_id: z.string().describe("Node ID of the frame to map"),
  include_assets: z.boolean().default(true).describe("Include asset export hints"),
  include_color_assets: z.boolean().default(true).describe("Suggest SwiftUI Color assets and extension helpers"),
  max_depth: z.number().default(10).describe("Maximum node tree depth"),
});

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toPascalCase(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function hexToSwiftUIColor(color: string): string {
  const hex = color.replace("#", "");
  if (hex.length < 6) return "Color.clear";

  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const a = hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;

  // Named colors
  if (r === 1 && g === 1 && b === 1 && a === 1) return "Color.white";
  if (r === 0 && g === 0 && b === 0 && a === 1) return "Color.black";
  if (a === 0) return "Color.clear";

  const fmt = (v: number) => Number(v.toFixed(4));
  if (a === 1) {
    return `Color(red: ${fmt(r)}, green: ${fmt(g)}, blue: ${fmt(b)})`;
  }
  return `Color(red: ${fmt(r)}, green: ${fmt(g)}, blue: ${fmt(b)}, opacity: ${fmt(a)})`;
}

function collectAssetHints(node: NormalizedUINode): AssetHint[] {
  const assets: AssetHint[] = [];
  const shouldCollect =
    node.semantic === "icon" ||
    node.semantic === "image" ||
    node.figmaType === "VECTOR" ||
    node.figmaType === "BOOLEAN_OPERATION" ||
    node.fills.some((fill) => fill.type === "image");

  if (shouldCollect) {
    assets.push({
      figmaId: node.figmaId,
      suggestedName: slugify(node.name) || "asset",
      suggestedFormat:
        node.semantic === "icon" || node.figmaType === "VECTOR" || node.figmaType === "BOOLEAN_OPERATION"
          ? "svg"
          : "png",
      dimensions: {
        width: Math.round(node.sizing.width ?? 0),
        height: Math.round(node.sizing.height ?? 0),
      },
    });
  }

  for (const child of node.children) {
    assets.push(...collectAssetHints(child));
  }

  return assets;
}

function getUniformRadius(radius: NormalizedUINode["cornerRadius"]): {
  uniform: boolean;
  value: number;
  values?: { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number };
} {
  if (typeof radius === "number") {
    return { uniform: true, value: radius };
  }

  const values = radius;
  const allSame =
    values.topLeft === values.topRight && values.topLeft === values.bottomRight && values.topLeft === values.bottomLeft;

  return { uniform: allSame, value: allSame ? values.topLeft : 0, values };
}

function mapFontWeight(weight: number): string {
  if (weight >= 700) return ".bold";
  if (weight >= 600) return ".semibold";
  if (weight >= 500) return ".medium";
  if (weight >= 400) return ".regular";
  return ".light";
}

function buildPaddingModifiers(node: NormalizedUINode): string[] {
  const { top, right, bottom, left } = node.layout.padding;
  if (top === 0 && right === 0 && bottom === 0 && left === 0) return [];
  if (top === right && top === bottom && top === left) return [`.padding(${top})`];
  if (left === right && top === bottom) {
    const modifiers: string[] = [];
    if (left > 0) modifiers.push(`.padding(.horizontal, ${left})`);
    if (top > 0) modifiers.push(`.padding(.vertical, ${top})`);
    return modifiers;
  }

  const modifiers: string[] = [];
  if (top > 0) modifiers.push(`.padding(.top, ${top})`);
  if (right > 0) modifiers.push(`.padding(.trailing, ${right})`);
  if (bottom > 0) modifiers.push(`.padding(.bottom, ${bottom})`);
  if (left > 0) modifiers.push(`.padding(.leading, ${left})`);
  return modifiers;
}

function inferView(node: NormalizedUINode): SwiftUINode["view"] {
  if (node.semantic === "text") return "Text";
  if (node.semantic === "button") return "Button";
  if (node.semantic === "input") return "TextField";
  if (node.semantic === "image") return "Image";
  if (node.semantic === "icon") return "Image";
  if (node.semantic === "divider") return "Divider";
  if (node.layout.direction === "column") return "VStack";
  if (node.layout.direction === "row") return "HStack";
  if (node.children.length > 0) return "ZStack";
  return "Rectangle";
}

function makeSpacerNode(sourceNode: NormalizedUINode): SwiftUINode {
  return {
    view: "Spacer",
    modifiers: [],
    children: [],
    figmaNodeName: `${sourceNode.name} spacer`,
    figmaId: `${sourceNode.figmaId}::spacer`,
    notes: ["Inserted to emulate Figma space-between alignment."],
  };
}

function alignmentForStack(node: NormalizedUINode): string {
  if (node.layout.direction === "column") {
    if (node.layout.crossAxisAlignment === "start") return ".leading";
    if (node.layout.crossAxisAlignment === "end") return ".trailing";
    return ".center";
  }

  if (node.layout.direction === "row") {
    if (node.layout.crossAxisAlignment === "start") return ".top";
    if (node.layout.crossAxisAlignment === "end") return ".bottom";
    return ".center";
  }

  return ".center";
}

function emitNodeNotes(node: NormalizedUINode): string[] {
  const notes: string[] = [];
  if (node.fills.some((fill) => fill.type === "gradient")) {
    notes.push("Gradient fills need a manual LinearGradient or RadialGradient translation.");
  }
  if (node.semantic === "image") {
    notes.push(`Update Image("${slugify(node.name) || "asset"}") to the real asset name.`);
  }
  if (node.semantic === "icon") {
    notes.push("Icon nodes default to an SF Symbols placeholder and may need a custom asset.");
  }
  if (node.semantic === "input") {
    notes.push("TextField binding should be connected to application state.");
  }
  if (node.layout.direction === "none" && node.children.length > 0) {
    notes.push("Absolute positioning is not reconstructed; ZStack ordering may need manual offsets.");
  }
  return notes;
}

function emitModifiers(node: NormalizedUINode): string[] {
  const modifiers: string[] = [];
  modifiers.push(...buildPaddingModifiers(node));

  const frameParts: string[] = [];
  if (node.sizing.widthMode === "fixed" && node.sizing.width !== null)
    frameParts.push(`width: ${Math.round(node.sizing.width)}`);
  if (node.sizing.heightMode === "fixed" && node.sizing.height !== null)
    frameParts.push(`height: ${Math.round(node.sizing.height)}`);
  if (node.sizing.widthMode === "fill") frameParts.push("maxWidth: .infinity");
  if (node.sizing.heightMode === "fill") frameParts.push("maxHeight: .infinity");
  if (frameParts.length > 0) modifiers.push(`.frame(${frameParts.join(", ")})`);

  const solidFill = node.fills.find((fill) => fill.type === "solid" && fill.color);
  if (solidFill?.color) modifiers.push(`.background(${hexToSwiftUIColor(solidFill.color)})`);

  const radius = getUniformRadius(node.cornerRadius);
  if (radius.uniform && radius.value > 0) {
    modifiers.push(`.cornerRadius(${radius.value})`);
  }

  if (node.opacity < 1) modifiers.push(`.opacity(${Number(node.opacity.toFixed(3))})`);

  const shadow = node.effects.find((effect) => effect.type === "drop-shadow");
  if (shadow) {
    modifiers.push(
      `.shadow(color: ${hexToSwiftUIColor(shadow.color ?? "#000000FF")}, radius: ${shadow.radius}, x: ${Math.round(
        shadow.offset?.x ?? 0
      )}, y: ${Math.round(shadow.offset?.y ?? 0)})`
    );
  }

  if (node.typography) {
    modifiers.push(
      `.font(.system(size: ${node.typography.fontSize}, weight: ${mapFontWeight(node.typography.fontWeight)}))`
    );
    modifiers.push(`.foregroundColor(${hexToSwiftUIColor(node.typography.color)})`);
    if (node.typography.lineHeight !== "auto") {
      modifiers.push(
        `.lineSpacing(${Math.max(0, Number((node.typography.lineHeight - node.typography.fontSize).toFixed(2)))})`
      );
    }
    if (node.typography.letterSpacing !== 0) modifiers.push(`.kerning(${node.typography.letterSpacing})`);
    if (node.typography.textAlign !== "left") {
      const alignment =
        node.typography.textAlign === "center"
          ? ".center"
          : node.typography.textAlign === "right"
            ? ".trailing"
            : ".leading";
      modifiers.push(`.multilineTextAlignment(${alignment})`);
    }
    if (node.typography.textDecoration === "underline") modifiers.push(".underline()");
    if (node.typography.textDecoration === "line-through") modifiers.push(".strikethrough()");
  }

  if (node.strokes[0]) {
    const radiusValue = getUniformRadius(node.cornerRadius).uniform ? getUniformRadius(node.cornerRadius).value : 0;
    modifiers.push(
      `.overlay(RoundedRectangle(cornerRadius: ${radiusValue}).stroke(${hexToSwiftUIColor(
        node.strokes[0].color
      )}, lineWidth: ${node.strokes[0].weight}))`
    );
  }

  return modifiers;
}

function injectSpaceBetween(children: SwiftUINode[], node: NormalizedUINode): SwiftUINode[] {
  if (node.layout.mainAxisAlignment !== "space-between" || children.length < 2) {
    return children;
  }

  const output: SwiftUINode[] = [];
  children.forEach((child, index) => {
    output.push(child);
    if (index < children.length - 1) output.push(makeSpacerNode(node));
  });
  return output;
}

function emitSwiftUITree(node: NormalizedUINode, warnings: string[]): SwiftUINode {
  const view = inferView(node);
  let children = node.children.map((child) => emitSwiftUITree(child, warnings));
  children = injectSpaceBetween(children, node);

  const swiftNode: SwiftUINode = {
    view,
    modifiers: emitModifiers(node),
    children,
    figmaNodeName: node.name,
    figmaId: node.figmaId,
    notes: emitNodeNotes(node),
  };

  if (node.semantic === "text" && node.typography?.content) {
    swiftNode.text = node.typography.content;
  }

  if (view === "VStack" || view === "HStack") {
    swiftNode.view = `${view}(alignment: ${alignmentForStack(node)}, spacing: ${Math.round(node.layout.gap)})`;
  }

  if (view === "TextField") {
    swiftNode.text = node.typography?.content || node.name;
    swiftNode.notes.push('Use `TextField("placeholder", text: $binding)` with a real binding.');
  }

  if (view === "Image") {
    if (node.semantic === "icon") {
      swiftNode.text = "placeholder";
      swiftNode.notes.push('Uses `Image(systemName: "placeholder")` by default.');
    } else {
      swiftNode.text = slugify(node.name) || "asset";
      swiftNode.modifiers.unshift(".resizable()");
      swiftNode.modifiers.splice(1, 0, ".aspectRatio(contentMode: .fit)");
      warnings.push(`"${node.name}" maps to an asset-backed SwiftUI Image and needs a real asset name.`);
    }
  }

  if (view === "Button") {
    swiftNode.notes.push("Wrap generated content in `Button(action: {}) { ... }`.");
  }

  return swiftNode;
}

function collectColorAssets(root: NormalizedUINode): SwiftUIColorAsset[] {
  const colors = new Map<string, string>();

  function addColor(color: string, prefix: string): void {
    if (colors.has(color)) return;
    const name = `figma${toPascalCase(prefix) || "Color"}${colors.size + 1}`;
    colors.set(color, name);
  }

  function visit(node: NormalizedUINode): void {
    node.fills.forEach((fill) => {
      if (fill.type === "solid" && fill.color) addColor(fill.color, "Background");
    });
    node.strokes.forEach((stroke) => addColor(stroke.color, "Border"));
    node.effects.forEach((effect) => {
      if (effect.color) addColor(effect.color, "Shadow");
    });
    if (node.typography) addColor(node.typography.color, "Text");
    node.children.forEach(visit);
  }

  visit(root);

  return Array.from(colors.entries()).map(([hex, name]) => ({
    name,
    hex,
    swift: ["extension Color {", `  static let ${name} = ${hexToSwiftUIColor(hex)}`, "}"].join("\n"),
  }));
}

export async function mapToSwiftUI(
  input: MapToSwiftUIInput,
  clientOptions?: { ttlMs?: number; disableCache?: boolean }
): Promise<MapToSwiftUIResult> {
  const client = new FigmaClient(input.access_token, clientOptions);
  const nodeId = input.node_id.replaceAll("-", ":");
  const response = await client.getFileNodes(input.file_key, [nodeId]);
  const rootDoc = response.data.nodes[nodeId]?.document;

  if (!rootDoc) {
    throw new Error(`Node ${input.node_id} not found`);
  }

  const warnings: string[] = [];
  const ast = buildNormalizedUIAST(rootDoc, input.max_depth);
  const swiftTree = emitSwiftUITree(ast, warnings);
  const assets = input.include_assets ? collectAssetHints(ast) : [];
  const colorAssets = input.include_color_assets ? collectColorAssets(ast) : [];

  return {
    schema_version: SCHEMA_VERSION,
    source: { file_key: input.file_key, node_id: input.node_id },
    freshness: buildFreshness(response.cache),
    warnings,
    data: {
      rootNode: swiftTree,
      assets,
      colorAssets,
      notes: [],
      cache: response.cache,
    },
  };
}

registerTool({
  name: "map_to_swiftui",
  description:
    "Map a Figma frame to a SwiftUI view tree with modifier suggestions, asset hints, and generated color asset helpers.",
  schema: mapToSwiftUISchema,
  handler: mapToSwiftUI,
});
