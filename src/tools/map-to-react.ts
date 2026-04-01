import { z } from "zod";
import { FigmaClient } from "../figma/client.js";
import { SCHEMA_VERSION, buildFreshness } from "../shared.js";
import type {
  AssetHint,
  ComponentSuggestion,
  MapToReactInput,
  MapToReactResult,
  PropTypeDefinition,
  ReactNode,
} from "../types/tools.js";
import { buildNormalizedUIAST, type NormalizedUINode } from "./normalized-ui-ast.js";
import { registerTool } from "./registry.js";

export const mapToReactSchema = z.object({
  access_token: z.string().describe("Figma personal access token"),
  file_key: z.string().describe("Figma file key"),
  node_id: z.string().describe("Node ID of the frame to map"),
  style_format: z
    .enum(["tailwind", "css_modules", "styled_components", "inline"])
    .default("tailwind")
    .describe("CSS output format"),
  component_library: z
    .enum(["shadcn", "mui", "chakra", "radix", "plain"])
    .default("plain")
    .describe("Target component library for element mapping"),
  include_assets: z.boolean().default(true).describe("Include asset export hints"),
  include_prop_types: z.boolean().default(true).describe("Generate TypeScript prop interfaces from variants"),
  max_depth: z.number().default(10).describe("Maximum node tree depth"),
});

type StyleFormat = MapToReactInput["style_format"];
type ComponentLibrary = MapToReactInput["component_library"];

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

function roundTailwindUnit(value: number): number {
  return Math.max(0, Math.round(value / 4));
}

function normalizeHex8To6(color: string): string {
  return color.length === 9 && color.endsWith("FF") ? color.slice(0, 7) : color;
}

function mapNamedColor(color: string, prefix: "bg" | "text" | "border"): string {
  const normalized = normalizeHex8To6(color).toLowerCase();
  const named = normalized === "#ffffff" ? "white" : normalized === "#000000" ? "black" : undefined;
  return named ? `${prefix}-${named}` : `${prefix}-[${color}]`;
}

function mapRadiusClass(radius: number): string {
  if (radius <= 0) return "rounded-none";
  if (radius <= 2) return "rounded-sm";
  if (radius <= 4) return "rounded";
  if (radius <= 6) return "rounded-md";
  if (radius <= 8) return "rounded-lg";
  if (radius <= 12) return "rounded-xl";
  if (radius <= 16) return "rounded-2xl";
  if (radius >= 999) return "rounded-full";
  return `rounded-[${radius}px]`;
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
  if (weight >= 700) return "bold";
  if (weight >= 600) return "semibold";
  if (weight >= 500) return "medium";
  if (weight >= 400) return "normal";
  return "light";
}

function mapOpacityClass(opacity: number): string | undefined {
  if (opacity >= 1) return undefined;
  return `opacity-${Math.max(0, Math.min(100, Math.round(opacity * 100)))}`;
}

function mapShadowClass(radius: number): string {
  if (radius <= 2) return "shadow-sm";
  if (radius <= 6) return "shadow";
  if (radius <= 12) return "shadow-md";
  if (radius <= 20) return "shadow-lg";
  return "shadow-xl";
}

function pushPaddingClasses(classes: string[], padding: NormalizedUINode["layout"]["padding"]): void {
  const { top, right, bottom, left } = padding;
  if (top === right && top === bottom && top === left && top > 0) {
    classes.push(`p-${roundTailwindUnit(top)}`);
    return;
  }

  if (left === right && top === bottom && top > 0 && left > 0) {
    classes.push(`px-${roundTailwindUnit(left)}`, `py-${roundTailwindUnit(top)}`);
    return;
  }

  if (top > 0) classes.push(`pt-${roundTailwindUnit(top)}`);
  if (right > 0) classes.push(`pr-${roundTailwindUnit(right)}`);
  if (bottom > 0) classes.push(`pb-${roundTailwindUnit(bottom)}`);
  if (left > 0) classes.push(`pl-${roundTailwindUnit(left)}`);
}

