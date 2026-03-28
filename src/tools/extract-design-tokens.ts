import { z } from "zod";
import { FigmaClient } from "../figma/client.js";
import { buildFreshness, SCHEMA_VERSION } from "../shared.js";
import type { FigmaNode, Color, Paint, StyleMetadata } from "../types/figma.js";
import type {
  ExtractDesignTokensInput,
  ExtractDesignTokensResult,
  ColorToken,
  TypographyToken,
  SpacingToken,
} from "../types/tools.js";

export const extractDesignTokensSchema = z.object({
  file_key: z.string().describe("The Figma file key (from the file URL)"),
  access_token: z.string().describe("Your Figma personal access token"),
  export_format: z
    .enum(["style-dictionary", "css-variables", "tailwind"])
    .optional()
    .default("css-variables")
    .describe("Output format for the exported tokens"),
});

function colorToHex(color: Color): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function colorToRgba(color: Color, opacity = 1): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = (color.a * opacity).toFixed(2);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function toExportTokenName(name: string): string {
  return slugify(name);
}

function resolveStyleName(styleId: string | undefined, styles: Record<string, StyleMetadata>): string | undefined {
  if (!styleId) {
    return undefined;
  }

  return styles[styleId]?.name;
}

function addColorToken(
  seen: Map<string, ColorToken>,
  paint: Paint,
  nodeId: string,
  tokenKey: string,
  tokenName: string,
  figmaStyleName?: string
): void {
  const hex = colorToHex(paint.color as Color);
  const existing = seen.get(tokenKey);
  if (existing) {
    if (!existing.sourceNodeIds.includes(nodeId)) {
      existing.sourceNodeIds.push(nodeId);
    }
    return;
  }

  seen.set(tokenKey, {
    name: tokenName,
    figmaStyleName,
    value: colorToRgba(paint.color as Color, paint.opacity ?? 1),
    hex,
    rgba: {
      r: (paint.color as Color).r,
      g: (paint.color as Color).g,
      b: (paint.color as Color).b,
      a: (paint.color as Color).a,
    },
    opacity: paint.opacity ?? 1,
    sourceNodeIds: [nodeId],
  });
}

function collectColors(
  node: FigmaNode,
  seen: Map<string, ColorToken>,
  styles: Record<string, StyleMetadata>,
  nodeId: string
): void {
  const fillStyleId = node.styles?.["fill"] ?? node.styles?.["fills"];
  const fillStyleName = resolveStyleName(fillStyleId, styles);
  const fills: Paint[] = node.fills ?? [];
  const strokes: Paint[] = node.strokes ?? [];

  for (const paint of fills) {
    if (paint.type === "SOLID" && paint.color && paint.visible !== false) {
      const hex = colorToHex(paint.color);
      addColorToken(
        seen,
        paint,
        nodeId,
        fillStyleId ? `style:${fillStyleId}` : `hex:${hex}@${paint.opacity ?? 1}`,
        fillStyleName ?? slugify(`color-${hex.slice(1)}`),
        fillStyleName
      );
    }
  }

  for (const paint of strokes) {
    if (paint.type === "SOLID" && paint.color && paint.visible !== false) {
      const hex = colorToHex(paint.color);
      addColorToken(seen, paint, nodeId, `hex:${hex}@${paint.opacity ?? 1}`, slugify(`color-${hex.slice(1)}`));
    }
  }

  node.children?.forEach((child) => collectColors(child, seen, styles, child.id));
}

function collectTypography(
  node: FigmaNode,
  seen: Map<string, TypographyToken>,
  styles: Record<string, StyleMetadata>
): void {
  if (node.type === "TEXT" && node.style) {
    const textStyleId = node.styles?.["text"];
    const textStyleName = resolveStyleName(textStyleId, styles);
    const key = textStyleId
      ? `style:${textStyleId}`
      : `${node.style.fontFamily}-${node.style.fontSize}-${node.style.fontWeight}`;
    const existing = seen.get(key);
    if (existing) {
      if (!existing.sourceNodeIds.includes(node.id)) {
        existing.sourceNodeIds.push(node.id);
      }
    } else {
      seen.set(key, {
        name: textStyleName ?? slugify(`text-${node.style.fontFamily}-${node.style.fontSize}`),
        figmaStyleName: textStyleName,
        fontFamily: node.style.fontFamily,
        fontSize: node.style.fontSize,
        fontWeight: node.style.fontWeight,
        lineHeight: node.style.lineHeightPx,
        letterSpacing: node.style.letterSpacing,
        italic: node.style.italic ?? false,
        sourceNodeIds: [node.id],
      });
    }
  }

  node.children?.forEach((child) => collectTypography(child, seen, styles));
}

function collectSpacing(node: FigmaNode, seen: Map<string, SpacingToken>): void {
  const values = [
    node.paddingTop,
    node.paddingRight,
    node.paddingBottom,
    node.paddingLeft,
    node.itemSpacing,
  ].filter((v): v is number => v !== undefined && v > 0);

  for (const value of values) {
    const key = String(value);
    const existing = seen.get(key);
    if (existing) {
      if (!existing.sourceNodeIds.includes(node.id)) existing.sourceNodeIds.push(node.id);
    } else {
      seen.set(key, { name: `spacing-${value}`, value, unit: "px", sourceNodeIds: [node.id] });
    }
  }

  node.children?.forEach((child) => collectSpacing(child, seen));
}

