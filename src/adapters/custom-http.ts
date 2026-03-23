/**
 * Generic HTTP adapter for custom agents.
 * Health check via GET /health endpoint.
 */

export interface CustomHealthResult {
  healthy: boolean;
  status?: unknown;
  error?: string;
}

export class CustomHttpAdapter {
  async health(baseUrl: string, authToken?: string): Promise<CustomHealthResult> {
    try {
      const headers: Record<string, string> = {};
      if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
      const res = await fetch(`${baseUrl}/health`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return { healthy: false, error: `HTTP ${res.status}` };
      let status: unknown;
      try {
        status = await res.json();
      } catch {
        status = await res.text();
      }
      return { healthy: true, status };
    } catch (err) {
      return { healthy: false, error: (err as Error).message };
    }
  }

  async restart(baseUrl: string, authToken?: string): Promise<{ ok: boolean }> {
    const headers: Record<string, string> = {};
    if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
    const res = await fetch(`${baseUrl}/restart`, { method: "POST", headers });
    if (!res.ok) throw new Error(`custom-http restart failed: ${res.status}`);
    return { ok: true };
  }

  async logs(baseUrl: string, lines = 50, authToken?: string): Promise<string> {
    const headers: Record<string, string> = {};
    if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
    const res = await fetch(`${baseUrl}/logs?lines=${lines}`, { headers });
    if (!res.ok) throw new Error(`custom-http logs failed: ${res.status}`);
    return res.text();
  }
}