function emitTailwindClasses(node: NormalizedUINode): string {
  const classes: string[] = [];

  if (node.layout.direction === "row") classes.push("flex", "flex-row");
  else if (node.layout.direction === "column") classes.push("flex", "flex-col");
  else if (node.children.length > 0) classes.push("relative");

  if (node.layout.gap > 0) classes.push(`gap-${roundTailwindUnit(node.layout.gap)}`);
  pushPaddingClasses(classes, node.layout.padding);

  if (node.sizing.widthMode === "fill") classes.push("w-full");
  else if (node.sizing.widthMode === "hug") classes.push("w-fit");
  else if (node.sizing.width !== null) classes.push(`w-[${Math.round(node.sizing.width)}px]`);

  if (node.sizing.heightMode === "fill") classes.push("h-full");
  else if (node.sizing.heightMode === "hug") classes.push("h-fit");
  else if (node.sizing.height !== null) classes.push(`h-[${Math.round(node.sizing.height)}px]`);

  const solidFill = node.fills.find((fill) => fill.type === "solid" && fill.color);
  if (solidFill?.color) classes.push(mapNamedColor(solidFill.color, "bg"));

  if (node.strokes[0]) {
    classes.push("border", mapNamedColor(node.strokes[0].color, "border"));
    if (node.strokes[0].weight !== 1) classes.push(`border-[${node.strokes[0].weight}px]`);
  }

  const radius = getUniformRadius(node.cornerRadius);
  if (radius.uniform) classes.push(mapRadiusClass(radius.value));

  const opacityClass = mapOpacityClass(node.opacity);
  if (opacityClass) classes.push(opacityClass);

  const shadow = node.effects.find((effect) => effect.type === "drop-shadow");
  if (shadow) classes.push(mapShadowClass(shadow.radius));

  if (node.layout.direction !== "none") {
    const justifyMap: Record<NormalizedUINode["layout"]["mainAxisAlignment"], string> = {
      start: "justify-start",
      center: "justify-center",
      end: "justify-end",
      "space-between": "justify-between",
    };
    const itemsMap: Record<NormalizedUINode["layout"]["crossAxisAlignment"], string> = {
      start: "items-start",
      center: "items-center",
      end: "items-end",
      stretch: "items-stretch",
    };
    classes.push(justifyMap[node.layout.mainAxisAlignment], itemsMap[node.layout.crossAxisAlignment]);
    if (node.layout.wrap) classes.push("flex-wrap");
  }

  if (node.typography) {
    classes.push(
      `text-[${node.typography.fontSize}px]`,
      `font-${mapFontWeight(node.typography.fontWeight)}`,
      `text-${node.typography.textAlign}`,
      mapNamedColor(node.typography.color, "text")
    );
    if (node.typography.lineHeight !== "auto") classes.push(`leading-[${node.typography.lineHeight}px]`);
    if (node.typography.textDecoration === "underline") classes.push("underline");
    if (node.typography.textDecoration === "line-through") classes.push("line-through");
  }

  return classes.join(" ");
}

function emitSizeProperty(
  properties: Record<string, string>,
  key: "width" | "height",
  mode: "fixed" | "hug" | "fill",
  value: number | null
): void {
  if (mode === "fill") {
    properties[key] = "100%";
    return;
  }

  if (mode === "hug") {
    properties[key] = "fit-content";
    return;
  }

  if (value !== null) properties[key] = `${Math.round(value)}px`;
}

function emitCornerRadiusProperties(
  properties: Record<string, string>,
  radius: NormalizedUINode["cornerRadius"]
): void {
  const cornerRadius = getUniformRadius(radius);
  if (cornerRadius.uniform) {
    properties["border-radius"] = `${cornerRadius.value}px`;
    return;
  }

  const values = cornerRadius.values;
  if (!values) return;
  properties["border-top-left-radius"] = `${values.topLeft}px`;
  properties["border-top-right-radius"] = `${values.topRight}px`;
  properties["border-bottom-right-radius"] = `${values.bottomRight}px`;
  properties["border-bottom-left-radius"] = `${values.bottomLeft}px`;
}

