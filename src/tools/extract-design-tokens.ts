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
  include_styles: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether to include named Figma styles in extraction"),
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

function collectColors(node: FigmaNode, seen: Set<string>, tokens: ColorToken[]): void {
  const allPaints: Paint[] = [...(node.fills ?? []), ...(node.strokes ?? [])];

  for (const paint of allPaints) {
    if (paint.type === "SOLID" && paint.color && paint.visible !== false) {
      const hex = colorToHex(paint.color);
      if (!seen.has(hex)) {
        seen.add(hex);
        tokens.push({
          name: slugify(`color-${hex.slice(1)}`),
          value: colorToRgba(paint.color, paint.opacity ?? 1),
          hex,
          rgba: { r: paint.color.r, g: paint.color.g, b: paint.color.b, a: paint.color.a },
          opacity: paint.opacity ?? 1,
        });
      }
    }
  }

  node.children?.forEach((child) => collectColors(child, seen, tokens));
}

function collectTypography(node: FigmaNode, seen: Set<string>, tokens: TypographyToken[]): void {
  if (node.type === "TEXT" && node.style) {
    const key = `${node.style.fontFamily}-${node.style.fontSize}-${node.style.fontWeight}`;
    if (!seen.has(key)) {
      seen.add(key);
      tokens.push({
        name: slugify(`text-${node.style.fontFamily}-${node.style.fontSize}`),
        fontFamily: node.style.fontFamily,
        fontSize: node.style.fontSize,
        fontWeight: node.style.fontWeight,
        lineHeight: node.style.lineHeightPx,
        letterSpacing: node.style.letterSpacing,
        italic: node.style.italic ?? false,
      });
    }
  }

  node.children?.forEach((child) => collectTypography(child, seen, tokens));
}

function collectSpacing(node: FigmaNode, seen: Set<string>, tokens: SpacingToken[]): void {
  const spacingValues = [
    node.paddingTop,
    node.paddingRight,
    node.paddingBottom,
    node.paddingLeft,
    node.itemSpacing,
  ].filter((v): v is number => v !== undefined && v > 0);

  for (const value of spacingValues) {
    const key = String(value);
    if (!seen.has(key)) {
      seen.add(key);
      tokens.push({ name: `spacing-${value}`, value, unit: "px" });
    }
  }

  node.children?.forEach((child) => collectSpacing(child, seen, tokens));
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
    if (typo.lineHeight) lines.push(`  --${typo.name}-line-height: ${typo.lineHeight}px;`);
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
        {
          value: {
            fontFamily: t.fontFamily,
            fontSize: `${t.fontSize}px`,
            fontWeight: t.fontWeight,
          },
        },
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

export async function extractDesignTokens(input: ExtractDesignTokensInput): Promise<ExtractDesignTokensResult> {
  const client = new FigmaClient(input.access_token);
  const file = await client.getFile(input.file_key);

  const colors: ColorToken[] = [];
  const typography: TypographyToken[] = [];
  const spacing: SpacingToken[] = [];

  collectColors(file.document, new Set(), colors);
  collectTypography(file.document, new Set(), typography);
  collectSpacing(file.document, new Set(), spacing);

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

  return { colors, typography, spacing, exported, format };
}
