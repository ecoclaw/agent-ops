/**
 * Adapter for openclaw agents (Ollama-compatible API).
 * Health check via POST /api/generate with a minimal prompt.
 */

export interface OpenclawHealthResult {
  healthy: boolean;
  model?: string;
  error?: string;
}

export class OpenclawAdapter {
  async health(baseUrl: string, model = "llama3"): Promise<OpenclawHealthResult> {
    try {
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt: "ping", stream: false }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return { healthy: false, error: `HTTP ${res.status}` };
      return { healthy: true, model };
    } catch (err) {
      return { healthy: false, error: (err as Error).message };
    }
  }

  async listModels(baseUrl: string): Promise<string[]> {
    const res = await fetch(`${baseUrl}/api/tags`);
    if (!res.ok) throw new Error(`openclaw list models failed: ${res.status}`);
    const body = (await res.json()) as { models: Array<{ name: string }> };
    return body.models.map((m) => m.name);
  }
}
