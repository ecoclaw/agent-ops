import Redis from "ioredis";

export interface AgentRecord {
  hostname: string;
  user: string;
  bot_username: string;
  cwd: string;
  namespace: string;
  pid: number;
  version: string;
  started_at: string;
  control_port: number;
  control_host: string;
}

const REGISTRY_PREFIX = "agent-ops:agent:";
const TTL_SECONDS = 90;

export class AgentRegistry {
  private redis: Redis;
  private heartbeatTimer?: NodeJS.Timeout;
  private agentKey?: string;

  constructor(redisUrl: string = process.env.REDIS_URL ?? "redis://localhost:6379") {
    this.redis = new Redis(redisUrl, { lazyConnect: true });
  }

  async connect(): Promise<void> {
    await this.redis.connect();
  }

  async disconnect(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    await this.redis.quit();
  }

  /** Register this agent and start heartbeat. Call on startup. */
  async register(record: AgentRecord): Promise<void> {
    const key = `${REGISTRY_PREFIX}${record.namespace}:${record.bot_username}`;
    this.agentKey = key;
    const value = JSON.stringify(record);
    await this.redis.set(key, value, "EX", TTL_SECONDS);

    // Renew every 30s so TTL 90s gives 3x grace
    this.heartbeatTimer = setInterval(async () => {
      try {
        await this.redis.set(key, value, "EX", TTL_SECONDS);
      } catch {
        // swallow — agent still runs even if Redis is down
      }
    }, 30_000);
  }

  /** Deregister this agent on clean shutdown. */
  async deregister(): Promise<void> {
    if (this.agentKey) {
      await this.redis.del(this.agentKey);
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
  }

  /** List all live agents from the registry. */
  async listAgents(): Promise<AgentRecord[]> {
    const keys = await this.redis.keys(`${REGISTRY_PREFIX}*`);
    if (keys.length === 0) return [];
    const values = await this.redis.mget(...keys);
    const agents: AgentRecord[] = [];
    for (const v of values) {
      if (v) {
        try {
          agents.push(JSON.parse(v) as AgentRecord);
        } catch {
          // skip malformed entries
        }
      }
    }
    return agents;
  }
}

/** Build an AgentRecord from environment + process info. */
export function buildAgentRecord(opts: {
  bot_username: string;
  namespace: string;
  version: string;
  control_port: number;
  control_host?: string;
}): AgentRecord {
  return {
    hostname: require("os").hostname(),
    user: require("os").userInfo().username,
    bot_username: opts.bot_username,
    cwd: process.cwd(),
    namespace: opts.namespace,
    pid: process.pid,
    version: opts.version,
    started_at: new Date().toISOString(),
    control_port: opts.control_port,
    control_host: opts.control_host ?? require("os").hostname(),
  };
}
