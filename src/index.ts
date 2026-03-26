#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { inspectLayout, inspectLayoutSchema } from "./tools/inspect-layout.js";
import { extractDesignTokens, extractDesignTokensSchema } from "./tools/extract-design-tokens.js";
import { mapToUnity, mapToUnitySchema } from "./tools/map-to-unity.js";

const tools: Tool[] = [
  {
    name: "inspect_layout",
    description:
      "Inspects a Figma frame and returns deterministic layout data: node hierarchy, auto-layout vs absolute positioning, spacing, padding, constraints, and accessibility warnings (touch targets, font sizes). Output is a versioned JSON schema — stable and predictable for downstream tooling.",
    inputSchema: {
      type: "object",
      properties: {
        file_key: { type: "string", description: "The Figma file key (from the file URL)" },
        node_id: { type: "string", description: "The node ID of the frame to inspect" },
        access_token: { type: "string", description: "Your Figma personal access token" },
      },
      required: ["file_key", "node_id", "access_token"],
    },
  },
  {
    name: "extract_design_tokens",
    description:
      "Extracts all design tokens (colors, typography, spacing) from a Figma file and exports them in your chosen format: CSS custom properties, Style Dictionary JSON, or Tailwind config. Each token includes source node IDs for traceability.",
    inputSchema: {
      type: "object",
      properties: {
        file_key: { type: "string", description: "The Figma file key (from the file URL)" },
        access_token: { type: "string", description: "Your Figma personal access token" },
        export_format: {
          type: "string",
          enum: ["style-dictionary", "css-variables", "tailwind"],
          description: "Output format for the exported tokens (default: css-variables)",
        },
      },
      required: ["file_key", "access_token"],
    },
  },
  {
    name: "map_to_unity",
    description:
      "Converts a Figma frame into a Unity UGUI hierarchy. Maps Figma constraints to RectTransform anchors, auto-layout to HorizontalLayoutGroup/VerticalLayoutGroup, and suggests appropriate Unity components per node type. Includes confidence scores for inferred components.",
    inputSchema: {
      type: "object",
      properties: {
        file_key: { type: "string", description: "The Figma file key (from the file URL)" },
        node_id: { type: "string", description: "The node ID of the frame to convert" },
        access_token: { type: "string", description: "Your Figma personal access token" },
        canvas_width: { type: "number", description: "Target Unity canvas width in pixels (default: 1080)" },
        canvas_height: { type: "number", description: "Target Unity canvas height in pixels (default: 1920)" },
      },
      required: ["file_key", "node_id", "access_token"],
    },
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
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  schema: result.schema,
                  format: result.format,
                  cache: result.cache,
                  summary: {
                    colors: result.colors.length,
                    typography: result.typography.length,
                    spacing: result.spacing.length,
                  },
                  tokens: { colors: result.colors, typography: result.typography, spacing: result.spacing },
                  exported: result.exported,
                },
                null,
                2
              ),
            },
          ],
        };
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
    if (error instanceof z.ZodError) {
      const messages = error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(", ");
      throw new Error(`Invalid input: ${messages}`);
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
