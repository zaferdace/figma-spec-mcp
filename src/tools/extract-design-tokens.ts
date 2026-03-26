import { z } from "zod";
import { FigmaClient } from "../figma/client.js";
import type { FigmaNode, Color, Paint } from "../types/figma.js";
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

function collectColors(node: FigmaNode, seen: Map<string, ColorToken>, nodeId: string): void {
  const allPaints: Paint[] = [...(node.fills ?? []), ...(node.strokes ?? [])];

  for (const paint of allPaints) {
    if (paint.type === "SOLID" && paint.color && paint.visible !== false) {
      const hex = colorToHex(paint.color);
      const existing = seen.get(hex);
      if (existing) {
        existing.sourceNodeIds.push(nodeId);
      } else {
        seen.set(hex, {
          name: slugify(`color-${hex.slice(1)}`),
          value: colorToRgba(paint.color, paint.opacity ?? 1),
          hex,
          rgba: { r: paint.color.r, g: paint.color.g, b: paint.color.b, a: paint.color.a },
          opacity: paint.opacity ?? 1,
          sourceNodeIds: [nodeId],
        });
      }
    }
  }

  node.children?.forEach((child) => collectColors(child, seen, child.id));
}

function collectTypography(node: FigmaNode, seen: Map<string, TypographyToken>): void {
  if (node.type === "TEXT" && node.style) {
    const key = `${node.style.fontFamily}-${node.style.fontSize}-${node.style.fontWeight}`;
    const existing = seen.get(key);
    if (existing) {
      existing.sourceNodeIds.push(node.id);
    } else {
      seen.set(key, {
        name: slugify(`text-${node.style.fontFamily}-${node.style.fontSize}`),
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

  node.children?.forEach((child) => collectTypography(child, seen));
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
    lines.push(`  --${color.name}: ${color.value};`);
  }
  for (const typo of typography) {
    lines.push(`  --${typo.name}-family: "${typo.fontFamily}";`);
    lines.push(`  --${typo.name}-size: ${typo.fontSize}px;`);
    lines.push(`  --${typo.name}-weight: ${typo.fontWeight};`);
    if (typo.lineHeight !== undefined) lines.push(`  --${typo.name}-line-height: ${typo.lineHeight}px;`);
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
    color: Object.fromEntries(colors.map((c) => [c.name, { value: c.value, attributes: { hex: c.hex } }])),
    typography: Object.fromEntries(
      typography.map((t) => [
        t.name,
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
        colors: Object.fromEntries(colors.map((c) => [c.name, c.hex])),
        fontFamily: Object.fromEntries(typography.map((t) => [slugify(t.fontFamily), [t.fontFamily, "sans-serif"]])),
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

  collectColors(file.document, colorMap, file.document.id);
  collectTypography(file.document, typographyMap);
  collectSpacing(file.document, spacingMap);

  const colors = Array.from(colorMap.values());
  const typography = Array.from(typographyMap.values());
  const spacing = Array.from(spacingMap.values());

  const format = input.export_format ?? "css-variables";
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

  return { schema: "figma-spec/extract-design-tokens@1", colors, typography, spacing, exported, format, cache };
}
