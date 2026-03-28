import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

interface ToolRegistration<T extends z.ZodType> {
  name: string;
  description: string;
  schema: T;
  handler: (input: z.infer<T>) => Promise<unknown>;
}

const registry = new Map<string, ToolRegistration<z.ZodType>>();

export function registerTool<T extends z.ZodType>(registration: ToolRegistration<T>): void {
  if (registry.has(registration.name)) {
    throw new Error(`Tool already registered: ${registration.name}`);
  }

  registry.set(registration.name, registration as unknown as ToolRegistration<z.ZodType>);
}

export function getToolDefinitions(): Tool[] {
  return Array.from(registry.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((reg) => ({
    name: reg.name,
    description: reg.description,
    inputSchema: zodToJsonSchema(reg.schema) as Tool["inputSchema"],
    }));
}

export async function executeTool(name: string, args: unknown): Promise<unknown> {
  const reg = registry.get(name);
  if (!reg) {
    throw new Error(`Unknown tool: ${name}`);
  }

  const input = reg.schema.parse(args);
  return reg.handler(input);
}
