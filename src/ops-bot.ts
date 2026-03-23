#!/usr/bin/env node
import TelegramBot from 'node-telegram-bot-api'
import Redis from 'ioredis'
import * as http from 'http'
import { Registry } from './registry'

const OPS_BOT_TOKEN = process.env.OPS_BOT_TOKEN
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
const ALLOWED_USER_IDS = (process.env.ALLOWED_USER_IDS || '').split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean)

if (!OPS_BOT_TOKEN) {
  console.error('OPS_BOT_TOKEN env var is required')
  process.exit(1)
}

const redis = new Redis(REDIS_URL)
const registry = new Registry(redis)
const bot = new TelegramBot(OPS_BOT_TOKEN, { polling: true })

function isAllowed(userId: number): boolean {
  return ALLOWED_USER_IDS.length === 0 || ALLOWED_USER_IDS.includes(userId)
}

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = ''
      res.on('data', (chunk: string) => data += chunk)
      res.on('end', () => resolve(data))
    }).on('error', reject)
  })
}

function httpPost(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const req = http.request({ hostname: parsed.hostname, port: parsed.port, path: parsed.pathname, method: 'POST' }, (res) => {
      let data = ''
      res.on('data', (chunk: string) => data += chunk)
      res.on('end', () => resolve(data))
    })
    req.on('error', reject)
    req.end()
  })
}

bot.onText(/\/agents/, async (msg) => {
  if (!isAllowed(msg.from?.id || 0)) return
  try {
    const agents = await registry.listAgents()
    if (agents.length === 0) {
      await bot.sendMessage(msg.chat.id, 'No agents registered.')
      return
    }
    const now = Date.now()
    const lines = agents.map(a => {
      const ageMs = now - parseInt(a.started_at, 10)
      const ageSec = Math.floor(ageMs / 1000)
      const ageStr = ageSec > 3600 ? `${Math.floor(ageSec/3600)}h` : ageSec > 60 ? `${Math.floor(ageSec/60)}m` : `${ageSec}s`
      return `• ${a.namespace} @ ${a.hostname} pid=${a.pid} v${a.version} age=${ageStr}`
    })
    await bot.sendMessage(msg.chat.id, `Registered agents:\n${lines.join('\n')}`)
  } catch (e) {
    await bot.sendMessage(msg.chat.id, `Error: ${e}`)
  }
})

bot.onText(/\/health/, async (msg) => {
  if (!isAllowed(msg.from?.id || 0)) return
  try {
    const agents = await registry.listAgents()
    if (agents.length === 0) {
      await bot.sendMessage(msg.chat.id, 'No agents registered.')
      return
    }
    const results = await Promise.all(agents.map(async (a) => {
      try {
        await httpGet(`http://${a.hostname}:${a.control_port}/status`)
        return `✓ ${a.namespace}`
      } catch {
        return `✗ ${a.namespace}`
      }
    }))
    await bot.sendMessage(msg.chat.id, results.join('\n'))
  } catch (e) {
    await bot.sendMessage(msg.chat.id, `Error: ${e}`)
  }
})

bot.onText(/\/restart (.+)/, async (msg, match) => {
  if (!isAllowed(msg.from?.id || 0)) return
  const namespace = match?.[1]?.trim()
  if (!namespace) return
  try {
    const agents = await registry.listAgents()
    const agent = agents.find(a => a.namespace === namespace)
    if (!agent) {
      await bot.sendMessage(msg.chat.id, `Agent ${namespace} not found.`)
      return
    }
    await httpPost(`http://${agent.hostname}:${agent.control_port}/restart`)
    await bot.sendMessage(msg.chat.id, `Restart signal sent to ${namespace}.`)
  } catch (e) {
    await bot.sendMessage(msg.chat.id, `Error: ${e}`)
  }
})

bot.onText(/\/logs (.+)/, async (msg, match) => {
  if (!isAllowed(msg.from?.id || 0)) return
  const namespace = match?.[1]?.trim()
  if (!namespace) return
  try {
    const agents = await registry.listAgents()
    const agent = agents.find(a => a.namespace === namespace)
    if (!agent) {
      await bot.sendMessage(msg.chat.id, `Agent ${namespace} not found.`)
      return
    }
    const logs = await httpGet(`http://${agent.hostname}:${agent.control_port}/logs?lines=50`)
    const truncated = logs.length > 4000 ? logs.slice(-4000) : logs
    await bot.sendMessage(msg.chat.id, `Logs for ${namespace}:\n\`\`\`\n${truncated}\n\`\`\``, { parse_mode: 'Markdown' })
  } catch (e) {
    await bot.sendMessage(msg.chat.id, `Error: ${e}`)
  }
})

console.log('ops-bot running')