function emitBaseCSSProperties(node: NormalizedUINode): Record<string, string> {
  const properties: Record<string, string> = {};

  if (node.layout.direction !== "none") {
    properties["display"] = "flex";
    properties["flex-direction"] = node.layout.direction;
    properties["justify-content"] =
      node.layout.mainAxisAlignment === "space-between" ? "space-between" : `flex-${node.layout.mainAxisAlignment}`;
    properties["align-items"] =
      node.layout.crossAxisAlignment === "stretch" ? "stretch" : `flex-${node.layout.crossAxisAlignment}`;
    if (node.layout.wrap) properties["flex-wrap"] = "wrap";
  }

  if (node.layout.gap > 0) properties["gap"] = `${node.layout.gap}px`;

  const { top, right, bottom, left } = node.layout.padding;
  if (top || right || bottom || left) properties["padding"] = `${top}px ${right}px ${bottom}px ${left}px`;

  emitSizeProperty(properties, "width", node.sizing.widthMode, node.sizing.width);
  emitSizeProperty(properties, "height", node.sizing.heightMode, node.sizing.height);

  if (typeof node.sizing.minWidth === "number") properties["min-width"] = `${node.sizing.minWidth}px`;
  if (typeof node.sizing.maxWidth === "number") properties["max-width"] = `${node.sizing.maxWidth}px`;

  const solidFill = node.fills.find((fill) => fill.type === "solid" && fill.color);
  if (solidFill?.color) properties["background-color"] = solidFill.color;

  const gradientFill = node.fills.find((fill) => fill.type === "gradient" && fill.gradientStops);
  if (gradientFill?.gradientStops) {
    properties["background"] = `linear-gradient(90deg, ${gradientFill.gradientStops
      .map((stop) => `${stop.color} ${Math.round(stop.position * 100)}%`)
      .join(", ")})`;
  }

  if (node.strokes[0]) properties["border"] = `${node.strokes[0].weight}px solid ${node.strokes[0].color}`;

  emitCornerRadiusProperties(properties, node.cornerRadius);

  if (node.opacity < 1) properties["opacity"] = String(node.opacity);

  const shadow = node.effects.find((effect) => effect.type === "drop-shadow");
  if (shadow) {
    properties["box-shadow"] = `${shadow.offset?.x ?? 0}px ${shadow.offset?.y ?? 0}px ${shadow.radius}px ${
      shadow.spread ?? 0
    }px ${shadow.color ?? "#00000033"}`;
  }

  if (node.typography) {
    properties["font-family"] = node.typography.fontFamily;
    properties["font-size"] = `${node.typography.fontSize}px`;
    properties["font-weight"] = String(node.typography.fontWeight);
    properties["text-align"] = node.typography.textAlign;
    properties["color"] = node.typography.color;
    if (node.typography.lineHeight !== "auto") properties["line-height"] = `${node.typography.lineHeight}px`;
    if (node.typography.letterSpacing !== 0) properties["letter-spacing"] = `${node.typography.letterSpacing}px`;
    if (node.typography.textDecoration !== "none") properties["text-decoration"] = node.typography.textDecoration;
  }

  return properties;
}

function emitCSSModuleRule(
  node: NormalizedUINode,
  name: string
): { selector: string; properties: Record<string, string> } {
  return {
    selector: `.${name}`,
    properties: emitBaseCSSProperties(node),
  };
}

function kebabToCamelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function emitStyledCSS(node: NormalizedUINode): Record<string, string> {
  return Object.fromEntries(
    Object.entries(emitBaseCSSProperties(node)).map(([key, value]) => [kebabToCamelCase(key), value])
  );
}

function emitInlineStyle(node: NormalizedUINode): Record<string, string | number> {
  const style: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(emitStyledCSS(node))) {
    style[key] = /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
  }
  return style;
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
        ? "default"
        : normalizedValue === "secondary"
          ? "secondary"
          : normalizedValue === "outline"
            ? "outline"
            : normalizedValue === "ghost"
              ? "ghost"
              : normalizedValue;
    return ["variant", mapped, true] as const;
  }

  return [toCamelCase(key), value, false] as const;
}

