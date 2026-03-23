import http from "http";
import fs from "fs";
import { URL } from "url";

export interface ControlServerOptions {
  port: number;
  logFile?: string;
  /** Called just before process.exit(0) on restart requests */
  onBeforeRestart?: () => Promise<void>;
}

/**
 * Lightweight HTTP control server — no frameworks, plain node http.
 *
 * Endpoints:
 *   GET  /status          — returns JSON with pid, uptime, memory
 *   POST /restart         — calls process.exit(0) after optional hook
 *   GET  /logs?lines=50   — returns last N lines of the log file
 */
export function createControlServer(opts: ControlServerOptions): http.Server {
  const startTime = Date.now();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${opts.port}`);

    res.setHeader("Content-Type", "application/json");

    // GET /status
    if (req.method === "GET" && url.pathname === "/status") {
      const status = {
        pid: process.pid,
        uptime_ms: Date.now() - startTime,
        memory: process.memoryUsage(),
        node_version: process.version,
        cwd: process.cwd(),
        timestamp: new Date().toISOString(),
      };
      res.writeHead(200);
      res.end(JSON.stringify(status));
      return;
    }

    // POST /restart
    if (req.method === "POST" && url.pathname === "/restart") {
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, message: "restarting" }));

      const doRestart = async () => {
        if (opts.onBeforeRestart) {
          try {
            await opts.onBeforeRestart();
          } catch {
            // best effort
          }
        }
        process.exit(0);
      };

      // Give the response time to flush
      setTimeout(() => { void doRestart(); }, 200);
      return;
    }

    // GET /logs?lines=N
    if (req.method === "GET" && url.pathname === "/logs") {
      if (!opts.logFile) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: "no log file configured" }));
        return;
      }

      const n = parseInt(url.searchParams.get("lines") ?? "50", 10);

      try {
        const content = fs.readFileSync(opts.logFile, "utf8");
        const lines = content.split("\n");
        const tail = lines.slice(Math.max(0, lines.length - n));
        res.writeHead(200);
        res.end(JSON.stringify({ lines: tail, total: lines.length }));
      } catch (err: unknown) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: "not found" }));
  });

  server.listen(opts.port, "0.0.0.0", () => {
    console.log(`[agent-ops] control server listening on :${opts.port}`);
  });

  return server;
}

/** Ping a control endpoint and return status or null on failure. */
export async function pingAgent(host: string, port: number, timeoutMs = 3000): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { req.destroy(); resolve(null); }, timeoutMs);
    const req = http.get(`http://${host}:${port}/status`, (res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      res.on("end", () => {
        clearTimeout(timer);
        try {
          resolve(JSON.parse(body) as Record<string, unknown>);
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => { clearTimeout(timer); resolve(null); });
  });
}

/** POST /restart to a control endpoint. */
export async function restartAgent(host: string, port: number, timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const options: http.RequestOptions = {
      hostname: host,
      port,
      path: "/restart",
      method: "POST",
      headers: { "Content-Length": "0" },
    };
    const timer = setTimeout(() => { req.destroy(); resolve(false); }, timeoutMs);
    const req = http.request(options, (res) => {
      res.resume(); // drain
      clearTimeout(timer);
      resolve(res.statusCode === 200);
    });
    req.on("error", () => { clearTimeout(timer); resolve(false); });
    req.end();
  });
}

/** GET /logs from a control endpoint. */
export async function fetchAgentLogs(host: string, port: number, lines = 50, timeoutMs = 5000): Promise<string[] | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { req.destroy(); resolve(null); }, timeoutMs);
    const req = http.get(`http://${host}:${port}/logs?lines=${lines}`, (res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      res.on("end", () => {
        clearTimeout(timer);
        try {
          const parsed = JSON.parse(body) as { lines?: string[] };
          resolve(parsed.lines ?? null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => { clearTimeout(timer); resolve(null); });
  });
}