function exportAsCssVariables(colors: ColorToken[], typography: TypographyToken[], spacing: SpacingToken[]): string {
  const lines: string[] = [":root {"];

  for (const color of colors) {
    const tokenName = toExportTokenName(color.name);
    const mapping = color.figmaStyleName ? ` /* ${color.figmaStyleName} -> var(--${tokenName}, ${color.value}) */` : "";
    lines.push(`  --${tokenName}: ${color.value};${mapping}`);
  }
  for (const typo of typography) {
    const tokenName = toExportTokenName(typo.name);
    const familyValue = `"${typo.fontFamily}"`;
    const familyMapping = typo.figmaStyleName
      ? ` /* ${typo.figmaStyleName} -> var(--${tokenName}-family, ${familyValue}) */`
      : "";
    const sizeMapping = typo.figmaStyleName
      ? ` /* ${typo.figmaStyleName} -> var(--${tokenName}-size, ${typo.fontSize}px) */`
      : "";
    const weightMapping = typo.figmaStyleName
      ? ` /* ${typo.figmaStyleName} -> var(--${tokenName}-weight, ${typo.fontWeight}) */`
      : "";
    lines.push(`  --${tokenName}-family: ${familyValue};${familyMapping}`);
    lines.push(`  --${tokenName}-size: ${typo.fontSize}px;${sizeMapping}`);
    lines.push(`  --${tokenName}-weight: ${typo.fontWeight};${weightMapping}`);
    if (typo.lineHeight !== undefined) {
      const lineHeightMapping = typo.figmaStyleName
        ? ` /* ${typo.figmaStyleName} -> var(--${tokenName}-line-height, ${typo.lineHeight}px) */`
        : "";
      lines.push(`  --${tokenName}-line-height: ${typo.lineHeight}px;${lineHeightMapping}`);
    }
  }
  const sortedSpacing = [...spacing].sort((a, b) => a.value - b.value);
  for (const sp of sortedSpacing) {
    lines.push(`  --${sp.name}: ${sp.value}px;`);
  }

  lines.push("}");
  return lines.join("\n");
}

function exportAsStyleDictionary(colors: ColorToken[], typography: TypographyToken[], spacing: SpacingToken[]): string {
  const tokens: Record<string, unknown> = {
    color: Object.fromEntries(
      colors.map((c) => [
        toExportTokenName(c.name),
        { value: c.value, attributes: { hex: c.hex, figmaStyleName: c.figmaStyleName } },
      ])
    ),
    typography: Object.fromEntries(
      typography.map((t) => [
        toExportTokenName(t.name),
        { value: { fontFamily: t.fontFamily, fontSize: `${t.fontSize}px`, fontWeight: t.fontWeight } },
      ])
    ),
    spacing: Object.fromEntries(spacing.map((s) => [s.name, { value: `${s.value}px` }])),
  };
  return JSON.stringify(tokens, null, 2);
}

function exportAsTailwind(colors: ColorToken[], typography: TypographyToken[], spacing: SpacingToken[]): string {
  const config = {
    theme: {
      extend: {
        colors: Object.fromEntries(colors.map((c) => [toExportTokenName(c.name), c.hex])),
        fontFamily: Object.fromEntries(
          typography.map((t) => [toExportTokenName(t.name), [t.fontFamily, "sans-serif"]])
        ),
        spacing: Object.fromEntries(spacing.map((s) => [s.name, `${s.value}px`])),
      },
    },
  };
  return `module.exports = ${JSON.stringify(config, null, 2)};`;
}

export async function extractDesignTokens(
  input: ExtractDesignTokensInput,
  clientOptions?: { ttlMs?: number; disableCache?: boolean }
): Promise<ExtractDesignTokensResult> {
  const client = new FigmaClient(input.access_token, clientOptions);
  const { data: file, cache } = await client.getFile(input.file_key);

  const colorMap = new Map<string, ColorToken>();
  const typographyMap = new Map<string, TypographyToken>();
  const spacingMap = new Map<string, SpacingToken>();

  collectColors(file.document, colorMap, file.styles, file.document.id);
  collectTypography(file.document, typographyMap, file.styles);
  collectSpacing(file.document, spacingMap);

  const colors = Array.from(colorMap.values());
  const typography = Array.from(typographyMap.values());
  const spacing = Array.from(spacingMap.values());

  const format = input.export_format;
  let exported: string;

  switch (format) {
    case "style-dictionary":
      exported = exportAsStyleDictionary(colors, typography, spacing);
      break;
    case "tailwind":
      exported = exportAsTailwind(colors, typography, spacing);
      break;
    default:
      exported = exportAsCssVariables(colors, typography, spacing);
  }

  const resolvedFormat = format ?? "css-variables";

  return {
    schema_version: SCHEMA_VERSION,
    source: { file_key: input.file_key },
    freshness: buildFreshness(cache),
    warnings: [],
    data: { colors, typography, spacing, exported, format: resolvedFormat, cache },
  };
}
