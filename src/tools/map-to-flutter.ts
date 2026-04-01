import { z } from "zod";
import { FigmaClient } from "../figma/client.js";
import { SCHEMA_VERSION, buildFreshness } from "../shared.js";
import type {
  AssetHint,
  ComponentSuggestion,
  FlutterNode,
  FlutterThemeData,
  MapToFlutterInput,
  MapToFlutterResult,
} from "../types/tools.js";
import { buildNormalizedUIAST, type NormalizedUINode } from "./normalized-ui-ast.js";
import { registerTool } from "./registry.js";

export const mapToFlutterSchema = z.object({
  access_token: z.string().describe("Figma personal access token"),
  file_key: z.string().describe("Figma file key"),
  node_id: z.string().describe("Node ID of the frame to map"),
  component_library: z
    .enum(["material", "cupertino", "plain"])
    .default("material")
    .describe("Target Flutter component library"),
  include_assets: z.boolean().default(true).describe("Include asset export hints"),
  include_theme_data: z.boolean().default(true).describe("Generate a ThemeData suggestion from the tree"),
  max_depth: z.number().default(10).describe("Maximum node tree depth"),
});

type ComponentLibrary = MapToFlutterInput["component_library"];

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeHex8To6(color: string): string {
  return color.length >= 7 ? color.slice(0, 7).toUpperCase() : color.toUpperCase();
}

