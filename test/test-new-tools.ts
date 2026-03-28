import { lintHandoffReadiness } from "../src/tools/lint-handoff-readiness.js";
import { generateImplementationContract } from "../src/tools/generate-implementation-contract.js";
import { extractMissingStates } from "../src/tools/extract-missing-states.js";
import { flowToTestCases } from "../src/tools/flow-to-test-cases.js";

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
    console.log(lines.length > 50 ? lines.slice(0, 45).join("\n") + `\n  ... (${lines.length - 45} more lines)` : json);
    console.log(`✓ ${name}`);
    return true;
  } catch (e) {
    console.error(`✗ ${name}:`, e instanceof Error ? e.message : e);
    return false;
  }
}

async function main(): Promise<void> {
  const opts = { disableCache: false };

  await test("lint_handoff_readiness", () =>
    lintHandoffReadiness({ file_key: FILE_KEY, node_id: NODE_ID, access_token: TOKEN, ruleset: "game-ui" }, opts));

  await test("generate_implementation_contract", () =>
    generateImplementationContract({ file_key: FILE_KEY, node_id: NODE_ID, access_token: TOKEN, target: "game-ui" }, opts));

  await test("extract_missing_states", () =>
    extractMissingStates({ file_key: FILE_KEY, node_id: NODE_ID, access_token: TOKEN }, opts));

  await test("flow_to_test_cases", () =>
    flowToTestCases({ file_key: FILE_KEY, node_id: NODE_ID, access_token: TOKEN }, opts));

  console.log("\n" + "=".repeat(50));
  console.log("New tools test complete");
}

main().catch(console.error);
