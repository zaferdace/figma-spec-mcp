import { z } from "zod";
import { FigmaClient } from "../figma/client.js";
import { buildFreshness, SCHEMA_VERSION } from "../shared.js";
import type { FigmaNode } from "../types/figma.js";
import type { ExtractMissingStatesInput, ExtractMissingStatesResult, MissingStateComponent } from "../types/tools.js";
import { findNodeById, walkTree } from "./figma-tree.js";
import { registerTool } from "./registry.js";

export const extractMissingStatesSchema = z.object({
  file_key: z.string().describe("The Figma file key (from the file URL)"),
  node_id: z.string().describe("The page, frame, or component subtree to inspect"),
  access_token: z.string().describe("Your Figma personal access token"),
});

const EXPECTED_STATES = [
  "Default",
  "Hover",
  "Pressed",
  "Disabled",
  "Active",
  "Selected",
  "Focus",
  "Error",
  "Loading",
  "Empty",
];

function parseVariantStateNames(name: string): string[] {
  const lowerName = name.toLowerCase();
  return EXPECTED_STATES.filter(
    (state) => lowerName.includes(state.toLowerCase()) || lowerName.includes(`state=${state.toLowerCase()}`)
  );
}

function collectPresentStates(node: FigmaNode, parent: FigmaNode | null): { states: string[]; confidence: number } {
  if (node.type === "COMPONENT_SET") {
    const states = new Set<string>();
    (node.children ?? []).forEach((child) => {
      parseVariantStateNames(child.name).forEach((state) => states.add(state));
    });
    return { states: Array.from(states).sort((a, b) => a.localeCompare(b)), confidence: states.size > 0 ? 0.95 : 0.5 };
  }

  const states = new Set<string>(parseVariantStateNames(node.name));
  const siblingComponents = (parent?.children ?? []).filter((child) => child.type === "COMPONENT");
  siblingComponents.forEach((sibling) => {
    parseVariantStateNames(sibling.name).forEach((state) => states.add(state));
  });

  let confidence = 0.45;
  if (siblingComponents.length > 1 && states.size > 0) {
    confidence = 0.75;
  } else if (states.size > 0) {
    confidence = 0.6;
  }

  return { states: Array.from(states).sort((a, b) => a.localeCompare(b)), confidence };
}

function buildComponentResult(node: FigmaNode, parent: FigmaNode | null): MissingStateComponent {
  const { states, confidence } = collectPresentStates(node, parent);
  return {
    name: node.name,
    nodeId: node.id,
    presentStates: states,
    missingStates: EXPECTED_STATES.filter((state) => !states.includes(state)),
    confidence,
  };
}

export async function extractMissingStates(
  input: ExtractMissingStatesInput,
  clientOptions?: { ttlMs?: number; disableCache?: boolean }
): Promise<ExtractMissingStatesResult> {
  const client = new FigmaClient(input.access_token, clientOptions);
  const response = await client.getFile(input.file_key);
  const root = findNodeById(response.data.document, input.node_id);

  if (!root) {
    throw new Error(`Node "${input.node_id}" not found in file "${input.file_key}"`);
  }

  const components: MissingStateComponent[] = [];
  walkTree(root, (node, parent) => {
    if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
      components.push(buildComponentResult(node, parent));
    }
  });

  return {
    schema_version: SCHEMA_VERSION,
    source: { file_key: input.file_key, node_id: input.node_id },
    freshness: buildFreshness(response.cache),
    warnings: components.length === 0 ? ["No COMPONENT or COMPONENT_SET nodes found in the scanned subtree"] : [],
    data: {
      components,
      cache: response.cache,
    },
  };
}

registerTool({
  name: "extract_missing_states",
  description:
    "Finds components and component sets in a Figma subtree, compares detected states against a standard expected-state list, and reports missing state coverage with a confidence score.",
  schema: extractMissingStatesSchema,
  handler: extractMissingStates,
});
