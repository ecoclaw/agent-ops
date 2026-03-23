/**
 * @gonzih/agent-ops-sdk
 *
 * Tiny self-registration SDK for any agent that wants to join the agent-ops fleet.
 *
 * Usage:
 *   import { AgentOps } from '@gonzih/agent-ops-sdk';
 *   const ops = new AgentOps({ name: 'my-bot', token: process.env.AGENT_OPS_TOKEN });
 *   ops.register();
 *   ops.heartbeat(30_000);
 *   ops.reportStatus('idle');
 */

import os from "node:os";

export interface AgentOpsOptions {
  /** Human-readable agent name */
  name: string;
  /** API token for the agent-ops registry (AGENT_OPS_TOKEN) */
  token?: string;
  /** Base URL of the agent-ops registry API */
  registryUrl?: string;
  /** Agent type — defaults to 'custom' */
  type?: "cc-tg" | "openclaw" | "codex" | "custom";
  /** Semantic version of this agent */
  version?: string;
  /** URL of this agent's own control/health endpoint */
  controlUrl?: string;
}

export interface RegisterPayload {
  name: string;
  version: string;
  pid: number;
  host: string;
  type: string;
  control_url: string;
}

export interface RegisteredAgent {
  id: string;
  name: string;
  type: string;
  host: string;
  pid: number;
  version: string;
  control_url: string;
  registered_at: string;
}

export class AgentOps {
  private readonly name: string;
  private readonly token: string | undefined;
  private readonly registryUrl: string;
  private readonly type: string;
  private readonly version: string;
  private readonly controlUrl: string;
  private agentId: string | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: AgentOpsOptions) {
    this.name = opts.name;
    this.token = opts.token;
    this.registryUrl = (
      opts.registryUrl ?? process.env["AGENT_OPS_URL"] ?? "http://localhost:3001"
    ).replace(/\/$/, "");
    this.type = opts.type ?? "custom";
    this.version = opts.version ?? process.env["npm_package_version"] ?? "0.0.0";
    this.controlUrl = opts.controlUrl ?? `http://${os.hostname()}:0`;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.token) h["Authorization"] = `Bearer ${this.token}`;
    return h;
  }

  /**
   * Register this agent with the agent-ops registry.
   * Returns the assigned agent ID.
   */
  async register(): Promise<string> {
    const payload: RegisterPayload = {
      name: this.name,
      version: this.version,
      pid: process.pid,
      host: os.hostname(),
      type: this.type,
      control_url: this.controlUrl,
    };

    const res = await fetch(`${this.registryUrl}/agents/register`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        id: `${os.hostname()}:${this.name}`,
        ...payload,
        hostname: os.hostname(),
        user: os.userInfo().username,
        bot_username: this.name,
        cwd: process.cwd(),
        namespace: this.name,
        started_at: new Date().toISOString(),
        last_seen: new Date().toISOString(),
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`agent-ops register failed (${res.status}): ${body}`);
    }

    const data = (await res.json()) as { id: string };
    this.agentId = data.id;
    return this.agentId;
  }

  /**
   * Start sending heartbeats at the given interval (milliseconds).
   * Defaults to 30 seconds.
   */
  heartbeat(intervalMs = 30_000): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      this.ping().catch((err) => {
        console.warn(`[agent-ops-sdk] heartbeat failed: ${(err as Error).message}`);
      });
    }, intervalMs);
    // Allow the process to exit even if heartbeat timer is active
    if (this.heartbeatTimer.unref) this.heartbeatTimer.unref();
  }

  /** Stop heartbeat timer */
  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Report a status string to the registry.
   * The registry stores this as part of the agent record.
   */
  async reportStatus(status: string): Promise<void> {
    const id = this.agentId ?? `${os.hostname()}:${this.name}`;
    const res = await fetch(`${this.registryUrl}/agents/${encodeURIComponent(id)}/status`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`agent-ops reportStatus failed (${res.status}): ${body}`);
    }
  }

  private async ping(): Promise<void> {
    const id = this.agentId ?? `${os.hostname()}:${this.name}`;
    // Re-register refreshes TTL in the Redis-backed registry
    await fetch(`${this.registryUrl}/agents/register`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        id,
        type: this.type,
        hostname: os.hostname(),
        user: os.userInfo().username,
        bot_username: this.name,
        cwd: process.cwd(),
        namespace: this.name,
        pid: process.pid,
        version: this.version,
        control_url: this.controlUrl,
        started_at: new Date().toISOString(),
        last_seen: new Date().toISOString(),
      }),
    });
  }
}
