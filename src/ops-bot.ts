/**
 * Telegram ops bot — single bot that manages the entire cc-tg agent fleet.
 *
 * Commands:
 *   /agents           — list all registered agents with liveness status
 *   /health           — summary health view
 *   /restart <id>     — POST /restart to named agent's control endpoint
 *   /logs <id>        — tail logs from named agent
 *   /update all       — restart every agent (launchd respawn = auto-update)
 *   /broadcast <msg>  — send a message via each agent's Telegram bot token
 */

import TelegramBot from "node-telegram-bot-api";
import { AgentRegistry, AgentRecord } from "./registry.js";

const BOT_TOKEN = process.env.OPS_BOT_TOKEN;
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const CONTROL_AUTH_TOKEN = process.env.CONTROL_AUTH_TOKEN;
const ALLOWED_CHAT_IDS = (process.env.ALLOWED_CHAT_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!BOT_TOKEN) {
  console.error("OPS_BOT_TOKEN env var is required");
  process.exit(1);
}

const registry = new AgentRegistry(REDIS_URL);
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

async function controlFetch(agent: AgentRecord, path: string, method = "GET"): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (CONTROL_AUTH_TOKEN) headers["Authorization"] = `Bearer ${CONTROL_AUTH_TOKEN}`;
  return fetch(`${agent.control_url}${path}`, { method, headers });
}

function agentLine(a: AgentRecord): string {
  const ago = Math.floor((Date.now() - new Date(a.last_seen).getTime()) / 1000);
  const status = ago < 90 ? "✅" : "❌";
  return `${status} \`${a.id}\` [${a.type ?? 'cc-tg'}] — ${a.bot_username} @ ${a.hostname} (${ago}s ago)`;
}

function isAllowed(chatId: number): boolean {
  if (ALLOWED_CHAT_IDS.length === 0) return true; // open if not configured
  return ALLOWED_CHAT_IDS.includes(String(chatId));
}

bot.onText(/\/agents/, async (msg) => {
  if (!isAllowed(msg.chat.id)) return;
  const agents = await registry.list();
  if (agents.length === 0) {
    return bot.sendMessage(msg.chat.id, "No agents registered.");
  }
  const lines = agents.map(agentLine).join("\n");
  bot.sendMessage(msg.chat.id, `*Registered agents (${agents.length}):*\n${lines}`, {
    parse_mode: "Markdown",
  });
});

bot.onText(/\/health/, async (msg) => {
  if (!isAllowed(msg.chat.id)) return;
  const agents = await registry.list();
  const alive = agents.filter(
    (a) => (Date.now() - new Date(a.last_seen).getTime()) / 1000 < 90
  );
  const dead = agents.length - alive.length;
  bot.sendMessage(
    msg.chat.id,
    `*Fleet health:*\n✅ Alive: ${alive.length}\n❌ Dead/stale: ${dead}\nTotal: ${agents.length}`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/restart (.+)/, async (msg, match) => {
  if (!isAllowed(msg.chat.id)) return;
  const id = match?.[1]?.trim();
  if (!id) return bot.sendMessage(msg.chat.id, "Usage: /restart <agent-id>");

  const agent = await registry.get(id);
  if (!agent) return bot.sendMessage(msg.chat.id, `Agent \`${id}\` not found.`, { parse_mode: "Markdown" });

  try {
    const res = await controlFetch(agent, "/restart", "POST");
    const body = await res.json();
    bot.sendMessage(msg.chat.id, `Restarting \`${id}\`… ${JSON.stringify(body)}`, { parse_mode: "Markdown" });
  } catch (err) {
    bot.sendMessage(msg.chat.id, `Failed to reach \`${id}\`: ${(err as Error).message}`, { parse_mode: "Markdown" });
  }
});

bot.onText(/\/logs (.+)/, async (msg, match) => {
  if (!isAllowed(msg.chat.id)) return;
  const id = match?.[1]?.trim();
  if (!id) return bot.sendMessage(msg.chat.id, "Usage: /logs <agent-id>");

  const agent = await registry.get(id);
  if (!agent) return bot.sendMessage(msg.chat.id, `Agent \`${id}\` not found.`, { parse_mode: "Markdown" });

  try {
    const res = await controlFetch(agent, "/logs?lines=50");
    const body = await res.json() as { content: string };
    const snippet = body.content.slice(-3000); // Telegram message limit
    bot.sendMessage(msg.chat.id, `*Logs for \`${id}\`:*\n\`\`\`\n${snippet}\n\`\`\``, { parse_mode: "Markdown" });
  } catch (err) {
    bot.sendMessage(msg.chat.id, `Failed to reach \`${id}\`: ${(err as Error).message}`, { parse_mode: "Markdown" });
  }
});

bot.onText(/\/update all/, async (msg) => {
  if (!isAllowed(msg.chat.id)) return;
  const agents = await registry.list();
  if (agents.length === 0) return bot.sendMessage(msg.chat.id, "No agents to update.");

  bot.sendMessage(msg.chat.id, `Triggering restart on ${agents.length} agent(s)…`);
  const results = await Promise.allSettled(
    agents.map((a) => controlFetch(a, "/restart", "POST"))
  );
  const ok = results.filter((r) => r.status === "fulfilled").length;
  bot.sendMessage(msg.chat.id, `Done. ${ok}/${agents.length} responded to restart.`);
});

bot.onText(/\/broadcast (.+)/, async (msg, match) => {
  if (!isAllowed(msg.chat.id)) return;
  const message = match?.[1]?.trim();
  if (!message) return bot.sendMessage(msg.chat.id, "Usage: /broadcast <message>");
  // Broadcast is a no-op in the ops bot itself — it's a reminder / template
  // that each cc-tg instance handles /broadcast via its own bot token.
  bot.sendMessage(
    msg.chat.id,
    `Broadcast "\`${message}\`" — send this command to each agent's chat directly, or integrate with the control endpoint.`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/metrics/, async (msg) => {
  if (!isAllowed(msg.chat.id)) return;
  const agents = await registry.list();
  if (agents.length === 0) return bot.sendMessage(msg.chat.id, "No agents registered.");

  const results = await Promise.allSettled(
    agents.map(async (a) => {
      const res = await controlFetch(a, "/metrics");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<{ namespace: string; token_count: number; cost_usd: number }>;
    })
  );

  let totalTokens = 0;
  let totalCost = 0;
  let supported = 0;
  for (const r of results) {
    if (r.status === "fulfilled") {
      totalTokens += r.value.token_count ?? 0;
      totalCost += r.value.cost_usd ?? 0;
      supported++;
    }
  }

  bot.sendMessage(
    msg.chat.id,
    `*Fleet metrics (${supported}/${agents.length} agents reporting):*\nTokens: \`${totalTokens.toLocaleString()}\`\nCost: \`$${totalCost.toFixed(4)}\``,
    { parse_mode: "Markdown" }
  );
});

registry.connect().then(() => {
  console.log("[agent-ops/ops-bot] connected to Redis, polling Telegram…");
});
