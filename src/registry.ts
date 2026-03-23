import type { Redis } from 'ioredis'

export interface AgentRecord {
  hostname: string
  user: string
  bot_username: string
  cwd: string
  namespace: string
  pid: string
  version: string
  started_at: string
  control_port: string
}

export class Registry {
  constructor(private redis: Redis) {}

  async register(record: AgentRecord): Promise<void> {
    const key = `agent-ops:agent:${record.namespace}`
    await this.redis.hset(key, record as unknown as Record<string, string>)
    await this.redis.expire(key, 90)
  }

  async heartbeat(namespace: string): Promise<void> {
    const key = `agent-ops:agent:${namespace}`
    await this.redis.expire(key, 90)
  }

  async listAgents(): Promise<AgentRecord[]> {
    const keys: string[] = []
    let cursor = '0'
    do {
      const [nextCursor, found] = await this.redis.scan(cursor, 'MATCH', 'agent-ops:agent:*', 'COUNT', 100)
      cursor = nextCursor
      keys.push(...found)
    } while (cursor !== '0')

    const agents: AgentRecord[] = []
    for (const key of keys) {
      const data = await this.redis.hgetall(key)
      if (data && Object.keys(data).length > 0) {
        agents.push(data as unknown as AgentRecord)
      }
    }
    return agents
  }
}
