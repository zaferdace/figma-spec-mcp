import { z } from "zod";
import { FigmaClient } from "../figma/client.js";
import { buildFreshness, SCHEMA_VERSION } from "../shared.js";
import type { ExportImagesInput, ExportImagesResult } from "../types/tools.js";
import { registerTool } from "./registry.js";

export const exportImagesSchema = z.object({
  file_key: z.string().describe("The Figma file key (from the file URL)"),
  access_token: z.string().describe("Your Figma personal access token"),
  node_ids: z.array(z.string()).min(1).describe("Array of node IDs to export"),
  format: z.enum(["png", "jpg", "svg", "pdf"]).optional().default("png"),
  scale: z.number().min(0.01).max(4).optional().default(2),
});

export async function exportImages(
  input: ExportImagesInput,
  clientOptions?: { ttlMs?: number; disableCache?: boolean }
): Promise<ExportImagesResult> {
  const client = new FigmaClient(input.access_token, clientOptions);
  const normalizedIds = input.node_ids.map((nodeId) => nodeId.replace(/-/g, ":"));
  const format = input.format ?? "png";
  const scale = input.scale ?? 2;
  const [nodesResponse, imagesResponse] = await Promise.all([
    client.getFileNodes(input.file_key, normalizedIds),
    client.getImages(input.file_key, normalizedIds, format, scale),
  ]);
  const warnings = normalizedIds
    .map((nodeId, index) => {
      const imageUrl = imagesResponse.data.images[nodeId] ?? null;
      if (imageUrl !== null) {
        return null;
      }

      return `Failed to render node ${input.node_ids[index] ?? nodeId}`;
    })
    .filter((warning): warning is string => warning !== null);

  return {
    schema_version: SCHEMA_VERSION,
    source: { file_key: input.file_key },
    freshness: buildFreshness(imagesResponse.cache),
    warnings,
    data: {
      images: normalizedIds.map((nodeId, index) => ({
        nodeId: input.node_ids[index] ?? nodeId,
        nodeName: nodesResponse.data.nodes[nodeId]?.document.name ?? "Unknown",
        imageUrl: imagesResponse.data.images[nodeId] ?? null,
        format,
        scale,
      })),
      cache: imagesResponse.cache,
    },
  };
}

registerTool({
  name: "export_images",
  description:
    "Exports Figma nodes as images (PNG, SVG, PDF) via the Figma image export API. Returns download URLs for each requested node.",
  schema: exportImagesSchema,
  handler: exportImages,
});
