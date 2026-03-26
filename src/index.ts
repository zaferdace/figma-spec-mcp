#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { analyzeFrame, analyzeFrameSchema } from "./tools/analyze-frame.js";
import { extractDesignTokens, extractDesignTokensSchema } from "./tools/extract-design-tokens.js";
import { mapToUnity, mapToUnitySchema } from "./tools/map-to-unity.js";

const tools: Tool[] = [
  {
    name: "analyze_frame",
    description:
      "Analyzes a Figma frame and returns structured information about its components, layouts, constraints, and accessibility warnings. Ideal for auditing design quality and generating platform-ready specs.",
    inputSchema: {
      type: "object",
      properties: {
        file_key: { type: "string", description: "The Figma file key (from the file URL)" },
        node_id: { type: "string", description: "The node ID of the frame to analyze" },
        access_token: { type: "string", description: "Your Figma personal access token" },
      },
      required: ["file_key", "node_id", "access_token"],
    },
  },
  {
    name: "extract_design_tokens",
    description:
      "Extracts all design tokens (colors, typography, spacing) from a Figma file and exports them in your chosen format: CSS custom properties, Style Dictionary JSON, or Tailwind config.",
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
        include_styles: {
          type: "boolean",
          description: "Whether to include named Figma styles in extraction (default: true)",
        },
      },
      required: ["file_key", "access_token"],
    },
  },
  {
    name: "map_to_unity",
    description:
      "Converts a Figma frame into a Unity UGUI hierarchy. Maps Figma constraints to RectTransform anchors, auto-layout to LayoutGroups, and infers appropriate Unity components (Image, TextMeshProUGUI, etc.).",
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
  { name: "figma-dissect", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "analyze_frame": {
        const input = analyzeFrameSchema.parse(args);
        const result = await analyzeFrame(input);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "extract_design_tokens": {
        const input = extractDesignTokensSchema.parse(args);
        const result = await extractDesignTokens(input);
        return {
          content: [
            { type: "text", text: `Format: ${result.format}\n\nTokens summary:\n- Colors: ${result.colors.length}\n- Typography: ${result.typography.length}\n- Spacing: ${result.spacing.length}\n\n${result.exported}` },
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