function hexToFlutterColor(color: string): string {
  const normalized = color.length === 9 ? color : `${normalizeHex8To6(color).slice(0, 7)}FF`;
  // Flutter expects Color(0xAARRGGBB); input is #RRGGBBAA
  const rr = normalized.slice(1, 7);
  const aa = normalized.slice(7, 9);
  return `Color(0x${aa}${rr})`;
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
  const normalized = Math.min(900, Math.max(100, Math.round(weight / 100) * 100));
  return `FontWeight.w${normalized}`;
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

function detectComponent(node: NormalizedUINode, library: ComponentLibrary): ComponentSuggestion | undefined {
  if (library === "plain") return undefined;

  const lowerName = node.name.toLowerCase();
  const hasTextChild = node.children.some((child) => child.semantic === "text");
  const hasFill = node.fills.length > 0;
  const hasShadow = node.effects.some((effect) => effect.type === "drop-shadow");
  const isButton = node.semantic === "button" || (/button|btn|cta/i.test(lowerName) && hasTextChild && hasFill);
  const isInput = node.semantic === "input" || /input|field|textfield|search|email|password/i.test(lowerName);
  const isCard = node.semantic === "container" && hasShadow && node.children.length > 0;
  const isAvatar = /avatar|profile/i.test(lowerName);
  const isChip = /chip|tag|badge/i.test(lowerName) && hasTextChild;
  const isDivider = node.semantic === "divider";
  const isSwitch = /check|toggle|switch/i.test(lowerName);

  if (library === "material") {
    if (isButton) return { library, component: "ElevatedButton", import: "package:flutter/material.dart" };
    if (isInput) return { library, component: "TextField", import: "package:flutter/material.dart" };
    if (isCard) return { library, component: "Card", import: "package:flutter/material.dart" };
    if (isAvatar) return { library, component: "CircleAvatar", import: "package:flutter/material.dart" };
    if (isChip) return { library, component: "Chip", import: "package:flutter/material.dart" };
    if (isDivider) return { library, component: "Divider", import: "package:flutter/material.dart" };
    if (isSwitch) return { library, component: "Switch", import: "package:flutter/material.dart" };
  }

  if (library === "cupertino") {
    if (isButton) return { library, component: "CupertinoButton", import: "package:flutter/cupertino.dart" };
    if (isInput) return { library, component: "CupertinoTextField", import: "package:flutter/cupertino.dart" };
    if (isSwitch) return { library, component: "CupertinoSwitch", import: "package:flutter/cupertino.dart" };
  }

  return undefined;
}

function buildDecorationProperties(node: NormalizedUINode): string[] {
  const parts: string[] = [];
  const solidFill = node.fills.find((fill) => fill.type === "solid" && fill.color);
  if (solidFill?.color) parts.push(`color: ${hexToFlutterColor(solidFill.color)}`);

  if (node.strokes[0]) {
    parts.push(
      `border: Border.all(color: ${hexToFlutterColor(node.strokes[0].color)}, width: ${node.strokes[0].weight})`
    );
  }

  const radius = getUniformRadius(node.cornerRadius);
  if (radius.uniform && radius.value > 0) {
    parts.push(`borderRadius: BorderRadius.circular(${radius.value})`);
  }

  const shadow = node.effects.find((effect) => effect.type === "drop-shadow");
  if (shadow) {
    parts.push(
      `boxShadow: [BoxShadow(color: ${hexToFlutterColor(shadow.color ?? "#00000033")}, offset: Offset(${Math.round(
        shadow.offset?.x ?? 0
      )}, ${Math.round(shadow.offset?.y ?? 0)}), blurRadius: ${shadow.radius}, spreadRadius: ${shadow.spread ?? 0})]`
    );
  }

  return parts;
}

function inferBaseWidget(node: NormalizedUINode, componentSuggestion?: ComponentSuggestion): string {
  if (componentSuggestion) return componentSuggestion.component;
  if (node.semantic === "text") return "Text";
  if (node.semantic === "button") return "GestureDetector";
  if (node.semantic === "input") return "TextField";
  if (node.semantic === "image" || node.semantic === "icon") return "Image";
  if (node.semantic === "divider") return "Divider";
  if (node.layout.direction === "row") return "Row";
  if (node.layout.direction === "column") return "Column";
  if (node.children.length > 0) return "Stack";
  return "Container";
}

function makeSpacerNode(axis: "horizontal" | "vertical", gap: number, sourceNode: NormalizedUINode): FlutterNode {
  return {
    widget: "SizedBox",
    properties: axis === "horizontal" ? { width: String(gap) } : { height: String(gap) },
    children: [],
    figmaNodeName: `${sourceNode.name} spacer`,
    figmaId: `${sourceNode.figmaId}::spacer-${axis}-${gap}`,
    notes: ["Inserted to emulate Figma auto-layout gap."],
  };
}

function injectGapChildren(children: FlutterNode[], node: NormalizedUINode): FlutterNode[] {
  if (node.layout.gap <= 0 || children.length < 2 || node.layout.direction === "none") {
    return children;
  }

  const axis = node.layout.direction === "row" ? "horizontal" : "vertical";
  const output: FlutterNode[] = [];
  children.forEach((child, index) => {
    output.push(child);
    if (index < children.length - 1) {
      output.push(makeSpacerNode(axis, Math.round(node.layout.gap), node));
    }
  });
  return output;
}

function wrapNode(
  child: FlutterNode,
  widget: string,
  properties: Record<string, string>,
  sourceNode: NormalizedUINode,
  note: string
): FlutterNode {
  return {
    widget,
    properties,
    children: [child],
    figmaNodeName: sourceNode.name,
    figmaId: sourceNode.figmaId,
    notes: [note],
  };
}

function applySizeWrappers(node: NormalizedUINode, flutterNode: FlutterNode): FlutterNode {
  let wrapped = flutterNode;

  const sizeProps: Record<string, string> = {};
  if (node.sizing.widthMode === "fill") {
    sizeProps["width"] = "double.infinity";
  } else if (node.sizing.widthMode === "fixed" && node.sizing.width !== null) {
    sizeProps["width"] = String(Math.round(node.sizing.width));
  }
  if (node.sizing.heightMode === "fill") {
    sizeProps["height"] = "double.infinity";
  } else if (node.sizing.heightMode === "fixed" && node.sizing.height !== null) {
    sizeProps["height"] = String(Math.round(node.sizing.height));
  }
  if (Object.keys(sizeProps).length > 0) {
    wrapped = wrapNode(wrapped, "SizedBox", sizeProps, node, "Wrapped with SizedBox to preserve fixed Figma sizing.");
  }

  return wrapped;
}

function emitNodeNotes(node: NormalizedUINode, componentSuggestion?: ComponentSuggestion): string[] {
  const notes: string[] = [];
  if (node.fills.some((fill) => fill.type === "gradient")) {
    notes.push("Gradient fills need manual BoxDecoration gradient mapping.");
  }
  if (node.semantic === "image" || node.semantic === "icon") {
    notes.push(`Image assets should be exported and wired into Image.asset("${slugify(node.name) || "asset"}").`);
  }
  if (node.semantic === "icon") {
    notes.push("Icons may be better represented with IconData or an SVG package.");
  }
  if (node.semantic === "input") {
    notes.push("TextEditingController and validation wiring must be added manually.");
  }
  if (componentSuggestion) {
    notes.push("A Flutter widget suggestion was inferred from the node semantics and naming.");
  }
  return notes;
}

function emitFlutterTree(node: NormalizedUINode, componentLibrary: ComponentLibrary, warnings: string[]): FlutterNode {
  const componentSuggestion = detectComponent(node, componentLibrary);
  const baseWidget = inferBaseWidget(node, componentSuggestion);
  const properties: Record<string, string> = {};
  const notes = emitNodeNotes(node, componentSuggestion);

  let children = node.children.map((child) => emitFlutterTree(child, componentLibrary, warnings));
  children = injectGapChildren(children, node);

  if (node.semantic === "text" && node.typography?.content) {
    properties["style"] = `TextStyle(fontSize: ${node.typography.fontSize}, fontWeight: ${mapFontWeight(
      node.typography.fontWeight
    )}, fontFamily: '${node.typography.fontFamily}', color: ${hexToFlutterColor(node.typography.color)}${
      node.typography.lineHeight === "auto"
        ? ""
        : `, height: ${(node.typography.lineHeight / node.typography.fontSize).toFixed(3)}`
    }${node.typography.letterSpacing === 0 ? "" : `, letterSpacing: ${node.typography.letterSpacing}`})`;
  }

  if (baseWidget === "Row" || baseWidget === "Column") {
    const mainAxisMap: Record<NormalizedUINode["layout"]["mainAxisAlignment"], string> = {
      start: "MainAxisAlignment.start",
      center: "MainAxisAlignment.center",
      end: "MainAxisAlignment.end",
      "space-between": "MainAxisAlignment.spaceBetween",
    };
    const crossAxisMap: Record<NormalizedUINode["layout"]["crossAxisAlignment"], string> = {
      start: "CrossAxisAlignment.start",
      center: "CrossAxisAlignment.center",
      end: "CrossAxisAlignment.end",
      stretch: "CrossAxisAlignment.stretch",
    };
    properties["mainAxisAlignment"] = mainAxisMap[node.layout.mainAxisAlignment];
    properties["crossAxisAlignment"] = crossAxisMap[node.layout.crossAxisAlignment];
  }

  if (baseWidget === "Image") {
    properties["image"] = `AssetImage('${slugify(node.name) || "asset"}')`;
    properties["fit"] = "BoxFit.contain";
    notes.push("Update the asset path to your Flutter bundle location.");
    warnings.push(`"${node.name}" maps to an asset-backed Flutter image and needs a real bundle path.`);
  }

  if (baseWidget === "TextField" || baseWidget === "CupertinoTextField") {
    if (baseWidget === "TextField") {
      properties["decoration"] = `const InputDecoration(hintText: '${node.name}')`;
    }
    if (baseWidget === "CupertinoTextField") {
      properties["placeholder"] = `'${node.name}'`;
    }
  }

  if (baseWidget === "Divider") {
    properties["height"] = "1";
    properties["thickness"] = "1";
    if (node.strokes[0]) {
      properties["color"] = hexToFlutterColor(node.strokes[0].color);
    }
  }

  if (node.layout.direction === "none" && node.children.length > 0 && baseWidget === "Stack") {
    notes.push("Absolute positioning is not reconstructed; Stack children need manual Positioned widgets if required.");
  }

  const decoration = buildDecorationProperties(node);
  if (baseWidget === "Container" && decoration.length > 0) {
    properties["decoration"] = `BoxDecoration(${decoration.join(", ")})`;
  }

  const hasPadding = Object.values(node.layout.padding).some((value) => value > 0);
  if (hasPadding) {
    properties["padding"] =
      `EdgeInsets.only(top: ${node.layout.padding.top}, right: ${node.layout.padding.right}, bottom: ${node.layout.padding.bottom}, left: ${node.layout.padding.left})`;
  }

  if (node.opacity < 1) {
    properties["opacity"] = node.opacity.toFixed(3);
    notes.push("Wrap with Opacity in implementation if visual fidelity matters.");
  }

  const flutterNode: FlutterNode = {
    widget: baseWidget,
    properties: Object.fromEntries(
      Object.entries(properties).filter(([, value]) => value !== undefined && value !== "")
    ),
    children,
    figmaNodeName: node.name,
    figmaId: node.figmaId,
    notes,
  };

  if (componentSuggestion) flutterNode.componentSuggestion = componentSuggestion;
  if (node.semantic === "text" && node.typography?.content) flutterNode.text = node.typography.content;

  return applySizeWrappers(node, flutterNode);
}

function collectThemeData(root: NormalizedUINode): FlutterThemeData | undefined {
  const colors = new Set<string>();
  const fontFamilies = new Set<string>();
  const typography = new Map<string, { fontSize: number; fontWeight: number }>();

  function visit(node: NormalizedUINode): void {
    node.fills.forEach((fill) => {
      if (fill.type === "solid" && fill.color) colors.add(normalizeHex8To6(fill.color));
    });
    node.strokes.forEach((stroke) => colors.add(normalizeHex8To6(stroke.color)));
    node.effects.forEach((effect) => {
      if (effect.color) colors.add(normalizeHex8To6(effect.color));
    });
    if (node.typography) {
      colors.add(normalizeHex8To6(node.typography.color));
      fontFamilies.add(node.typography.fontFamily);

      const key =
        node.typography.fontSize >= 32
          ? "headlineLarge"
          : node.typography.fontSize >= 24
            ? "headlineMedium"
            : node.typography.fontSize >= 18
              ? "titleMedium"
              : "bodyMedium";
      typography.set(key, {
        fontSize: node.typography.fontSize,
        fontWeight: node.typography.fontWeight,
      });
    }
    node.children.forEach(visit);
  }

  visit(root);

  if (colors.size === 0 && typography.size === 0 && fontFamilies.size === 0) {
    return undefined;
  }

  const colorList = Array.from(colors);
  const primary = colorList[0] ?? "#000000";
  const secondary = colorList[1] ?? primary;
  const surface = colorList[2] ?? "#FFFFFF";
  const textTheme = Array.from(typography.entries())
    .map(
      ([name, value]) =>
        `    ${name}: TextStyle(fontSize: ${value.fontSize}, fontWeight: ${mapFontWeight(value.fontWeight)}${
          fontFamilies.size > 0 ? `, fontFamily: '${Array.from(fontFamilies)[0]}'` : ""
        }),`
    )
    .join("\n");

  const themeData = [
    "ThemeData(",
    `  primaryColor: ${hexToFlutterColor(primary)},`,
    "  textTheme: TextTheme(",
    textTheme || "    bodyMedium: TextStyle(fontSize: 14, fontWeight: FontWeight.w400),",
    "  ),",
    `  colorScheme: ColorScheme.light(primary: ${hexToFlutterColor(primary)}, secondary: ${hexToFlutterColor(
      secondary
    )}, surface: ${hexToFlutterColor(surface)}),`,
    ")",
  ].join("\n");

  return {
    colors: colorList,
    fontFamilies: Array.from(fontFamilies),
    fontSizes: Array.from(new Set(Array.from(typography.values()).map((value) => value.fontSize))).sort(
      (a, b) => a - b
    ),
    themeData,
  };
}

export async function mapToFlutter(
  input: MapToFlutterInput,
  clientOptions?: { ttlMs?: number; disableCache?: boolean }
): Promise<MapToFlutterResult> {
  const client = new FigmaClient(input.access_token, clientOptions);
  const nodeId = input.node_id.replaceAll("-", ":");
  const response = await client.getFileNodes(input.file_key, [nodeId]);
  const rootDoc = response.data.nodes[nodeId]?.document;

  if (!rootDoc) {
    throw new Error(`Node ${input.node_id} not found`);
  }

  const warnings: string[] = [];
  const ast = buildNormalizedUIAST(rootDoc, input.max_depth);
  const flutterTree = emitFlutterTree(ast, input.component_library, warnings);
  const assets = input.include_assets ? collectAssetHints(ast) : [];
  const theme = input.include_theme_data ? collectThemeData(ast) : undefined;

  return {
    schema_version: SCHEMA_VERSION,
    source: { file_key: input.file_key, node_id: input.node_id },
    freshness: buildFreshness(response.cache),
    warnings,
    data: {
      rootNode: flutterTree,
      component_library: input.component_library,
      assets,
      notes: [],
      cache: response.cache,
      ...(theme ? { theme } : {}),
    },
  };
}

registerTool({
  name: "map_to_flutter",
  description:
    "Map a Figma frame to a Flutter widget tree with Material or Cupertino suggestions, constructor-style properties, asset hints, and ThemeData suggestions.",
  schema: mapToFlutterSchema,
  handler: mapToFlutter,
});
