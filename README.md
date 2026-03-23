# @ecoclaw/agent-ops

Ops layer for the cc-tg agent fleet — discovery, control, and log aggregation across machines.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Telegram Ops Bot                   │
│  /agents /health /restart /logs /update /broadcast  │
└───────────────────┬─────────────────────────────────┘
                    │ HTTP control calls
        ┌───────────┴──────────┐
        │     Redis Registry   │  TTL-based liveness
        │  agent-ops:agent:*   │  heartbeat every 60s
        └───────────┬──────────┘
                    │ self-registers
   ┌────────────────┼────────────────┐
   ▼                ▼                ▼
cc-tg A          cc-tg B          cc-tg C
money-brain      simorgh-app      ...
:8080/status     :8081/status
:8080/restart    :8081/restart
:8080/logs       :8081/logs
```

## Quick Start

### 1. Run the ops bot

```bash
OPS_BOT_TOKEN=<your-bot-token> \
REDIS_URL=redis://localhost:6379 \
CONTROL_AUTH_TOKEN=secret123 \
ALLOWED_CHAT_IDS=123456789 \
npx @ecoclaw/agent-ops
```

### 2. Integrate into cc-tg

Each cc-tg instance needs to:

1. Call `registry.register(record)` on startup
2. Call `registry.heartbeat(id)` every 60s
3. Start `createControlServer({ port, agentRecord, authToken })` on a free port

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full integration spec.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `OPS_BOT_TOKEN` | Yes | Telegram bot token for the ops bot |
| `REDIS_URL` | No | Redis connection URL (default: `redis://localhost:6379`) |
| `CONTROL_AUTH_TOKEN` | No | Bearer token sent to control endpoints |
| `ALLOWED_CHAT_IDS` | No | Comma-separated Telegram chat IDs allowed to use ops bot |

## Commands

| Command | Description |
|---|---|
| `/agents` | List all registered agents with liveness status |
| `/health` | Fleet health summary |
| `/restart <id>` | Restart a specific agent (launchd respawns = auto-update) |
| `/logs <id>` | Tail last 50 lines from agent log file |
| `/update all` | Restart all agents |
| `/broadcast <msg>` | Broadcast message guidance |
