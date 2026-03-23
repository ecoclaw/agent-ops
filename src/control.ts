/**
 * Lightweight HTTP control endpoint for a single cc-tg instance.
 *
 * Exposes:
 *   GET  /status  — current agent info + uptime
 *   POST /restart — graceful exit (launchd respawns = auto-update)
 *   GET  /logs    — last N lines of the log file (?lines=100)
 *
 * No framework deps — plain Node http module.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { AgentRecord } from "./registry.js";

export interface ControlServerOptions {
  port: number;
  logFile?: string; // path to cc-tg log file
  agentRecord: Omit<AgentRecord, "last_seen">; // populated by the host process
  authToken?: string; // optional bearer token
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function tailFile(filePath: string, lines: number): string {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const all = content.split("\n");
    return all.slice(Math.max(0, all.length - lines)).join("\n");
  } catch (err) {
    return `(could not read log file: ${(err as Error).message})`;
  }
}

export function createControlServer(opts: ControlServerOptions): http.Server {
  const startedAt = new Date().toISOString();

  const server = http.createServer((req, res) => {
    // Optional auth
    if (opts.authToken) {
      const auth = req.headers["authorization"] ?? "";
      if (auth !== `Bearer ${opts.authToken}`) {
        return json(res, 401, { error: "unauthorized" });
      }
    }

    const url = new URL(req.url ?? "/", `http://localhost:${opts.port}`);

    if (req.method === "GET" && url.pathname === "/status") {
      return json(res, 200, {
        ...opts.agentRecord,
        started_at: startedAt,
        last_seen: new Date().toISOString(),
        uptime_seconds: Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000),
      });
    }

    if (req.method === "POST" && url.pathname === "/restart") {
      json(res, 200, { ok: true, message: "restarting" });
      // Give the response time to flush before exiting
      setTimeout(() => process.exit(0), 200);
      return;
    }

    if (req.method === "GET" && url.pathname === "/logs") {
      const lines = parseInt(url.searchParams.get("lines") ?? "100", 10);
      const logFile = opts.logFile ?? path.join("/tmp", `cc-tg-${opts.agentRecord.namespace}.log`);
      return json(res, 200, {
        file: logFile,
        lines,
        content: tailFile(logFile, lines),
      });
    }

    return json(res, 404, { error: "not found" });
  });

  server.listen(opts.port, () => {
    console.log(`[agent-ops/control] listening on :${opts.port}`);
  });

  return server;
}
