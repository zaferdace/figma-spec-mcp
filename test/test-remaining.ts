import { bridgeToCodebase } from "../src/tools/bridge-to-codebase.js";
import { diffVersions } from "../src/tools/diff-versions.js";
import { extractVariants } from "../src/tools/extract-variants.js";
import { FigmaClient } from "../src/figma/client.js";

const FILE_KEY = "Pq72TwBCZb9MN7QnMerZIp";
const TOKEN = process.env.FIGMA_TOKEN ?? "";
if (!TOKEN) { console.error("Set FIGMA_TOKEN"); process.exit(1); }

const opts = { disableCache: false };

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
  // 1. bridge_to_codebase — match Figma components to match-store project
  await test("bridge_to_codebase", () =>
    bridgeToCodebase({
      file_key: FILE_KEY,
      access_token: TOKEN,
      project_path: "/Users/zaferdace/match-store/Assets/_Project_v3/Scripts",
      file_extensions: [".cs"],
    }, opts)
  );

  // 2. diff_versions — get file version, use same version for both (should show 0 changes)
  const client = new FigmaClient(TOKEN);
  const { data: file } = await client.getFile(FILE_KEY);
  const version = file.version;
  console.log(`\nFile version: ${version}`);

  await test("diff_versions (same version = 0 changes)", () =>
    diffVersions({
      file_key: FILE_KEY,
      access_token: TOKEN,
      version_a: version,
      version_b: version,
    }, opts)
  );

  // 3. extract_variants — find a COMPONENT_SET in the file
  const { data: nodes } = await client.getFileNodes(FILE_KEY, ["0:1"]);
  const page = nodes.nodes["0:1"]?.document;
  
  function findComponentSet(node: any): any {
    if (node.type === "COMPONENT_SET") return node;
    for (const child of node.children ?? []) {
      const found = findComponentSet(child);
      if (found) return found;
    }
    return null;
  }

  const componentSet = page ? findComponentSet(page) : null;
  if (componentSet) {
    await test("extract_variants", () =>
      extractVariants({
        file_key: FILE_KEY,
        access_token: TOKEN,
        node_id: componentSet.id,
      }, opts)
    );
  } else {
    console.log("\n--- extract_variants ---");
    console.log("No COMPONENT_SET found in file — SKIP (expected, file has no variants)");
  }

  // Try with the larger file too
  const BIG_FILE = "a5PPeZ8liEc1GPOtL6EmOY";
  try {
    const { data: bigFile } = await client.getFile(BIG_FILE);
    const bigVersion = bigFile.version;
    
    // Check if big file has component sets
    const { data: bigNodes } = await client.getFileNodes(BIG_FILE, ["0:1"]);
    const bigPage = bigNodes.nodes["0:1"]?.document;
    const bigComponentSet = bigPage ? findComponentSet(bigPage) : null;
    
    if (bigComponentSet) {
      await test("extract_variants (big file)", () =>
        extractVariants({
          file_key: BIG_FILE,
          access_token: TOKEN,
          node_id: bigComponentSet.id,
        }, opts)
      );
    } else {
      console.log("\n--- extract_variants (big file) ---");
      console.log("No COMPONENT_SET found — SKIP");
    }
  } catch (e) {
    console.log("\n--- extract_variants (big file) ---");
    console.log("Skipped:", e instanceof Error ? e.message : "error");
  }

  console.log("\n" + "=".repeat(50));
  console.log("Remaining tools test complete");
}

main().catch(console.error);
