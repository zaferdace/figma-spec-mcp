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
];

const server = new Server(
  { name: "figma-spec", version: "0.1.0" },
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
