/**
 * Registry API HTTP server.
 *
 * Endpoints:
 *   GET    /agents            — list all registered agents
 *   POST   /agents/register   — register a new agent
 *   POST   /agents/:id/restart — restart via adapter
 *   GET    /agents/:id/logs   — tail logs via adapter
 *   DELETE /agents/:id        — deregister
 */

import http from "node:http";
import { AgentRegistry, AgentRecord } from "./registry.js";
import { CcTgAdapter } from "./adapters/cc-tg.js";
import { CustomHttpAdapter } from "./adapters/custom-http.js";

export interface RegistryApiOptions {
  port: number;
  redisUrl?: string;
  authToken?: string;
  controlAuthToken?: string; // forwarded to cc-tg control servers
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

/** Parse /agents/:id/action — returns {id, action} or null */
function parseAgentPath(pathname: string): { id: string; action?: string } | null {
  const m = pathname.match(/^\/agents\/([^/]+)(?:\/(.+))?$/);
  if (!m) return null;
  return { id: decodeURIComponent(m[1]), action: m[2] };
}

async function dispatchRestart(agent: AgentRecord, controlAuthToken?: string): Promise<unknown> {
  switch (agent.type) {
    case "cc-tg": {
      const adapter = new CcTgAdapter();
      return adapter.restart(agent.control_url, controlAuthToken);
    }
    case "openclaw":
    case "codex":
    case "custom": {
      const adapter = new CustomHttpAdapter();
      return adapter.restart(agent.control_url, controlAuthToken);
    }
    default:
      throw new Error(`No restart adapter for type: ${agent.type}`);
  }
}

async function dispatchLogs(
  agent: AgentRecord,
  lines: number,
  controlAuthToken?: string,
): Promise<string> {
  switch (agent.type) {
    case "cc-tg": {
      const adapter = new CcTgAdapter();
      return adapter.logs(agent.control_url, lines, controlAuthToken);
    }
    case "openclaw":
    case "codex":
    case "custom": {
      const adapter = new CustomHttpAdapter();
      return adapter.logs(agent.control_url, lines, controlAuthToken);
    }
    default:
      throw new Error(`No logs adapter for type: ${agent.type}`);
  }
}

export function createRegistryApi(opts: RegistryApiOptions): http.Server {
  const registry = new AgentRegistry(opts.redisUrl);
  registry.connect().catch((err) => {
    console.error("[agent-ops/api] Redis connect failed:", err);
  });

  const server = http.createServer(async (req, res) => {
    // Optional auth
    if (opts.authToken) {
      const auth = req.headers["authorization"] ?? "";
      if (auth !== `Bearer ${opts.authToken}`) {
        return json(res, 401, { error: "unauthorized" });
      }
    }

    const url = new URL(req.url ?? "/", `http://localhost:${opts.port}`);
    const { pathname } = url;

    try {
      // GET /agents
      if (req.method === "GET" && pathname === "/agents") {
        const agents = await registry.list();
        return json(res, 200, { agents });
      }

      // POST /agents/register
      if (req.method === "POST" && pathname === "/agents/register") {
        const body = await readBody(req);
        const record = JSON.parse(body) as AgentRecord;
        if (!record.id || !record.type || !record.control_url) {
          return json(res, 400, { error: "id, type, and control_url are required" });
        }
        await registry.register(record);
        return json(res, 200, { ok: true, id: record.id });
      }

      // /agents/:id/...
      const parsed = parseAgentPath(pathname);
      if (!parsed) return json(res, 404, { error: "not found" });
      const { id, action } = parsed;

      // DELETE /agents/:id
      if (req.method === "DELETE" && !action) {
        await registry.deregister(id);
        return json(res, 200, { ok: true });
      }

      // POST /agents/:id/restart
      if (req.method === "POST" && action === "restart") {
        const agent = await registry.get(id);
        if (!agent) return json(res, 404, { error: `agent ${id} not found` });
        const result = await dispatchRestart(agent, opts.controlAuthToken);
        return json(res, 200, { ok: true, result });
      }

      // GET /agents/:id/logs
      if (req.method === "GET" && action === "logs") {
        const agent = await registry.get(id);
        if (!agent) return json(res, 404, { error: `agent ${id} not found` });
        const lines = parseInt(url.searchParams.get("lines") ?? "50", 10);
        const content = await dispatchLogs(agent, lines, opts.controlAuthToken);
        return json(res, 200, { id, lines, content });
      }

      return json(res, 404, { error: "not found" });
    } catch (err) {
      return json(res, 500, { error: (err as Error).message });
    }
  });

  server.listen(opts.port, () => {
    console.log(`[agent-ops/api] registry API listening on :${opts.port}`);
  });

  return server;
}
