# Architecture

## Components

### 1. Registry (`src/registry.ts`)

Redis-backed agent registry. Each cc-tg instance self-registers with a 120s TTL and sends heartbeats every 60s. Any agent missing 2 consecutive heartbeats is considered dead.

**Key format:** `agent-ops:agent:{hostname}:{namespace}`

**Record fields:**
- `id` — unique `{hostname}:{namespace}`
- `hostname`, `user`, `namespace` — identity
- `bot_username` — Telegram bot handle
- `cwd` — working directory
- `pid` — current process ID
- `version` — cc-tg version
- `control_url` — HTTP control endpoint base URL
- `started_at`, `last_seen` — timestamps

### 2. Control Server (`src/control.ts`)

Minimal Node `http.Server` embedded in each cc-tg instance. Exposes three endpoints:

- `GET /status` — returns agent record + uptime
- `POST /restart` — calls `process.exit(0)`; launchd respawns (= auto-update with `--prefer-online`)
- `GET /logs?lines=N` — returns last N lines of the log file

Optional bearer token auth via `Authorization: Bearer <token>` header.

### 3. Ops Bot (`src/ops-bot.ts`)

Single Telegram bot that:
1. Reads the registry to discover all agents
2. Makes HTTP calls to each agent's control endpoint
3. Reports results back to the Telegram chat

## cc-tg Integration Spec

Add to `gonzih/cc-tg`:

```typescript
import { AgentRegistry, createControlServer } from "@ecoclaw/agent-ops";

const registry = new AgentRegistry(process.env.REDIS_URL);
await registry.connect();

const record = {
  id: `${hostname}:${namespace}`,
  hostname: os.hostname(),
  user: os.userInfo().username,
  bot_username: botInfo.username,
  cwd: process.cwd(),
  namespace: process.env.NAMESPACE ?? "default",
  pid: process.pid,
  version: pkg.version,
  control_url: `http://${os.hostname()}:${CONTROL_PORT}`,
  started_at: new Date().toISOString(),
};

await registry.register(record);
setInterval(() => registry.heartbeat(record.id), 60_000);

createControlServer({
  port: CONTROL_PORT,
  logFile: process.env.LOG_FILE,
  agentRecord: record,
  authToken: process.env.CONTROL_AUTH_TOKEN,
});
```

## Network Topology

All cc-tg instances and the ops bot must be on the same network segment (Tailscale recommended). The control endpoint port (default 8080) must be reachable from the ops bot host.

## Security

- Use `CONTROL_AUTH_TOKEN` to protect control endpoints
- Restrict `ALLOWED_CHAT_IDS` to your personal Telegram chat
- Run on Tailscale — don't expose control ports to the public internet