function detectComponent(node: NormalizedUINode, library: ComponentLibrary): ComponentSuggestion | undefined {
  if (library === "plain") return undefined;

  const lowerName = node.name.toLowerCase();
  const hasTextChild = node.children.some((child) => child.semantic === "text");
  const hasFill = node.fills.length > 0;
  const hasShadow = node.effects.some((effect) => effect.type === "drop-shadow");
  const isButton = node.semantic === "button" || (/button|btn|cta/i.test(lowerName) && hasTextChild && hasFill);
  const isInput = node.semantic === "input" || /input|field|textfield|search|email|password/i.test(lowerName);
  const isCard = node.semantic === "container" && hasShadow && node.layout.padding.top > 0 && node.children.length > 1;
  const isAvatar =
    /avatar|profile/i.test(lowerName) &&
    typeof node.cornerRadius === "number" &&
    node.cornerRadius >= (Math.min(node.sizing.width ?? 0, node.sizing.height ?? 0) || 0) / 2 - 1 &&
    node.fills.some((fill) => fill.type === "image");
  const isBadge = /badge|tag|chip/i.test(lowerName) && hasTextChild && (node.sizing.height ?? 0) <= 40;
  const isCheckbox = /check|toggle|switch/i.test(lowerName);
  const isSelect = /select|dropdown|picker/i.test(lowerName);
  const isDivider = node.semantic === "divider";
  const variantProps = Object.fromEntries(
    Object.entries(node.componentInfo?.variantProperties ?? {})
      .map(([key, value]) => {
        const [mappedKey, mappedValue, include] = mapVariantValue(key, value);
        return include ? ([mappedKey, mappedValue] as const) : undefined;
      })
      .filter((entry): entry is readonly [string, string] => Boolean(entry))
  );

  if (isDivider) {
    if (library === "shadcn") return { library, component: "Separator", import: "@/components/ui/separator" };
    if (library === "mui") return { library, component: "Divider", import: "@mui/material/Divider" };
    if (library === "chakra") return { library, component: "Divider", import: "@chakra-ui/react" };
    if (library === "radix") return { library, component: "Separator", import: "@radix-ui/react-separator" };
  }

  if (isButton) {
    if (library === "shadcn")
      return { library, component: "Button", import: "@/components/ui/button", props: variantProps };
    if (library === "mui") return { library, component: "Button", import: "@mui/material/Button", props: variantProps };
    if (library === "chakra") return { library, component: "Button", import: "@chakra-ui/react", props: variantProps };
    if (library === "radix") return { library, component: "Button", props: variantProps };
  }

  if (isInput) {
    if (library === "shadcn")
      return { library, component: "Input", import: "@/components/ui/input", props: variantProps };
    if (library === "mui")
      return { library, component: "TextField", import: "@mui/material/TextField", props: variantProps };
    if (library === "chakra") return { library, component: "Input", import: "@chakra-ui/react", props: variantProps };
    if (library === "radix") return { library, component: "TextField", props: variantProps };
  }

  if (isCard) {
    if (library === "shadcn") return { library, component: "Card", import: "@/components/ui/card" };
    if (library === "mui") return { library, component: "Card", import: "@mui/material/Card" };
    if (library === "chakra") return { library, component: "Card", import: "@chakra-ui/react" };
    if (library === "radix") return { library, component: "Card" };
  }

  if (isAvatar) {
    if (library === "shadcn") return { library, component: "Avatar", import: "@/components/ui/avatar" };
    if (library === "mui") return { library, component: "Avatar", import: "@mui/material/Avatar" };
    if (library === "chakra") return { library, component: "Avatar", import: "@chakra-ui/react" };
    if (library === "radix") return { library, component: "Avatar" };
  }

  if (isBadge) {
    if (library === "shadcn")
      return { library, component: "Badge", import: "@/components/ui/badge", props: variantProps };
    if (library === "mui") return { library, component: "Chip", import: "@mui/material/Chip", props: variantProps };
    if (library === "chakra") return { library, component: "Badge", import: "@chakra-ui/react", props: variantProps };
    if (library === "radix") return { library, component: "Badge", props: variantProps };
  }

  if (isCheckbox) {
    if (library === "shadcn")
      return { library, component: "Checkbox", import: "@/components/ui/checkbox", props: variantProps };
    if (library === "mui")
      return { library, component: "Checkbox", import: "@mui/material/Checkbox", props: variantProps };
    if (library === "chakra") return { library, component: "Switch", import: "@chakra-ui/react", props: variantProps };
    if (library === "radix") return { library, component: "Switch", props: variantProps };
  }

  if (isSelect) {
    if (library === "shadcn")
      return { library, component: "Select", import: "@/components/ui/select", props: variantProps };
    if (library === "mui") return { library, component: "Select", import: "@mui/material/Select", props: variantProps };
    if (library === "chakra") return { library, component: "Select", import: "@chakra-ui/react", props: variantProps };
    if (library === "radix") return { library, component: "Select", props: variantProps };
  }

  return undefined;
}

