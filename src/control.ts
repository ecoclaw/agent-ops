import * as http from 'http'
import * as fs from 'fs'

export interface ControlServerOptions {
  namespace?: string
  version?: string
  logFile?: string
}

export function startControlServer(port: number, opts: ControlServerOptions = {}): http.Server {
  const startTime = Date.now()

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`)

    if (req.method === 'GET' && url.pathname === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        namespace: opts.namespace || process.env.NAMESPACE || 'unknown',
        pid: process.pid,
        uptime: Math.floor((Date.now() - startTime) / 1000),
        version: opts.version || process.env.VERSION || '0.0.0',
      }))
      return
    }

    if (req.method === 'POST' && url.pathname === '/restart') {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('restarting')
      setTimeout(() => process.exit(0), 200)
      return
    }

    if (req.method === 'GET' && url.pathname === '/logs') {
      const lines = parseInt(url.searchParams.get('lines') || '50', 10)
      const logFile = opts.logFile || process.env.LOG_FILE
      if (!logFile) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('LOG_FILE not configured')
        return
      }
      try {
        const content = fs.readFileSync(logFile, 'utf8')
        const allLines = content.split('\n')
        const tail = allLines.slice(-lines).join('\n')
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end(tail)
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end(`Error reading log file: ${e}`)
      }
      return
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not found')
  })

  server.listen(port)
  return server
}
