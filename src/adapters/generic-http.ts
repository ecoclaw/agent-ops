/**
 * Generic HTTP adapter — routes to controlEndpoint for any agent type.
 *
 * Expected endpoints on the target:
 *   GET  /status  — agent info (any JSON)
 *   POST /restart — graceful restart
 *   GET  /logs    — log tail (?lines=N)
 *   GET  /health  — health check
 */

export interface GenericHttpStatus {
  [key: string]: unknown;
}

export class GenericHttpAdapter {
  private headers(authToken?: string): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (authToken) h["Authorization"] = `Bearer ${authToken}`;
    return h;
  }

  async status(controlEndpoint: string, authToken?: string): Promise<GenericHttpStatus> {
    const res = await fetch(`${controlEndpoint}/status`, {
      headers: this.headers(authToken),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`generic-http status failed: ${res.status}`);
    return res.json() as Promise<GenericHttpStatus>;
  }

  async restart(controlEndpoint: string, authToken?: string): Promise<{ ok: boolean }> {
    const res = await fetch(`${controlEndpoint}/restart`, {
      method: "POST",
      headers: this.headers(authToken),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`generic-http restart failed: ${res.status}`);
    return { ok: true };
  }

  async logs(controlEndpoint: string, lines = 50, authToken?: string): Promise<string> {
    const res = await fetch(`${controlEndpoint}/logs?lines=${lines}`, {
      headers: this.headers(authToken),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`generic-http logs failed: ${res.status}`);
    const text = await res.text();
    try {
      const body = JSON.parse(text) as unknown;
      if (typeof body === "object" && body !== null && "content" in body) {
        return String((body as { content: unknown }).content);
      }
    } catch {
      // response was not JSON — return as plain text
    }
    return text;
  }

  async health(controlEndpoint: string, authToken?: string): Promise<boolean> {
    try {
      const res = await fetch(`${controlEndpoint}/health`, {
        headers: this.headers(authToken),
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
