import { inspectLayout, inspectLayoutSchema } from "../src/tools/inspect-layout.js";
import { extractDesignTokens, extractDesignTokensSchema } from "../src/tools/extract-design-tokens.js";
import { mapToUnity, mapToUnitySchema } from "../src/tools/map-to-unity.js";
import { resolveComponents, resolveComponentsSchema } from "../src/tools/resolve-components.js";
import { extractFlows, extractFlowsSchema } from "../src/tools/extract-flows.js";
import { exportImages, exportImagesSchema } from "../src/tools/export-images.js";
import { auditAccessibility, auditAccessibilitySchema } from "../src/tools/audit-accessibility.js";
import { extractVariants, extractVariantsSchema } from "../src/tools/extract-variants.js";
import { diffVersions, diffVersionsSchema } from "../src/tools/diff-versions.js";
import { simplifyContext, simplifyContextSchema } from "../src/tools/simplify-context.js";

const FILE_KEY = "a5PPeZ8liEc1GPOtL6EmOY";
const NODE_ID = "0:1";
const ACCESS_TOKEN = process.env.FIGMA_TOKEN ?? "";

if (!ACCESS_TOKEN) {
  console.error("Set FIGMA_TOKEN environment variable");
  process.exit(1);
}

const clientOptions = { disableCache: true };

async function testTool(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Testing: ${name}`);
    console.log("=".repeat(60));
    const result = await fn();
    const json = JSON.stringify(result, null, 2);
    const lines = json.split("\n");
    if (lines.length > 30) {
      console.log(lines.slice(0, 25).join("\n"));
      console.log(`  ... (${lines.length - 25} more lines)`);
    } else {
      console.log(json);
    }
    console.log(`✓ ${name} — OK`);
  } catch (error) {
    console.error(`✗ ${name} — FAILED:`, error instanceof Error ? error.message : error);
  }
}

async function main(): Promise<void> {
  console.log(`File: ${FILE_KEY}`);
  console.log(`Node: ${NODE_ID}`);

  await testTool("inspect_layout", () =>
    inspectLayout({ file_key: FILE_KEY, node_id: NODE_ID, access_token: ACCESS_TOKEN, max_depth: 3 }, clientOptions)
  );

  await testTool("extract_design_tokens", () =>
    extractDesignTokens({ file_key: FILE_KEY, access_token: ACCESS_TOKEN, export_format: "css-variables" }, clientOptions)
  );

  await testTool("map_to_unity", () =>
    mapToUnity({ file_key: FILE_KEY, node_id: NODE_ID, access_token: ACCESS_TOKEN }, clientOptions)
  );

  await testTool("resolve_components", () =>
    resolveComponents({ file_key: FILE_KEY, access_token: ACCESS_TOKEN, node_id: NODE_ID }, clientOptions)
  );

  await testTool("export_images", () =>
    exportImages({ file_key: FILE_KEY, access_token: ACCESS_TOKEN, node_ids: [NODE_ID], format: "png", scale: 1 }, clientOptions)
  );

  await testTool("audit_accessibility", () =>
    auditAccessibility({ file_key: FILE_KEY, access_token: ACCESS_TOKEN, node_id: NODE_ID }, clientOptions)
  );

  await testTool("simplify_context", () =>
    simplifyContext({ file_key: FILE_KEY, access_token: ACCESS_TOKEN, node_id: NODE_ID, max_tokens: 2000 }, clientOptions)
  );

  await testTool("extract_flows", () =>
    extractFlows({ file_key: FILE_KEY, access_token: ACCESS_TOKEN, node_id: NODE_ID }, clientOptions)
  );

  console.log("\n" + "=".repeat(60));
  console.log("All tests complete");
  console.log("=".repeat(60));
}

main().catch(console.error);
