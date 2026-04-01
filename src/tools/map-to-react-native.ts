import { z } from "zod";
import { FigmaClient } from "../figma/client.js";
import { SCHEMA_VERSION, buildFreshness } from "../shared.js";
import type {
  AssetHint,
  ComponentSuggestion,
  MapToReactNativeInput,
  MapToReactNativeResult,
  PropTypeDefinition,
  ReactNativeNode,
} from "../types/tools.js";
import { buildNormalizedUIAST, type NormalizedUINode } from "./normalized-ui-ast.js";
import { registerTool } from "./registry.js";

export const mapToReactNativeSchema = z.object({
  access_token: z.string().describe("Figma personal access token"),
  file_key: z.string().describe("Figma file key"),
  node_id: z.string().describe("Node ID of the frame to map"),
  component_library: z
    .enum(["react_native_paper", "native_base", "plain"])
    .default("plain")
    .describe("Target component library for React Native component mapping"),
  include_assets: z.boolean().default(true).describe("Include asset export hints"),
  include_prop_types: z.boolean().default(true).describe("Generate TypeScript prop interfaces from variants"),
  max_depth: z.number().default(10).describe("Maximum node tree depth"),
});

type ComponentLibrary = MapToReactNativeInput["component_library"];

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

function toCamelCase(value: string): string {
  const pascal = toPascalCase(value);
  return pascal.length > 0 ? pascal.charAt(0).toLowerCase() + pascal.slice(1) : "prop";
}

function normalizeColor(color: string): string {
  return color.toUpperCase();
}

function stripAlpha(color: string): string {
  return color.length >= 7 ? color.slice(0, 7).toUpperCase() : color.toUpperCase();
}

