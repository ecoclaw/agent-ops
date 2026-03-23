/**
 * Adapter for cc-tg agents.
 * Calls the embedded control server: /restart, /logs, /status.
 */

export interface CcTgStatus {
  id: string;
  type: string;
  namespace: string;
  pid: number;
  version: string;
  uptime_seconds: number;
  started_at: string;
  last_seen: string;
}

export class CcTgAdapter {
  private headers(authToken?: string): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (authToken) h["Authorization"] = `Bearer ${authToken}`;
    return h;
  }

  async status(controlUrl: string, authToken?: string): Promise<CcTgStatus> {
    const res = await fetch(`${controlUrl}/status`, { headers: this.headers(authToken) });
    if (!res.ok) throw new Error(`cc-tg status failed: ${res.status}`);
    return res.json() as Promise<CcTgStatus>;
  }

  async restart(controlUrl: string, authToken?: string): Promise<{ ok: boolean; message: string }> {
    const res = await fetch(`${controlUrl}/restart`, {
      method: "POST",
      headers: this.headers(authToken),
    });
    if (!res.ok) throw new Error(`cc-tg restart failed: ${res.status}`);
    return res.json() as Promise<{ ok: boolean; message: string }>;
  }

  async logs(controlUrl: string, lines = 50, authToken?: string): Promise<string> {
    const res = await fetch(`${controlUrl}/logs?lines=${lines}`, {
      headers: this.headers(authToken),
    });
    if (!res.ok) throw new Error(`cc-tg logs failed: ${res.status}`);
    const body = (await res.json()) as { content: string };
    return body.content;
  }

  async health(controlUrl: string, authToken?: string): Promise<boolean> {
    try {
      await this.status(controlUrl, authToken);
      return true;
    } catch {
      return false;
    }
  }
}
