# agent-ops Architecture

## Control Endpoints (HTTP)

Each cc-tg agent exposes a lightweight HTTP server on `CC_AGENT_OPS_PORT`. Endpoints:

- `GET /status` — returns JSON with namespace, pid, uptime, version
- `POST /restart` — triggers `process.exit(0)` after 200ms (supervisor/pm2 restarts the process)
- `GET /logs?lines=N` — tails the last N lines from `LOG_FILE`

**Why HTTP over SSH/pipes:** Works transparently over Tailscale and LAN without additional auth setup. cc-tg already has `process.exit` restart logic, so `/restart` is a thin wrapper. Zero TLS/key management on a trusted local network.

## Agent Registry (Redis)

Each agent self-registers at startup and refreshes a 90-second TTL key every 60 seconds. If a process dies, its entry expires automatically. The ops-bot queries Redis to discover all live agents.

Key schema: `agent-ops:agent:<namespace>` → Redis Hash with fields matching `AgentRecord`.

## Integration with cc-tg

cc-tg reads two optional env vars:

- `CC_AGENT_OPS_PORT` — if set, start the HTTP control server on this port and register with Redis
- `REDIS_URL` — already used by cc-agent; reused for the agent registry

```typescript
import { Registry, startControlServer } from '@ecoclaw/agent-ops'
// on start:
if (process.env.CC_AGENT_OPS_PORT) {
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379')
  const registry = new Registry(redis)
  await registry.register({ namespace, hostname, pid, version, cwd, control_port, ... })
  setInterval(() => registry.heartbeat(namespace), 60_000)
  startControlServer(Number(process.env.CC_AGENT_OPS_PORT), { logFile: process.env.LOG_FILE })
}
```

## ops-bot

Telegram bot that queries Redis for live agents and proxies commands to their control endpoints. Set `OPS_BOT_TOKEN`, `REDIS_URL`, and optionally `ALLOWED_USER_IDS` (comma-separated Telegram user IDs).
