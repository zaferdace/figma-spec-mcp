import { z } from "zod";
import { FigmaClient } from "../figma/client.js";
import { buildFreshness, SCHEMA_VERSION } from "../shared.js";
import type { FigmaNode } from "../types/figma.js";
import type { SimplifiedNode, SimplifyContextInput, SimplifyContextResult } from "../types/tools.js";
import { registerTool } from "./registry.js";

export const simplifyContextSchema = z.object({
  file_key: z.string().describe("The Figma file key (from the file URL)"),
  access_token: z.string().describe("Your Figma personal access token"),
  node_id: z.string().describe("The frame node ID to simplify"),
  max_tokens: z.number().optional().default(4000),
  framework: z.enum(["web", "react", "unity", "swiftui"]).optional(),
});

interface SimplifyState {
  nextId: number;
  remainingNodes: number;
  truncated: boolean;
}

function makeShortId(state: SimplifyState): string {
  const id = `n${state.nextId}`;
  state.nextId += 1;
  return id;
}

function nonZeroLayout(node: FigmaNode): Record<string, number | string> | undefined {
  const layout = {
    mode: node.layoutMode && node.layoutMode !== "NONE" ? node.layoutMode.toLowerCase() : undefined,
    gap: node.itemSpacing && node.itemSpacing !== 0 ? node.itemSpacing : undefined,
    paddingTop: node.paddingTop && node.paddingTop !== 0 ? node.paddingTop : undefined,
    paddingRight: node.paddingRight && node.paddingRight !== 0 ? node.paddingRight : undefined,
    paddingBottom: node.paddingBottom && node.paddingBottom !== 0 ? node.paddingBottom : undefined,
    paddingLeft: node.paddingLeft && node.paddingLeft !== 0 ? node.paddingLeft : undefined,
  };

  return Object.fromEntries(
    Object.entries(layout).filter((entry): entry is [string, number | string] => entry[1] !== undefined)
  );
}

function nonDefaultStyle(node: FigmaNode): Record<string, string | number> | undefined {
  const style = {
    opacity: node.opacity !== undefined && node.opacity !== 1 ? node.opacity : undefined,
    radius: node.cornerRadius && node.cornerRadius !== 0 ? node.cornerRadius : undefined,
    fontFamily: node.style?.fontFamily,
    fontSize: node.style?.fontSize,
    fontWeight: node.style?.fontWeight && node.style.fontWeight !== 400 ? node.style.fontWeight : undefined,
  };

  return Object.fromEntries(
    Object.entries(style).filter((entry): entry is [string, string | number] => entry[1] !== undefined)
  );
}

function frameworkHints(node: FigmaNode, framework: SimplifyContextInput["framework"]): string[] | undefined {
  if (!framework) {
    return undefined;
  }

  const hints: string[] = [];
  if (framework === "react" && node.layoutMode && node.layoutMode !== "NONE") {
    hints.push("flex");
  }
  if (framework === "unity" && node.type === "TEXT") {
    hints.push("TextMeshProUGUI");
  }
  if (framework === "swiftui" && node.layoutMode === "HORIZONTAL") {
    hints.push("HStack");
  }
  if (framework === "web" && node.type === "FRAME") {
    hints.push("div");
  }
  return hints.length > 0 ? hints : undefined;
}

function collapseWrappers(node: FigmaNode): FigmaNode {
  let current = node;
  while (
    current.type === "FRAME" &&
    (current.children?.length ?? 0) === 1 &&
    !current.characters &&
    (!current.fills || current.fills.length === 0) &&
    (!current.strokes || current.strokes.length === 0) &&
    (!current.effects || current.effects.length === 0) &&
    (current.opacity ?? 1) === 1 &&
    (current.cornerRadius ?? 0) === 0
  ) {
    const child = current.children?.[0];
    if (!child) {
      break;
    }
    const inherited: FigmaNode = { ...child };
    if (inherited.layoutMode === undefined && current.layoutMode !== undefined) {
      inherited.layoutMode = current.layoutMode;
    }
    if (inherited.itemSpacing === undefined && current.itemSpacing !== undefined) {
      inherited.itemSpacing = current.itemSpacing;
    }
    if (inherited.paddingTop === undefined && current.paddingTop !== undefined) {
      inherited.paddingTop = current.paddingTop;
    }
    if (inherited.paddingRight === undefined && current.paddingRight !== undefined) {
      inherited.paddingRight = current.paddingRight;
    }
    if (inherited.paddingBottom === undefined && current.paddingBottom !== undefined) {
      inherited.paddingBottom = current.paddingBottom;
    }
    if (inherited.paddingLeft === undefined && current.paddingLeft !== undefined) {
      inherited.paddingLeft = current.paddingLeft;
    }
    current = inherited;
  }
  return current;
}

