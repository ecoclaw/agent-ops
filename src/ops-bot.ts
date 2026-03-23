#!/usr/bin/env node
/**
 * Telegram ops bot — monitors and controls cc-tg agent fleet.
 *
 * Required env vars:
 *   OPS_BOT_TOKEN   — Telegram bot token for the ops bot
 *   REDIS_URL       — Redis connection URL (default: redis://localhost:6379)
 *   OPS_ALLOWED_IDS — comma-separated list of Telegram user IDs allowed to use the bot
 */
import { Telegraf, Context } from "telegraf";
import { AgentRegistry } from "./registry.js";
import { pingAgent, restartAgent, fetchAgentLogs } from "./control.js";

const TOKEN = process.env.OPS_BOT_TOKEN;
if (!TOKEN) {
  console.error("OPS_BOT_TOKEN is required");
  process.exit(1);
}

const ALLOWED_IDS = (process.env.OPS_ALLOWED_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const registry = new AgentRegistry(process.env.REDIS_URL);
const bot = new Telegraf(TOKEN);

function isAllowed(ctx: Context): boolean {
  if (ALLOWED_IDS.length === 0) return true;
  return ALLOWED_IDS.includes(String(ctx.from?.id));
}

function guard(ctx: Context): boolean {
  if (!isAllowed(ctx)) {
    void ctx.reply("Unauthorized.");
    return false;
  }
  return true;
}

/** /agents — list all live agents from registry */
bot.command("agents", async (ctx) => {
  if (!guard(ctx)) return;
  try {
    const agents = await registry.listAgents();
    if (agents.length === 0) {
      await ctx.reply("No agents registered.");
      return;
    }
    const lines = agents.map(
      (a) =>
        `• *${a.namespace}/${a.bot_username}* @ ${a.hostname}\n  pid:${a.pid} port:${a.control_port} v${a.version}\n  started: ${a.started_at}`
    );
    await ctx.reply(lines.join("\n\n"), { parse_mode: "Markdown" });
  } catch (err) {
    await ctx.reply(`Error: ${String(err)}`);
  }
});

/** /health — ping each agent's control endpoint */
bot.command("health", async (ctx) => {
  if (!guard(ctx)) return;
  try {
    const agents = await registry.listAgents();
    if (agents.length === 0) {
      await ctx.reply("No agents registered.");
      return;
    }
    const results = await Promise.all(
      agents.map(async (a) => {
        const status = await pingAgent(a.control_host, a.control_port);
        const icon = status ? "✅" : "❌";
        const uptime = status
          ? ` uptime ${Math.round((status.uptime_ms as number) / 1000)}s`
          : " unreachable";
        return `${icon} *${a.namespace}/${a.bot_username}*${uptime}`;
      })
    );
    await ctx.reply(results.join("\n"), { parse_mode: "Markdown" });
  } catch (err) {
    await ctx.reply(`Error: ${String(err)}`);
  }
});

/**
 * /restart <name> — POST /restart to agent matching name.
 * <name> can be namespace/bot_username or just bot_username.
 */
bot.command("restart", async (ctx) => {
  if (!guard(ctx)) return;
  const name = ctx.message.text.replace(/^\/restart\s*/, "").trim();
  if (!name) {
    await ctx.reply("Usage: /restart <name>");
    return;
  }
  try {
    const agents = await registry.listAgents();
    const agent = agents.find(
      (a) => a.bot_username === name || `${a.namespace}/${a.bot_username}` === name
    );
    if (!agent) {
      await ctx.reply(`No agent found matching: ${name}`);
      return;
    }
    await ctx.reply(`Sending restart to ${agent.namespace}/${agent.bot_username}...`);
    const ok = await restartAgent(agent.control_host, agent.control_port);
    await ctx.reply(
      ok
        ? `✅ Restart signal sent to ${agent.namespace}/${agent.bot_username}. It should come back online shortly.`
        : `❌ Failed to reach ${agent.namespace}/${agent.bot_username} control endpoint.`
    );
  } catch (err) {
    await ctx.reply(`Error: ${String(err)}`);
  }
});

/** /logs <name> — fetch last 50 log lines from agent */
bot.command("logs", async (ctx) => {
  if (!guard(ctx)) return;
  const name = ctx.message.text.replace(/^\/logs\s*/, "").trim();
  if (!name) {
    await ctx.reply("Usage: /logs <name>");
    return;
  }
  try {
    const agents = await registry.listAgents();
    const agent = agents.find(
      (a) => a.bot_username === name || `${a.namespace}/${a.bot_username}` === name
    );
    if (!agent) {
      await ctx.reply(`No agent found matching: ${name}`);
      return;
    }
    const lines = await fetchAgentLogs(agent.control_host, agent.control_port, 50);
    if (!lines) {
      await ctx.reply(`❌ Could not fetch logs from ${name}`);
      return;
    }
    const text = lines.filter(Boolean).join("\n");
    const truncated = text.length > 3800 ? "...\n" + text.slice(text.length - 3800) : text;
    await ctx.reply(`\`\`\`\n${truncated}\n\`\`\``, { parse_mode: "Markdown" });
  } catch (err) {
    await ctx.reply(`Error: ${String(err)}`);
  }
});

/** /help and /start */
bot.command(["help", "start"], async (ctx) => {
  if (!guard(ctx)) return;
  const help = [
    "*agent-ops bot*",
    "",
    "/agents — list all registered agents",
    "/health — ping each agent's control endpoint",
    "/restart <name> — restart an agent (name = bot\\_username or namespace/bot\\_username)",
    "/logs <name> — fetch last 50 log lines from agent",
  ].join("\n");
  await ctx.reply(help, { parse_mode: "Markdown" });
});

async function main() {
  await registry.connect();
  console.log("[ops-bot] connected to Redis, polling Telegram...");

  process.once("SIGTERM", async () => {
    bot.stop("SIGTERM");
    await registry.disconnect();
  });
  process.once("SIGINT", async () => {
    bot.stop("SIGINT");
    await registry.disconnect();
  });

  await bot.launch();
}

void main();