function getHexAlpha(color: string): number {
  if (color.length === 9) {
    return Number.parseInt(color.slice(7, 9), 16) / 255;
  }
  return 1;
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

function mapVariantValue(key: string, value: string): readonly [string, string, boolean] {
  const normalizedKey = key.toLowerCase();
  const normalizedValue = value.toLowerCase();

  if (normalizedKey === "size") {
    return ["size", normalizedValue === "small" ? "sm" : normalizedValue === "large" ? "lg" : "md", true] as const;
  }

  if (normalizedKey === "state" && normalizedValue === "disabled") {
    return ["disabled", "true", true] as const;
  }

  if (normalizedKey === "variant" || normalizedKey === "style" || normalizedKey === "type") {
    const mapped =
      normalizedValue === "primary"
        ? "contained"
        : normalizedValue === "secondary"
          ? "outlined"
          : normalizedValue === "outline"
            ? "outlined"
            : normalizedValue === "ghost"
              ? "text"
              : normalizedValue;
    return ["mode", mapped, true] as const;
  }

  return [toCamelCase(key), value, false] as const;
}

function collectVariantValues(root: NormalizedUINode, collector: Map<string, Set<string>>): void {
  for (const [key, value] of Object.entries(root.componentInfo?.variantProperties ?? {})) {
    if (!collector.has(key)) collector.set(key, new Set());
    collector.get(key)?.add(value);
  }

  for (const child of root.children) {
    collectVariantValues(child, collector);
  }
}

function buildPropDefinition(name: string, values: string[]): PropTypeDefinition["props"][number] | undefined {
  const lowerName = name.toLowerCase();
  const uniqueValues = Array.from(new Set(values));

  if (lowerName === "state") {
    if (uniqueValues.includes("Disabled")) {
      return { name: "disabled", type: "boolean", required: false, defaultValue: "false" };
    }
    return undefined;
  }

  if (lowerName === "size") {
    const mapped = uniqueValues.map((value) => {
      const lowerValue = value.toLowerCase();
      return lowerValue === "small" ? "sm" : lowerValue === "large" ? "lg" : "md";
    });
    return {
      name: "size",
      type: Array.from(new Set(mapped))
        .map((value) => `'${value}'`)
        .join(" | "),
      required: false,
      defaultValue: `'${mapped[0] ?? "md"}'`,
    };
  }

  if (lowerName === "variant" || lowerName === "style" || lowerName === "type") {
    const mapped = uniqueValues.map((value) => {
      const lowerValue = value.toLowerCase();
      if (lowerValue === "primary") return "contained";
      if (lowerValue === "secondary" || lowerValue === "outline") return "outlined";
      if (lowerValue === "ghost") return "text";
      return lowerValue;
    });
    return {
      name: "mode",
      type: Array.from(new Set(mapped))
        .map((value) => `'${value}'`)
        .join(" | "),
      required: false,
      defaultValue: `'${mapped[0] ?? "contained"}'`,
    };
  }

  return {
    name: toCamelCase(name),
    type: uniqueValues.map((value) => `'${value}'`).join(" | "),
    required: false,
    defaultValue: `'${uniqueValues[0] ?? ""}'`,
  };
}

function extractPropTypes(root: NormalizedUINode): PropTypeDefinition[] {
  const definitions = new Map<string, PropTypeDefinition>();

  function visit(node: NormalizedUINode): void {
    if (node.componentInfo?.isInstance && node.componentInfo.componentName && node.componentInfo.variantProperties) {
      const collector = new Map<string, Set<string>>();
      collectVariantValues(node, collector);

      const props = Array.from(collector.entries())
        .map(([name, values]) => buildPropDefinition(name, Array.from(values)))
        .filter((prop): prop is NonNullable<typeof prop> => Boolean(prop));

      if (props.length > 0) {
        const componentName =
          toPascalCase(node.componentInfo.componentName.split(",")[0] ?? node.componentInfo.componentName) ||
          "FigmaComponent";
        definitions.set(componentName, {
          componentName,
          props,
          typescript: [
            `export interface ${componentName}Props {`,
            ...props.map((prop) => `  ${prop.name}${prop.required ? "" : "?"}: ${prop.type};`),
            "}",
          ].join("\n"),
        });
      }
    }

    for (const child of node.children) visit(child);
  }

  visit(root);
  return Array.from(definitions.values());
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

function mapFontWeight(weight: number): string {
  return String(Math.min(900, Math.max(100, Math.round(weight / 100) * 100)));
}

function emitStyle(node: NormalizedUINode): ReactNativeNode["style"] {
  const style: ReactNativeNode["style"] = {};

  if (node.layout.direction !== "none") {
    style["flexDirection"] = node.layout.direction;
    const justifyMap: Record<NormalizedUINode["layout"]["mainAxisAlignment"], string> = {
      start: "flex-start",
      center: "center",
      end: "flex-end",
      "space-between": "space-between",
    };
    const alignMap: Record<NormalizedUINode["layout"]["crossAxisAlignment"], string> = {
      start: "flex-start",
      center: "center",
      end: "flex-end",
      stretch: "stretch",
    };
    style["justifyContent"] = justifyMap[node.layout.mainAxisAlignment];
    style["alignItems"] = alignMap[node.layout.crossAxisAlignment];
    if (node.layout.wrap) style["flexWrap"] = "wrap";
  }

  if (node.layout.gap > 0) style["gap"] = Math.round(node.layout.gap);

  const { top, right, bottom, left } = node.layout.padding;
  if (top > 0) style["paddingTop"] = Math.round(top);
  if (right > 0) style["paddingRight"] = Math.round(right);
  if (bottom > 0) style["paddingBottom"] = Math.round(bottom);
  if (left > 0) style["paddingLeft"] = Math.round(left);

  if (node.sizing.widthMode === "fill") style["width"] = "100%";
  else if (node.sizing.widthMode === "fixed" && node.sizing.width !== null)
    style["width"] = Math.round(node.sizing.width);

  if (node.sizing.heightMode === "fill") style["height"] = "100%";
  else if (node.sizing.heightMode === "fixed" && node.sizing.height !== null)
    style["height"] = Math.round(node.sizing.height);

  const solidFill = node.fills.find((fill) => fill.type === "solid" && fill.color);
  if (solidFill?.color) style["backgroundColor"] = normalizeColor(solidFill.color);

  if (node.strokes[0]) {
    style["borderWidth"] = node.strokes[0].weight;
    style["borderColor"] = normalizeColor(node.strokes[0].color);
  }

  const radius = getUniformRadius(node.cornerRadius);
  if (radius.uniform) {
    style["borderRadius"] = radius.value;
  }

  if (node.opacity < 1) style["opacity"] = Number(node.opacity.toFixed(3));

  const shadow = node.effects.find((effect) => effect.type === "drop-shadow");
  if (shadow) {
    const shadowColor = shadow.color ?? "#00000033";
    style["shadowColor"] = stripAlpha(shadowColor);
    style["shadowOpacity"] = Number((getHexAlpha(shadowColor) * node.opacity).toFixed(3));
    style["shadowRadius"] = shadow.radius;
    style["shadowOffset"] = { width: Math.round(shadow.offset?.x ?? 0), height: Math.round(shadow.offset?.y ?? 0) };
    style["elevation"] = Math.max(1, Math.round((shadow.radius + (shadow.offset?.y ?? 0)) / 2));
  }

  if (node.typography) {
    style["fontSize"] = node.typography.fontSize;
    style["fontWeight"] = mapFontWeight(node.typography.fontWeight);
    style["fontFamily"] = node.typography.fontFamily;
    style["color"] = normalizeColor(node.typography.color);
    style["textAlign"] = node.typography.textAlign;
    if (node.typography.lineHeight !== "auto") style["lineHeight"] = node.typography.lineHeight;
    if (node.typography.letterSpacing !== 0) style["letterSpacing"] = node.typography.letterSpacing;
    if (node.typography.textDecoration !== "none") style["textDecorationLine"] = node.typography.textDecoration;
  }

  return style;
}

function detectComponent(node: NormalizedUINode, library: ComponentLibrary): ComponentSuggestion | undefined {
  if (library === "plain") return undefined;

  const lowerName = node.name.toLowerCase();
  const hasTextChild = node.children.some((child) => child.semantic === "text");
  const hasFill = node.fills.length > 0;
  const hasShadow = node.effects.some((effect) => effect.type === "drop-shadow");
  const isButton = node.semantic === "button" || (/button|btn|cta/i.test(lowerName) && hasTextChild && hasFill);
  const isInput = node.semantic === "input" || /input|field|textfield|search|email|password/i.test(lowerName);
  const isCard = node.semantic === "container" && hasShadow && node.layout.padding.top > 0 && node.children.length > 0;
  const isAvatar =
    /avatar|profile/i.test(lowerName) &&
    typeof node.cornerRadius === "number" &&
    node.cornerRadius >= (Math.min(node.sizing.width ?? 0, node.sizing.height ?? 0) || 0) / 2 - 1 &&
    node.fills.some((fill) => fill.type === "image");
  const isBadge = /badge|tag/i.test(lowerName) && hasTextChild;
  const isChip = /chip/i.test(lowerName) && hasTextChild;
  const isSwitch = /check|toggle|switch/i.test(lowerName);
  const isDivider = node.semantic === "divider";
  const variantProps = Object.fromEntries(
    Object.entries(node.componentInfo?.variantProperties ?? {})
      .map(([key, value]) => {
        const [mappedKey, mappedValue, include] = mapVariantValue(key, value);
        return include ? ([mappedKey, mappedValue] as const) : undefined;
      })
      .filter((entry): entry is readonly [string, string] => Boolean(entry))
  );

  if (library === "react_native_paper") {
    if (isButton) return { library, component: "Button", import: "react-native-paper", props: variantProps };
    if (isInput) return { library, component: "TextInput", import: "react-native-paper", props: variantProps };
    if (isCard) return { library, component: "Card", import: "react-native-paper" };
    if (isAvatar) return { library, component: "Avatar.Image", import: "react-native-paper" };
    if (isBadge) return { library, component: "Badge", import: "react-native-paper", props: variantProps };
    if (isChip) return { library, component: "Chip", import: "react-native-paper", props: variantProps };
    if (isDivider) return { library, component: "Divider", import: "react-native-paper" };
    if (isSwitch) return { library, component: "Switch", import: "react-native-paper", props: variantProps };
  }

  if (library === "native_base") {
    if (isButton) return { library, component: "Button", import: "native-base", props: variantProps };
    if (isInput) return { library, component: "Input", import: "native-base", props: variantProps };
    if (isAvatar) return { library, component: "Avatar", import: "native-base" };
    if (isBadge) return { library, component: "Badge", import: "native-base", props: variantProps };
    if (isDivider) return { library, component: "Divider", import: "native-base" };
    if (isSwitch) return { library, component: "Switch", import: "native-base", props: variantProps };
    if (isCard || node.semantic === "container") return { library, component: "Box", import: "native-base" };
  }

  return undefined;
}

function inferElement(node: NormalizedUINode, componentSuggestion?: ComponentSuggestion): string {
  if (componentSuggestion) return componentSuggestion.component;

  const lowerName = node.name.toLowerCase();

  if (/safe.?area/.test(lowerName)) return "SafeAreaView";
  if (/flat.?list|list/.test(lowerName)) return "FlatList";
  if (node.semantic === "container" && /scroll/.test(lowerName)) return "ScrollView";
  if (node.semantic === "text") return "Text";
  if (node.semantic === "button") return "TouchableOpacity";
  if (node.semantic === "input") return "TextInput";
  if (node.semantic === "image" || node.semantic === "icon") return "Image";
  return "View";
}

function emitNodeNotes(node: NormalizedUINode, componentSuggestion?: ComponentSuggestion): string[] {
  const notes: string[] = [];
  if (node.fills.some((fill) => fill.type === "gradient")) {
    notes.push("Gradient fills need manual React Native gradient implementation.");
  }
  if (node.effects.some((effect) => effect.type === "blur")) {
    notes.push("Blur effects are not directly mapped and need manual review.");
  }
  if (node.semantic === "image" || node.semantic === "icon") {
    notes.push("Image and vector nodes require exported assets for production use.");
  }
  if (node.semantic === "input") {
    notes.push("TextInput bindings and keyboard configuration must be wired manually.");
  }
  if (
    componentSuggestion &&
    node.componentInfo?.variantProperties &&
    Object.keys(node.componentInfo.variantProperties).length > 0
  ) {
    notes.push("Variant properties were mapped to suggested component props when recognized.");
  }
  return notes;
}

function emitReactNativeTree(
  node: NormalizedUINode,
  componentLibrary: ComponentLibrary,
  warnings: string[]
): ReactNativeNode {
  const componentSuggestion = detectComponent(node, componentLibrary);
  const reactNativeNode: ReactNativeNode = {
    element: inferElement(node, componentSuggestion),
    style: emitStyle(node),
    children: node.children.map((child) => emitReactNativeTree(child, componentLibrary, warnings)),
    figmaNodeName: node.name,
    figmaId: node.figmaId,
    notes: emitNodeNotes(node, componentSuggestion),
  };

  if (componentSuggestion) reactNativeNode.componentSuggestion = componentSuggestion;
  if (node.semantic === "text" && node.typography?.content) reactNativeNode.text = node.typography.content;

  if (node.semantic === "divider") {
    reactNativeNode.style["height"] = 1;
    if (reactNativeNode.style["backgroundColor"] === undefined) {
      reactNativeNode.style["backgroundColor"] = node.strokes[0]?.color
        ? normalizeColor(node.strokes[0].color)
        : "#D1D5DB";
    }
  }

  if (node.semantic === "image" || node.semantic === "icon") {
    warnings.push(`"${node.name}" maps to an asset-backed React Native element and needs a real source path.`);
  }

  return reactNativeNode;
}

export async function mapToReactNative(
  input: MapToReactNativeInput,
  clientOptions?: { ttlMs?: number; disableCache?: boolean }
): Promise<MapToReactNativeResult> {
  const client = new FigmaClient(input.access_token, clientOptions);
  const nodeId = input.node_id.replaceAll("-", ":");
  const response = await client.getFileNodes(input.file_key, [nodeId]);
  const rootDoc = response.data.nodes[nodeId]?.document;

  if (!rootDoc) {
    throw new Error(`Node ${input.node_id} not found`);
  }

  const warnings: string[] = [];
  const ast = buildNormalizedUIAST(rootDoc, input.max_depth);
  const reactNativeTree = emitReactNativeTree(ast, input.component_library, warnings);
  const assets = input.include_assets ? collectAssetHints(ast) : [];
  const propTypes = input.include_prop_types ? extractPropTypes(ast) : [];

  return {
    schema_version: SCHEMA_VERSION,
    source: { file_key: input.file_key, node_id: input.node_id },
    freshness: buildFreshness(response.cache),
    warnings,
    data: {
      rootNode: reactNativeTree,
      component_library: input.component_library,
      assets,
      propTypes,
      notes: [],
      cache: response.cache,
    },
  };
}

registerTool({
  name: "map_to_react_native",
  description:
    "Map a Figma frame to a React Native component tree with StyleSheet-style output, mobile component library suggestions, asset hints, and TypeScript prop definitions.",
  schema: mapToReactNativeSchema,
  handler: mapToReactNative,
});
