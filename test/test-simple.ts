import { inspectLayout } from "../src/tools/inspect-layout.js";
import { extractDesignTokens } from "../src/tools/extract-design-tokens.js";
import { mapToUnity } from "../src/tools/map-to-unity.js";
import { resolveComponents } from "../src/tools/resolve-components.js";
import { extractFlows } from "../src/tools/extract-flows.js";
import { exportImages } from "../src/tools/export-images.js";
import { auditAccessibility } from "../src/tools/audit-accessibility.js";
import { extractVariants } from "../src/tools/extract-variants.js";
import { simplifyContext } from "../src/tools/simplify-context.js";

const FILE_KEY = "Pq72TwBCZb9MN7QnMerZIp";
const NODE_ID = "0:1";
const TOKEN = process.env.FIGMA_TOKEN ?? "";

if (!TOKEN) { console.error("Set FIGMA_TOKEN"); process.exit(1); }

async function test(name: string, fn: () => Promise<unknown>): Promise<boolean> {
  try {
    console.log(`\n--- ${name} ---`);
    const result = await fn();
    const json = JSON.stringify(result, null, 2);
    const lines = json.split("\n");
    console.log(lines.length > 40 ? lines.slice(0, 35).join("\n") + `\n  ... (${lines.length - 35} more lines)` : json);
    console.log(`✓ ${name}`);
    return true;
  } catch (e) {
    console.error(`✗ ${name}:`, e instanceof Error ? e.message : e);
    return false;
  }
}

async function main(): Promise<void> {
  const results: Record<string, boolean> = {};
  const opts = { disableCache: false };

  results["inspect_layout"] = await test("inspect_layout", () =>
    inspectLayout({ file_key: FILE_KEY, node_id: NODE_ID, access_token: TOKEN, max_depth: 5, framework: "unity" }, opts));

  results["extract_design_tokens"] = await test("extract_design_tokens", () =>
    extractDesignTokens({ file_key: FILE_KEY, access_token: TOKEN, export_format: "css-variables" }, opts));

  results["map_to_unity"] = await test("map_to_unity", () =>
    mapToUnity({ file_key: FILE_KEY, node_id: NODE_ID, access_token: TOKEN }, opts));

  results["resolve_components"] = await test("resolve_components", () =>
    resolveComponents({ file_key: FILE_KEY, access_token: TOKEN }, opts));

  results["audit_accessibility"] = await test("audit_accessibility", () =>
    auditAccessibility({ file_key: FILE_KEY, access_token: TOKEN, node_id: NODE_ID }, opts));

  results["simplify_context"] = await test("simplify_context", () =>
    simplifyContext({ file_key: FILE_KEY, access_token: TOKEN, node_id: NODE_ID, max_tokens: 2000, framework: "unity" }, opts));

  results["extract_flows"] = await test("extract_flows", () =>
    extractFlows({ file_key: FILE_KEY, access_token: TOKEN, node_id: NODE_ID }, opts));

  // Find a frame for image export
  const layoutResult = await inspectLayout({ file_key: FILE_KEY, node_id: NODE_ID, access_token: TOKEN, max_depth: 2 }, opts) as any;
  const firstFrame = layoutResult?.data?.hierarchy?.find((n: any) => n.type === "FRAME");
  if (firstFrame) {
    results["export_images"] = await test("export_images", () =>
      exportImages({ file_key: FILE_KEY, access_token: TOKEN, node_ids: [firstFrame.id], format: "png", scale: 1 }, opts));
  } else {
    console.log("\n--- export_images ---\nNo frame found for export test");
    results["export_images"] = false;
  }

  console.log("\n" + "=".repeat(50));
  console.log("SUMMARY");
  console.log("=".repeat(50));
  let pass = 0, fail = 0;
  for (const [name, ok] of Object.entries(results)) {
    console.log(`  ${ok ? "✓" : "✗"} ${name}`);
    ok ? pass++ : fail++;
  }
  console.log(`\n${pass} passed, ${fail} failed`);
}

main().catch(console.error);
