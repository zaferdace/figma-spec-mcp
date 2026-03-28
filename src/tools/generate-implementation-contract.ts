import { z } from "zod";
import { FigmaClient } from "../figma/client.js";
import { buildFreshness, SCHEMA_VERSION } from "../shared.js";
import type { Color, FigmaFileResponse, FigmaNode } from "../types/figma.js";
import type {
  ColorUsage,
  DetectedState,
  GenerateImplementationContractInput,
  GenerateImplementationContractResult,
  ImplementationAsset,
  ImplementationDependency,
  ImplementationInteraction,
  TypographyUsage,
} from "../types/tools.js";
import { buildFlowGraph } from "./flow-graph.js";
import { findNodeById, walkTree } from "./figma-tree.js";
import { registerTool } from "./registry.js";

export const generateImplementationContractSchema = z.object({
  file_key: z.string().describe("The Figma file key (from the file URL)"),
  node_id: z.string().describe("The frame or component node ID to analyze"),
  access_token: z.string().describe("Your Figma personal access token"),
  target: z.enum(["frontend", "mobile", "game-ui"]).optional().describe("Implementation target profile"),
});

const STATE_NAMES = ["Default", "Hover", "Pressed", "Disabled", "Active", "Selected", "Error", "Loading", "Empty"];

function colorToHex(color: Color): string {
  const toHex = (value: number): string => Math.round(value * 255).toString(16).padStart(2, "0").toUpperCase();
  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
}

function matchesState(name: string, state: string): boolean {
  return new RegExp(`\\b${state}\\b`, "i").test(name) || name.toLowerCase().includes(`${state.toLowerCase()}=`);
}

function collectAssets(node: FigmaNode, assets: ImplementationAsset[]): void {
  const hasImageFill = (node.fills ?? []).some((paint) => paint.type === "IMAGE" && paint.visible !== false);
  let assetType: ImplementationAsset["assetType"] | null = null;

  if (node.type === "VECTOR" || node.type === "BOOLEAN_OPERATION") {
    assetType = node.type;
  } else if (node.type === "IMAGE" || hasImageFill) {
    assetType = "IMAGE";
  }

  if (assetType) {
    assets.push({
      nodeId: node.id,
      nodeName: node.name,
      assetType,
      exportHint: assetType === "IMAGE" ? "Export raster asset at delivery resolution" : "Export SVG or vector sprite",
    });
  }
}

function buildDependencies(root: FigmaNode, file: FigmaFileResponse): ImplementationDependency[] {
  const dependencyMap = new Map<string, ImplementationDependency>();

  walkTree(root, (node) => {
    if (!node.componentId) {
      return;
    }

    const component = file.components[node.componentId];
    const key = node.componentId;
    const current = dependencyMap.get(key) ?? {
      componentId: key,
      componentName: component?.name ?? "Unknown component",
      instanceCount: 0,
      instanceNodeIds: [],
    };

    current.instanceCount += 1;
    current.instanceNodeIds.push(node.id);
    dependencyMap.set(key, current);
  });

  return Array.from(dependencyMap.values()).sort((a, b) => b.instanceCount - a.instanceCount || a.componentName.localeCompare(b.componentName));
}

