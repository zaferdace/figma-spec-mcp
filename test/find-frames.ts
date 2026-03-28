import { FigmaClient } from "../src/figma/client.js";

const TOKEN = process.env.FIGMA_TOKEN ?? "";
const FILE_KEY = "a5PPeZ8liEc1GPOtL6EmOY";

async function main(): Promise<void> {
  const client = new FigmaClient(TOKEN);
  const { data } = await client.getFileNodes(FILE_KEY, ["0:1"]);
  const page = data.nodes["0:1"]?.document;
  if (page?.children) {
    page.children.slice(0, 15).forEach((c) => console.log(c.id, c.type, c.name));
  }
}

main().catch(console.error);
