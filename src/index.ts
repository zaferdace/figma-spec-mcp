#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { inspectLayout, inspectLayoutSchema } from "./tools/inspect-layout.js";
import { extractDesignTokens, extractDesignTokensSchema } from "./tools/extract-design-tokens.js";
import { mapToUnity, mapToUnitySchema } from "./tools/map-to-unity.js";
import { resolveComponents, resolveComponentsSchema } from "./tools/resolve-components.js";
import { extractFlows, extractFlowsSchema } from "./tools/extract-flows.js";
import { bridgeToCodebase, bridgeToCodebaseSchema } from "./tools/bridge-to-codebase.js";
import { diffVersions, diffVersionsSchema } from "./tools/diff-versions.js";
import { extractVariants, extractVariantsSchema } from "./tools/extract-variants.js";
import { SERVER_VERSION } from "./shared.js";

const tools: Tool[] = [
  {
    name: "inspect_layout",
    description:
      "Inspects a Figma frame and returns deterministic layout data: node hierarchy, auto-layout vs absolute positioning, spacing, padding, constraints, and accessibility warnings (touch targets, font sizes). Output is a versioned JSON envelope — stable and predictable for downstream tooling.",
    inputSchema: zodToJsonSchema(inspectLayoutSchema) as Tool["inputSchema"],
  },
  {
    name: "extract_design_tokens",
    description:
      "Extracts all design tokens (colors, typography, spacing) from a Figma file and exports them in your chosen format: CSS custom properties (DTCG-aligned), Style Dictionary JSON, or Tailwind config. Spacing tokens are sourced from auto-layout padding and gap values. Each token includes source node IDs for traceability.",
    inputSchema: zodToJsonSchema(extractDesignTokensSchema) as Tool["inputSchema"],
  },
  {
    name: "map_to_unity",
    description:
      "Produces a Unity UGUI mapping spec from a Figma frame. Maps Figma constraints to RectTransform anchors, auto-layout to HorizontalLayoutGroup/VerticalLayoutGroup, and suggests appropriate Unity components per node type. Includes confidence scores for inferred components and warnings for unknown constraints or unsupported effects.",
    inputSchema: zodToJsonSchema(mapToUnitySchema) as Tool["inputSchema"],
  },
  {
    name: "resolve_components",
    description:
      "Scans a Figma subtree or full file for instances, resolves each unique component through the file component map and Figma component API, and returns the source file and node for each instance.",
    inputSchema: zodToJsonSchema(resolveComponentsSchema) as Tool["inputSchema"],
  },
  {
    name: "extract_flows",
    description:
      "Extracts prototype flows from a page or frame by finding transition links in the node tree, then returns directed frame-to-frame connections and a deterministic traversal order.",
    inputSchema: zodToJsonSchema(extractFlowsSchema) as Tool["inputSchema"],
  },
  {
    name: "bridge_to_codebase",
    description:
      "Scans Figma components and a local codebase, then maps component names to likely implementation files using exact, case-insensitive, and partial filename matching.",
    inputSchema: zodToJsonSchema(bridgeToCodebaseSchema) as Tool["inputSchema"],
  },
  {
    name: "diff_versions",
    description:
      "Fetches two Figma file versions and reports added, removed, and modified nodes by comparing names, types, geometry, fills, and style properties.",
    inputSchema: zodToJsonSchema(diffVersionsSchema) as Tool["inputSchema"],
  },
  {
    name: "extract_variants",
    description:
      "Reads a Figma component set and returns structured variant data including parsed variant properties, dimensions, layout details, fills, and typography from text descendants.",
    inputSchema: zodToJsonSchema(extractVariantsSchema) as Tool["inputSchema"],
  },
];

const server = new Server(
  { name: "figma-spec", version: SERVER_VERSION },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "inspect_layout": {
        const input = inspectLayoutSchema.parse(args);
        const result = await inspectLayout(input);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "extract_design_tokens": {
        const input = extractDesignTokensSchema.parse(args);
        const result = await extractDesignTokens(input);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "map_to_unity": {
        const input = mapToUnitySchema.parse(args);
        const result = await mapToUnity(input);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "resolve_components": {
        const input = resolveComponentsSchema.parse(args);
        const result = await resolveComponents(input);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "extract_flows": {
        const input = extractFlowsSchema.parse(args);
        const result = await extractFlows(input);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "bridge_to_codebase": {
        const input = bridgeToCodebaseSchema.parse(args);
        const result = await bridgeToCodebase(input);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "diff_versions": {
        const input = diffVersionsSchema.parse(args);
        const result = await diffVersions(input);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "extract_variants": {
        const input = extractVariantsSchema.parse(args);
        const result = await extractVariants(input);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      throw new Error(`Invalid input: ${error.message}`);
    }
    throw error;
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