function buildStates(root: FigmaNode): DetectedState[] {
  const stateMap = new Map<string, { nodeIds: Set<string>; nodeNames: Set<string> }>();

  walkTree(root, (node, parent) => {
    STATE_NAMES.forEach((state) => {
      if (matchesState(node.name, state)) {
        const current = stateMap.get(state) ?? { nodeIds: new Set<string>(), nodeNames: new Set<string>() };
        current.nodeIds.add(node.id);
        current.nodeNames.add(node.name);
        stateMap.set(state, current);
      }
    });

    const siblings = parent?.children ?? [];
    if (siblings.length > 1) {
      STATE_NAMES.forEach((state) => {
        const matchingSibling = siblings.find((sibling) => matchesState(sibling.name, state));
        if (matchingSibling) {
          const current = stateMap.get(state) ?? { nodeIds: new Set<string>(), nodeNames: new Set<string>() };
          current.nodeIds.add(matchingSibling.id);
          current.nodeNames.add(matchingSibling.name);
          stateMap.set(state, current);
        }
      });
    }
  });

  return Array.from(stateMap.entries())
    .map(([state, info]) => ({
      state,
      nodeIds: Array.from(info.nodeIds).sort((a, b) => a.localeCompare(b)),
      nodeNames: Array.from(info.nodeNames).sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.state.localeCompare(b.state));
}

export async function generateImplementationContract(
  input: GenerateImplementationContractInput,
  clientOptions?: { ttlMs?: number; disableCache?: boolean }
): Promise<GenerateImplementationContractResult> {
  const client = new FigmaClient(input.access_token, clientOptions);
  const response = await client.getFile(input.file_key);
  const root = findNodeById(response.data.document, input.node_id);

  if (!root) {
    throw new Error(`Node "${input.node_id}" not found in file "${input.file_key}"`);
  }

  const nodeTypeCounts = new Map<string, number>();
  const typographyCounts = new Map<string, TypographyUsage>();
  const colorCounts = new Map<string, ColorUsage>();
  const assets: ImplementationAsset[] = [];
  let totalNodes = 0;
  let maxDepth = 0;
  let textCount = 0;
  let imageCount = 0;

  walkTree(root, (node, _parent, depth) => {
    totalNodes += 1;
    maxDepth = Math.max(maxDepth, depth);
    nodeTypeCounts.set(node.type, (nodeTypeCounts.get(node.type) ?? 0) + 1);

    collectAssets(node, assets);
    if (assets[assets.length - 1]?.nodeId === node.id && assets[assets.length - 1]?.assetType === "IMAGE") {
      imageCount += 1;
    }

    if (node.type === "TEXT" && node.style) {
      textCount += 1;
      const key = `${node.style.fontFamily}|${node.style.fontSize}`;
      const current = typographyCounts.get(key) ?? {
        fontFamily: node.style.fontFamily,
        fontSize: node.style.fontSize,
        usageCount: 0,
      };
      current.usageCount += 1;
      typographyCounts.set(key, current);
    }

    (node.fills ?? [])
      .filter((paint) => paint.type === "SOLID" && paint.visible !== false && paint.color)
      .forEach((paint) => {
        if (!paint.color) {
          return;
        }
        const hex = colorToHex(paint.color);
        const current = colorCounts.get(hex) ?? { hex, usageCount: 0 };
        current.usageCount += 1;
        colorCounts.set(hex, current);
      });
  });

  const graph = buildFlowGraph(root);
  const states = buildStates(root);
  const dependencies = buildDependencies(root, response.data);
  const typography = Array.from(typographyCounts.values()).sort(
    (a, b) => a.fontFamily.localeCompare(b.fontFamily) || a.fontSize - b.fontSize
  );
  const colors = Array.from(colorCounts.values()).sort((a, b) => a.hex.localeCompare(b.hex));
  const target = input.target ?? "frontend";

  const acceptanceCriteria = [
    `[ ] Implement ${textCount} text elements`,
    `[ ] Export ${assets.length} image/vector assets`,
    `[ ] Handle ${states.length} interaction states`,
    `[ ] Wire ${graph.flows.length} prototype interactions`,
    `[ ] Integrate ${dependencies.length} shared component dependencies`,
  ];

  const edgeCases: string[] = [];
  if (states.length === 0) {
    edgeCases.push("No explicit state labels detected; confirm default, loading, error, and empty states manually.");
  }
  if (graph.flows.length === 0) {
    edgeCases.push("No prototype transitions found; define navigation and modal behavior outside the design file.");
  }
  if (imageCount > 0 && target !== "frontend") {
    edgeCases.push(`Verify ${imageCount} raster assets for target-device memory and scaling constraints.`);
  }
  if (colors.length > 12) {
    edgeCases.push(`High color variety detected (${colors.length} solids); check whether tokens should be consolidated.`);
  }
  if (maxDepth >= 6) {
    edgeCases.push(`Deep hierarchy detected (depth ${maxDepth}); watch for brittle implementation structure.`);
  }

  const interactions: ImplementationInteraction[] = graph.flows.map((flow) => ({
    fromNodeId: flow.fromNodeId,
    fromNodeName: flow.fromNodeName,
    toNodeId: flow.toNodeId,
    toNodeName: flow.toNodeName,
    trigger: flow.trigger,
    transitionType: flow.transitionType,
  }));

  return {
    schema_version: SCHEMA_VERSION,
    source: { file_key: input.file_key, node_id: input.node_id },
    freshness: buildFreshness(response.cache),
    warnings: graph.warnings,
    data: {
      scope: {
        totalNodes,
        maxDepth,
        uniqueNodeTypes: Array.from(nodeTypeCounts.keys()).sort((a, b) => a.localeCompare(b)),
        nodeTypeCounts: Array.from(nodeTypeCounts.entries())
          .map(([type, count]) => ({ type, count }))
          .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
      },
      assets,
      states,
      interactions,
      dependencies,
      typography,
      colors,
      acceptanceCriteria,
      edgeCases,
      cache: response.cache,
    },
  };
}

registerTool({
  name: "generate_implementation_contract",
  description:
    "Analyzes a Figma frame or component subtree and produces an implementation contract with scope, assets, states, prototype interactions, dependencies, typography, colors, and acceptance criteria.",
  schema: generateImplementationContractSchema,
  handler: generateImplementationContract,
});
