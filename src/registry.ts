/**
 * Redis-backed agent registry with heartbeat + TTL liveness.
 *
 * Each cc-tg instance self-registers on start and sends heartbeats every 60s.
 * Keys expire after 120s — any agent that misses 2 heartbeats is considered dead.
 */

import { Redis } from "ioredis";

export interface AgentRecord {
  id: string; // "{hostname}:{namespace}"
  type: 'cc-tg' | 'openclaw' | 'codex' | 'ollama' | 'custom';
  hostname: string;
  user: string;
  bot_username: string;
  cwd: string;
  namespace: string;
  pid: number;
  version: string;
  control_url: string; // "http://host:port" for HTTP control endpoint
  started_at: string; // ISO8601
  last_seen: string; // ISO8601
}

const REGISTRY_PREFIX = "agent-ops:agent:";
const TTL_SECONDS = 120;

export class AgentRegistry {
  private redis: InstanceType<typeof Redis>;

  constructor(redisUrl: string = process.env.REDIS_URL ?? "redis://localhost:6379") {
    this.redis = new Redis(redisUrl, { lazyConnect: true });
  }

  async connect(): Promise<void> {
    await this.redis.connect();
  }

  async disconnect(): Promise<void> {
    await this.redis.quit();
  }

  /** Register or update an agent record. Call on start and every heartbeat. */
  async register(record: AgentRecord): Promise<void> {
    const key = `${REGISTRY_PREFIX}${record.id}`;
    const value = JSON.stringify({ ...record, last_seen: new Date().toISOString() });
    await this.redis.set(key, value, "EX", TTL_SECONDS);
  }

  /** Refresh TTL for a live agent — call every 60s from cc-tg. */
  async heartbeat(id: string): Promise<void> {
    const key = `${REGISTRY_PREFIX}${id}`;
    const raw = await this.redis.get(key);
    if (!raw) return; // never registered or already expired
    const record: AgentRecord = JSON.parse(raw);
    record.last_seen = new Date().toISOString();
    await this.redis.set(key, JSON.stringify(record), "EX", TTL_SECONDS);
  }

  /** Deregister an agent on clean shutdown. */
  async deregister(id: string): Promise<void> {
    await this.redis.del(`${REGISTRY_PREFIX}${id}`);
  }

  /** List all currently-live agents. */
  async list(): Promise<AgentRecord[]> {
    const keys = await this.redis.keys(`${REGISTRY_PREFIX}*`);
    if (keys.length === 0) return [];
    const values = await this.redis.mget(...keys);
    return values
      .filter((v): v is string => v !== null)
      .map((v) => JSON.parse(v) as AgentRecord);
  }

  /** Get a single agent by id. Returns null if not found / expired. */
  async get(id: string): Promise<AgentRecord | null> {
    const raw = await this.redis.get(`${REGISTRY_PREFIX}${id}`);
    return raw ? (JSON.parse(raw) as AgentRecord) : null;
  }
}
