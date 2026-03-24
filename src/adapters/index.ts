export { CcTgAdapter } from "./cc-tg.js";
export type { CcTgStatus } from "./cc-tg.js";
export { OpenclawAdapter } from "./openclaw.js";
export type { OpenclawHealthResult } from "./openclaw.js";
export { CodexAdapter } from "./codex.js";
export type { CodexHealthResult } from "./codex.js";
export { CustomHttpAdapter } from "./custom-http.js";
export type { CustomHealthResult } from "./custom-http.js";
export { GenericHttpAdapter } from "./generic-http.js";
export type { GenericHttpStatus } from "./generic-http.js";

import { CcTgAdapter } from "./cc-tg.js";
import { CustomHttpAdapter } from "./custom-http.js";
import { GenericHttpAdapter } from "./generic-http.js";

/** Control-plane interface common to all adapters. */
export interface ControlAdapter {
  restart(endpoint: string, authToken?: string): Promise<unknown>;
  logs(endpoint: string, lines: number, authToken?: string): Promise<string>;
}

/**
 * Returns the correct control-plane adapter for the given agent type.
 * Falls back to GenericHttpAdapter for unknown types.
 */
export function createAdapter(agentType: string): ControlAdapter {
  switch (agentType) {
    case "cc-tg":
      return new CcTgAdapter();
    case "openclaw":
    case "codex":
    case "custom":
      return new CustomHttpAdapter();
    default:
      return new GenericHttpAdapter();
  }
}
