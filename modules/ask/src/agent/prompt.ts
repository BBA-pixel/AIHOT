import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const PROMPT_VERSION = "ask-system-v1";

const SYSTEM = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../prompts/system-v1.md"), "utf8");

export function askSystemPrompt(): string {
  return SYSTEM;
}
