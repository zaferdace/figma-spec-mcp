import { z } from "zod";
import { FigmaClient } from "../figma/client.js";
import { buildFreshness, SCHEMA_VERSION } from "../shared.js";
import type { FigmaNode } from "../types/figma.js";
import type { HandoffLintFinding, LintHandoffReadinessInput, LintHandoffReadinessResult } from "../types/tools.js";
import { findNodeById, isFrameLike, walkTree } from "./figma-tree.js";
import { registerTool } from "./registry.js";

export const lintHandoffReadinessSchema = z.object({
  file_key: z.string().describe("The Figma file key (from the file URL)"),
  node_id: z.string().optional().describe("Optional page or frame node ID to limit the scan"),
  access_token: z.string().describe("Your Figma personal access token"),
  ruleset: z.enum(["web", "mobile", "game-ui"]).optional().describe("Readiness heuristic profile"),
});

const DEFAULT_NAME_REGEX = /^(Frame|Rectangle|Group|Ellipse|Vector|Text|Line|Polygon|Star|Boolean)\s+\d+$/i;

type Ruleset = NonNullable<LintHandoffReadinessInput["ruleset"]>;

function severityForRule(rule: string, ruleset: Ruleset): "error" | "warning" | "info" {
  switch (rule) {
    case "oversized-images":
      return ruleset === "game-ui" ? "warning" : "error";
    case "absolute-positioning-soup":
      return ruleset === "game-ui" ? "info" : "warning";
    case "missing-auto-layout":
      return ruleset === "game-ui" ? "info" : "warning";
    case "inconsistent-spacing":
      return ruleset === "mobile" ? "warning" : "info";
    case "orphaned-node":
      return "warning";
    case "text-without-style":
      return ruleset === "game-ui" ? "info" : "warning";
    case "hidden-but-present":
      return "info";
    case "unnamed-node":
    default:
      return "warning";
  }
}

function pushFinding(
  findings: HandoffLintFinding[],
  rule: string,
  node: FigmaNode,
  ruleset: Ruleset,
  message: string,
  fixHint: string
): void {
  findings.push({
    rule,
    severity: severityForRule(rule, ruleset),
    nodeId: node.id,
    nodeName: node.name,
    message,
    fixHint,
  });
}

function hasImageFill(node: FigmaNode): boolean {
  return (node.fills ?? []).some((paint) => paint.type === "IMAGE" && paint.visible !== false);
}

function analyzeFrameLikeNode(node: FigmaNode, findings: HandoffLintFinding[], ruleset: Ruleset): void {
  const children = node.children ?? [];
  if (children.length === 0) {
    return;
  }

  const absoluteChildren = children.filter((child) =>
    node.layoutMode && node.layoutMode !== "NONE" ? child.layoutPositioning === "ABSOLUTE" : true
  );
  if (absoluteChildren.length / children.length > 0.6) {
    pushFinding(
      findings,
      "absolute-positioning-soup",
      node,
      ruleset,
      `${absoluteChildren.length} of ${children.length} children rely on absolute positioning.`,
      "Convert repeated child groups to auto-layout or isolate intentional overlays."
    );
  }

  if ((node.layoutMode ?? "NONE") === "NONE" && children.length >= 3) {
    pushFinding(
      findings,
      "missing-auto-layout",
      node,
      ruleset,
      `Frame has ${children.length} children but no auto-layout.`,
      "Apply horizontal or vertical auto-layout to reduce manual spacing and constraints."
    );
  }

  const autoLayoutChildren = children.filter((child) => (child.layoutMode ?? "NONE") !== "NONE");
  const gapValues = Array.from(new Set(autoLayoutChildren.map((child) => child.itemSpacing ?? 0)));
  if (autoLayoutChildren.length >= 2 && gapValues.length > 1) {
    pushFinding(
      findings,
      "inconsistent-spacing",
      node,
      ruleset,
      `Auto-layout siblings use inconsistent gap values: ${gapValues.join(", ")}.`,
      "Normalize sibling spacing or document intentional exceptions with clearer naming."
    );
  }
}

export async function lintHandoffReadiness(
  input: LintHandoffReadinessInput,
  clientOptions?: { ttlMs?: number; disableCache?: boolean }
): Promise<LintHandoffReadinessResult> {
  const client = new FigmaClient(input.access_token, clientOptions);
  const response = await client.getFile(input.file_key);
  const root = input.node_id ? findNodeById(response.data.document, input.node_id) : response.data.document;

  if (!root) {
    throw new Error(`Node "${input.node_id}" not found in file "${input.file_key}"`);
  }

  const findings: HandoffLintFinding[] = [];
  const ruleset = input.ruleset ?? "web";

  walkTree(root, (node, parent) => {
    if (DEFAULT_NAME_REGEX.test(node.name)) {
      pushFinding(
        findings,
        "unnamed-node",
        node,
        ruleset,
        `Node uses a default-generated name: "${node.name}".`,
        "Rename the layer to reflect semantic purpose before handoff."
      );
    }

    if (isFrameLike(node)) {
      analyzeFrameLikeNode(node, findings, ruleset);
    }

    if ((node.type === "PAGE" || node.type === "CANVAS") && parent === null) {
      node.children
        ?.filter((child) => !isFrameLike(child))
        .forEach((child) => {
          pushFinding(
            findings,
            "orphaned-node",
            child,
            ruleset,
            `Node is a direct child of ${node.type.toLowerCase()} and not contained in a frame.`,
            "Move the node into an explicit frame/component or remove unused canvas debris."
          );
        });
    }

    if (node.visible === false) {
      pushFinding(
        findings,
        "hidden-but-present",
        node,
        ruleset,
        "Hidden node is still present in the file and may add maintenance or file-size overhead.",
        "Delete unused hidden layers or move intentional archive layers outside the delivery subtree."
      );
    }

    if (hasImageFill(node)) {
      const width = node.absoluteBoundingBox?.width ?? 0;
      const height = node.absoluteBoundingBox?.height ?? 0;
      if (width > 4096 || height > 4096) {
        pushFinding(
          findings,
          "oversized-images",
          node,
          ruleset,
          `Image-backed node is ${Math.round(width)}x${Math.round(height)}px, above the 4096px threshold.`,
          "Downscale the source asset or slice it into smaller exports."
        );
      }
    }

    if (node.type === "TEXT" && !node.styles?.["text"]) {
      pushFinding(
        findings,
        "text-without-style",
        node,
        ruleset,
        "Text node does not reference a named text style.",
        "Apply a shared text style so typography can be mapped consistently in code."
      );
    }
  });

  const errors = findings.filter((finding) => finding.severity === "error").length;
  const warnings = findings.filter((finding) => finding.severity === "warning").length;
  const info = findings.filter((finding) => finding.severity === "info").length;
  const score = Math.max(0, Math.min(100, 100 - (errors * 10 + warnings * 3 + info)));

  return {
    schema_version: SCHEMA_VERSION,
    source: input.node_id ? { file_key: input.file_key, node_id: input.node_id } : { file_key: input.file_key },
    freshness: buildFreshness(response.cache),
    warnings: [],
    data: {
      findings,
      score,
      summary: { errors, warnings, info },
      cache: response.cache,
    },
  };
}

registerTool({
  name: "lint_handoff_readiness",
  description:
    "Scans a Figma page or subtree for common engineering handoff issues including default layer names, auto-layout gaps, hidden debris, oversized images, orphaned nodes, and missing text styles.",
  schema: lintHandoffReadinessSchema,
  handler: lintHandoffReadiness,
});
