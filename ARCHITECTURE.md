# agent-ops Architecture

## Problem

We run `cc-tg` bots as launchd services across multiple machines (namespaces: `money-brain`, `simorgh`). When a bot crashes or enters a crash loop, the only fix is:

1. SSH into the host
2. Kill the process
3. Wait for launchd to restart it

This is slow, manual, and requires the host to be reachable over SSH.

## Chosen Approach: HTTP Control Endpoints + Redis Registry

Each cc-tg agent runs two things alongside the Telegram bot:

1. **Redis self-registration** (`registry.ts`) — On startup, the agent writes its metadata (hostname, PID, control port, namespace, bot username, etc.) to a Redis key with a 90s TTL. A heartbeat timer renews every 30s. If the agent dies, the key expires naturally.

2. **HTTP control server** (`control.ts`) — A plain `node:http` server on a configurable port (`CC_AGENT_OPS_PORT`). Exposes:
   - `GET /status` — process health (PID, uptime, memory)
   - `POST /restart` — triggers `process.exit(0)`, relying on launchd to respawn
   - `GET /logs?lines=50` — tails the configured log file

3. **Ops Telegram bot** (`ops-bot.ts`) — A separate bot process that reads the registry and calls the control endpoints. Commands: `/agents`, `/health`, `/restart <name>`, `/logs <name>`.

## Why HTTP (not SSH, not named pipes)

| Option | Why rejected |
|--------|-------------|
| SSH | Requires SSH keys distributed across all ops machines; slow; overkill for local-network restarts |
| Named pipes / Unix sockets | Only works on the same machine; no remote control |
| **HTTP over Tailscale/LAN** | ✅ Works across machines on the same Tailscale network or LAN; no auth complexity on trusted network; single open port per agent; easy to curl for debugging |

The cc-tg processes already use `process.exit(0)` as the restart mechanism (launchd `KeepAlive` respawns automatically), so the control server just calls that.

## Security Model

The control server binds to `0.0.0.0` and trusts the network. This is intentional:
- Agents run on private Tailscale IPs or a LAN — not exposed to the internet
- No auth tokens needed; the ops bot is the only consumer
- If exposure beyond the local network is ever needed, add a bearer token to the control server

## Component Diagram

```
┌─────────────────────┐        Redis (shared)
│  cc-tg agent        │  ────────────────────►  agent-ops:agent:<ns>:<bot>
│                     │  heartbeat every 30s     TTL 90s
│  ┌─────────────┐    │
│  │ control     │    │
│  │ server :N   │◄───┼─── HTTP GET/POST from ops-bot
│  └─────────────┘    │
└─────────────────────┘

┌─────────────────────┐
│  ops-bot (separate  │──► reads registry from Redis
│  process/machine)   │──► calls HTTP control endpoints
│                     │──► responds to Telegram commands
└─────────────────────┘
```

## Environment Variables

### cc-tg agent side
| Variable | Description |
|----------|-------------|
| `CC_AGENT_OPS_PORT` | Port for the HTTP control server (required to enable agent-ops) |
| `CC_AGENT_OPS_HOST` | Hostname/IP advertised in registry (default: `os.hostname()`) |
| `REDIS_URL` | Redis connection URL (default: `redis://localhost:6379`) |
| `CC_AGENT_NAMESPACE` | Logical namespace, e.g. `money-brain` |
| `CC_AGENT_LOG_FILE` | Path to log file for `/logs` endpoint |

### ops-bot side
| Variable | Description |
|----------|-------------|
| `OPS_BOT_TOKEN` | Telegram bot token for the ops bot |
| `REDIS_URL` | Same Redis instance as agents |
| `OPS_ALLOWED_IDS` | Comma-separated Telegram user IDs allowed to use the bot |
