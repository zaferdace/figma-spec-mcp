import { z } from "zod";
import { FigmaClient } from "../figma/client.js";
import { buildFreshness, SCHEMA_VERSION } from "../shared.js";
import type { Color, FigmaNode, Paint } from "../types/figma.js";
import type { AccessibilityAuditIssue, AuditAccessibilityInput, AuditAccessibilityResult } from "../types/tools.js";
import { registerTool } from "./registry.js";

export const auditAccessibilitySchema = z.object({
  file_key: z.string().describe("The Figma file key (from the file URL)"),
  access_token: z.string().describe("Your Figma personal access token"),
  node_id: z.string().describe("The frame node ID to audit"),
});

function getSolidPaintColor(paints: Paint[] | undefined, opacity = 1): Color | null {
  const paint = paints?.find(
    (candidate) => candidate.type === "SOLID" && candidate.visible !== false && candidate.color
  );
  if (!paint?.color) {
    return null;
  }

  return {
    r: paint.color.r,
    g: paint.color.g,
    b: paint.color.b,
    a: (paint.color.a ?? 1) * (paint.opacity ?? opacity),
  };
}

function relativeLuminance(color: Color): number {
  const convert = (value: number): number => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const r = convert(color.r);
  const g = convert(color.g);
  const b = convert(color.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground: Color, background: Color): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function compositeTextOverBackground(foreground: Color, background: Color): Color {
  const alpha = foreground.a ?? 1;
  return {
    r: foreground.r * alpha + background.r * (1 - alpha),
    g: foreground.g * alpha + background.g * (1 - alpha),
    b: foreground.b * alpha + background.b * (1 - alpha),
    a: 1,
  };
}

function hasUnsupportedBackground(paints: Paint[] | undefined): boolean {
  return (paints ?? []).some((paint) => paint.visible !== false && paint.type !== "SOLID");
}

function findBackgroundColor(node: FigmaNode | null, parents: Map<string, FigmaNode>): Color | null {
  let current = node;
  while (current) {
    const backgroundColor = getSolidPaintColor(current.fills, current.opacity ?? 1);
    if (backgroundColor) {
      return backgroundColor;
    }
    current = parents.get(current.id) ?? null;
  }

  return null;
}

function isLargeText(node: FigmaNode): boolean {
  const fontSize = node.style?.fontSize ?? 0;
  const fontWeight = node.style?.fontWeight ?? 400;
  // WCAG 2.1 SC 1.4.3 defines large-scale text as 18pt regular (~24px) or 14pt bold (~18.66px).
  return fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
}

function hasClickHandler(node: FigmaNode): boolean {
  return (node.reactions ?? []).some((reaction) => reaction.action?.type === "NODE");
}

function pushIssue(
  issues: AccessibilityAuditIssue[],
  node: FigmaNode,
  rule: string,
  severity: "error" | "warning" | "info",
  message: string,
  details: string
): void {
  issues.push({
    nodeId: node.id,
    nodeName: node.name,
    rule,
    severity,
    message,
    details,
  });
}

interface ColorSignatureEntry {
  node: FigmaNode;
  signature: string;
}

function auditNode(
  node: FigmaNode,
  parent: FigmaNode | null,
  parents: Map<string, FigmaNode>,
  issues: AccessibilityAuditIssue[],
  colorSignatureEntries: ColorSignatureEntry[]
): void {
  if (node.type === "TEXT" && node.style) {
    const size = node.style.fontSize;
    if (size < 11) {
      pushIssue(issues, node, "font-size", "warning", `Font size ${size}px is below 11px.`, `fontSize=${size}`);
    }

    const textColor = getSolidPaintColor(node.fills, node.opacity ?? 1);
    const backgroundColor = findBackgroundColor(parent, parents);
    if (textColor && backgroundColor) {
      const compositedTextColor = compositeTextOverBackground(textColor, backgroundColor);
      const ratio = contrastRatio(compositedTextColor, backgroundColor);
      const minimum = isLargeText(node) ? 3 : 4.5;
      if (ratio < minimum) {
        pushIssue(
          issues,
          node,
          "contrast-ratio",
          "error",
          `Contrast ratio ${ratio.toFixed(2)}:1 is below the required ${minimum}:1.`,
          `foreground=${JSON.stringify(compositedTextColor)}, background=${JSON.stringify(backgroundColor)}`
        );
      }
    } else if (textColor) {
      pushIssue(
        issues,
        node,
        "contrast-background-undetermined",
        "info",
        "Unable to determine background color for contrast check — gradient, image, or transparent background",
        hasUnsupportedBackground(parent?.fills) ? "background=non-solid-fill" : "background=transparent-or-missing"
      );
    }
  }

  const interactive =
    node.type === "COMPONENT" || node.type === "INSTANCE" || (node.type === "FRAME" && hasClickHandler(node));
  if (interactive && node.absoluteBoundingBox) {
    const { width, height } = node.absoluteBoundingBox;
    if (width < 44 || height < 44) {
      pushIssue(
        issues,
        node,
        "touch-target",
        "warning",
        `Interactive target ${Math.round(width)}x${Math.round(height)}px is smaller than 44x44px.`,
        `width=${width}, height=${height}`
      );
    }
  }

  const isImageLike =
    node.type === "IMAGE" ||
    node.name.toLowerCase() === "image" ||
    node.name.toLowerCase() === "img" ||
    (node.fills ?? []).some((paint) => paint.type === "IMAGE");
  if (isImageLike && !node.description?.trim()) {
    pushIssue(
      issues,
      node,
      "missing-alt-text",
      "warning",
      "Image-like node is missing description text.",
      "description=empty"
    );
  }

  const fillColor = getSolidPaintColor(node.fills, node.opacity ?? 1);
  if (fillColor) {
    colorSignatureEntries.push({
      node,
      signature: [
        node.type,
        Math.round(node.absoluteBoundingBox?.width ?? 0),
        Math.round(node.absoluteBoundingBox?.height ?? 0),
        node.characters ?? "",
      ].join("|"),
    });
  }

  node.children?.forEach((child) => {
    parents.set(child.id, node);
    auditNode(child, node, parents, issues, colorSignatureEntries);
  });
}

function auditColorOnly(entries: ColorSignatureEntry[], issues: AccessibilityAuditIssue[]): void {
  const grouped = new Map<string, FigmaNode[]>();
  entries.forEach(({ node, signature }) => {
    const current = grouped.get(signature) ?? [];
    current.push(node);
    grouped.set(signature, current);
  });

  grouped.forEach((nodes) => {
    if (nodes.length < 2) {
      return;
    }

    const colors = new Set(
      nodes
        .map((node) => {
          const color = getSolidPaintColor(node.fills, node.opacity ?? 1);
          return color ? JSON.stringify(color) : null;
        })
        .filter((value): value is string => value !== null)
    );

    if (colors.size > 1) {
      nodes.forEach((node) => {
        pushIssue(
          issues,
          node,
          "color-only-information",
          "info",
          "Similar sibling elements appear to differ mainly by fill color.",
          `groupSize=${nodes.length}`
        );
      });
    }
  });
}

export async function auditAccessibility(
  input: AuditAccessibilityInput,
  clientOptions?: { ttlMs?: number; disableCache?: boolean }
): Promise<AuditAccessibilityResult> {
  const client = new FigmaClient(input.access_token, clientOptions);
  const normalizedId = input.node_id.replaceAll("-", ":");
  const response = await client.getFileNodes(input.file_key, [normalizedId]);
  const root = response.data.nodes[normalizedId]?.document;

  if (!root) {
    throw new Error(`Node "${input.node_id}" not found in file "${input.file_key}"`);
  }

  const issues: AccessibilityAuditIssue[] = [];
  const colorSignatureEntries: ColorSignatureEntry[] = [];
  const parents = new Map<string, FigmaNode>();
  auditNode(root, null, parents, issues, colorSignatureEntries);
  auditColorOnly(colorSignatureEntries, issues);

  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  const info = issues.filter((issue) => issue.severity === "info").length;
  const score = Math.max(0, Math.min(100, 100 - errors * 10 - warnings * 3 - info));

  return {
    schema_version: SCHEMA_VERSION,
    source: { file_key: input.file_key, node_id: input.node_id },
    freshness: buildFreshness(response.cache),
    warnings: [],
    data: {
      issues,
      summary: { errors, warnings, info, score },
      cache: response.cache,
    },
  };
}

registerTool({
  name: "audit_accessibility",
  description:
    "Audits a Figma frame for WCAG 2.1 accessibility issues: contrast ratios, touch targets, missing alt text, font sizes. Returns issues with severity levels and an overall accessibility score.",
  schema: auditAccessibilitySchema,
  handler: auditAccessibility,
});