function siblingSignature(node: SimplifiedNode): string {
  return JSON.stringify({
    name: node.name,
    type: node.type,
    text: node.text,
    layout: node.layout,
    style: node.style,
    size: node.size,
    hints: node.hints,
    children: node.children?.map((child) => siblingSignature(child)),
  });
}

function groupSiblings(children: SimplifiedNode[]): SimplifiedNode[] {
  const grouped: SimplifiedNode[] = [];
  let index = 0;

  while (index < children.length) {
    const current = children[index];
    if (!current) {
      index += 1;
      continue;
    }

    const signature = siblingSignature(current);
    let count = 1;
    while (index + count < children.length && siblingSignature(children[index + count] as SimplifiedNode) === signature) {
      count += 1;
    }

    grouped.push(count > 1 ? { ...current, name: `${current.name} x${count}`, count } : current);
    index += count;
  }

  return grouped;
}

function simplifyNode(node: FigmaNode, state: SimplifyState, framework?: SimplifyContextInput["framework"]): SimplifiedNode | null {
  if (state.remainingNodes <= 0) {
    state.truncated = true;
    return null;
  }

  state.remainingNodes -= 1;
  const collapsed = collapseWrappers(node);
  const children = (collapsed.children ?? [])
    .map((child) => simplifyNode(child, state, framework))
    .filter((child): child is SimplifiedNode => child !== null);

  const simplified: SimplifiedNode = {
    id: makeShortId(state),
    name: collapsed.name,
    type: collapsed.type,
  };

  if (collapsed.type === "TEXT" && collapsed.characters !== undefined) {
    simplified.text = collapsed.characters;
  }

  const layout = nonZeroLayout(collapsed);
  if (layout && Object.keys(layout).length > 0) {
    simplified.layout = layout;
  }

  const style = nonDefaultStyle(collapsed);
  if (style && Object.keys(style).length > 0) {
    simplified.style = style;
  }

  if (collapsed.absoluteBoundingBox) {
    simplified.size = {
      width: Math.round(collapsed.absoluteBoundingBox.width),
      height: Math.round(collapsed.absoluteBoundingBox.height),
    };
  }

  const hints = frameworkHints(collapsed, framework);
  if (hints) {
    simplified.hints = hints;
  }

  if (children.length > 0) {
    simplified.children = groupSiblings(children);
  }

  return simplified;
}

export async function simplifyContext(
  input: z.infer<typeof simplifyContextSchema>,
  clientOptions?: { ttlMs?: number; disableCache?: boolean }
): Promise<SimplifyContextResult> {
  const client = new FigmaClient(input.access_token, clientOptions);
  const normalizedId = input.node_id.replace(/-/g, ":");
  const response = await client.getFileNodes(input.file_key, [normalizedId]);
  const root = response.data.nodes[normalizedId]?.document;

  if (!root) {
    throw new Error(`Node "${input.node_id}" not found in file "${input.file_key}"`);
  }

  const maxNodes = Math.max(1, Math.floor((input.max_tokens ?? 4000) / 50));
  const state: SimplifyState = { nextId: 1, remainingNodes: maxNodes, truncated: false };
  const simplified = simplifyNode(root, state, input.framework);

  return {
    schema_version: SCHEMA_VERSION,
    source: { file_key: input.file_key, node_id: input.node_id },
    freshness: buildFreshness(response.cache),
    warnings: [],
    data: {
      framework: input.framework,
      truncated: state.truncated,
      estimated_tokens: Math.max(0, (maxNodes - state.remainingNodes) * 50),
      tree: simplified,
      cache: response.cache,
    },
  };
}

registerTool({
  name: "simplify_context",
  description:
    "Produces an AI-optimized, token-efficient representation of a Figma frame. Strips noise, collapses wrappers, groups repeated elements, and truncates deep hierarchies. Designed to fit within LLM context windows.",
  schema: simplifyContextSchema,
  handler: simplifyContext,
});