function inferElement(node: NormalizedUINode, componentSuggestion?: ComponentSuggestion): string {
  if (componentSuggestion) return componentSuggestion.component;
  if (node.semantic === "text") {
    if ((node.typography?.fontSize ?? 0) >= 32) return "h1";
    if ((node.typography?.fontSize ?? 0) >= 24) return "h2";
    if ((node.typography?.fontSize ?? 0) >= 18) return "p";
    return "span";
  }
  if (node.semantic === "button") return "button";
  if (node.semantic === "input") return "input";
  if (node.semantic === "divider") return "hr";
  if (node.semantic === "image" || node.semantic === "icon") return "img";
  return "div";
}

function emitNodeNotes(node: NormalizedUINode, componentSuggestion?: ComponentSuggestion): string[] {
  const notes: string[] = [];
  if (node.fills.some((fill) => fill.type === "gradient")) {
    notes.push("Gradient fills may require manual review for exact fidelity.");
  }
  if (node.effects.some((effect) => effect.type === "blur")) {
    notes.push("Blur effects are emitted as style hints and may need manual implementation.");
  }
  if (node.semantic === "image" || node.semantic === "icon") {
    notes.push("Image and vector nodes require exported assets for production use.");
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

function emitReactTree(
  node: NormalizedUINode,
  styleFormat: StyleFormat,
  componentLibrary: ComponentLibrary,
  warnings: string[]
): ReactNode {
  const componentSuggestion = detectComponent(node, componentLibrary);
  const styleName = `${slugify(node.name) || "node"}-${node.figmaId.replace(/[:]/g, "-")}`;
  const reactNode: ReactNode = {
    element: inferElement(node, componentSuggestion),
    children: node.children.map((child) => emitReactTree(child, styleFormat, componentLibrary, warnings)),
    figmaNodeName: node.name,
    figmaId: node.figmaId,
    notes: emitNodeNotes(node, componentSuggestion),
  };
  if (componentSuggestion) reactNode.componentSuggestion = componentSuggestion;

  if (node.semantic === "text" && node.typography?.content) reactNode.text = node.typography.content;

  if (styleFormat === "tailwind") {
    reactNode.className = emitTailwindClasses(node);
  } else if (styleFormat === "css_modules") {
    reactNode.className = styleName;
    reactNode.cssRule = emitCSSModuleRule(node, styleName);
  } else if (styleFormat === "styled_components") {
    reactNode.style = emitStyledCSS(node);
  } else {
    reactNode.style = emitInlineStyle(node);
  }

  if (node.semantic === "image" || node.semantic === "icon") {
    warnings.push(`"${node.name}" maps to an asset-backed element and may need a real exported source path.`);
  }

  return reactNode;
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
      if (lowerValue === "primary") return "default";
      if (lowerValue === "secondary") return "secondary";
      if (lowerValue === "outline") return "outline";
      if (lowerValue === "ghost") return "ghost";
      return lowerValue;
    });
    return {
      name: "variant",
      type: Array.from(new Set(mapped))
        .map((value) => `'${value}'`)
        .join(" | "),
      required: false,
      defaultValue: `'${mapped[0] ?? "default"}'`,
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

export async function mapToReact(
  input: MapToReactInput,
  clientOptions?: { ttlMs?: number; disableCache?: boolean }
): Promise<MapToReactResult> {
  const client = new FigmaClient(input.access_token, clientOptions);
  const nodeId = input.node_id.replaceAll("-", ":");
  const response = await client.getFileNodes(input.file_key, [nodeId]);
  const rootDoc = response.data.nodes[nodeId]?.document;

  if (!rootDoc) {
    throw new Error(`Node ${input.node_id} not found`);
  }

  const warnings: string[] = [];
  const ast = buildNormalizedUIAST(rootDoc, input.max_depth);
  const reactTree = emitReactTree(ast, input.style_format, input.component_library, warnings);
  const assets = input.include_assets ? collectAssetHints(ast) : [];
  const propTypes = input.include_prop_types ? extractPropTypes(ast) : [];

  return {
    schema_version: SCHEMA_VERSION,
    source: { file_key: input.file_key, node_id: input.node_id },
    freshness: buildFreshness(response.cache),
    warnings,
    data: {
      rootNode: reactTree,
      style_format: input.style_format,
      component_library: input.component_library,
      assets,
      propTypes,
      notes: [],
      cache: response.cache,
    },
  };
}

registerTool({
  name: "map_to_react",
  description:
    "Map a Figma frame to a React component tree with JSX structure, Tailwind or CSS styling output, component library suggestions, asset hints, and TypeScript prop definitions.",
  schema: mapToReactSchema,
  handler: mapToReact,
});
