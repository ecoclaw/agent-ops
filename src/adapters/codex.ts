/**
 * Adapter for codex agents (OpenAI-compatible API).
 * Health check via GET /models.
 */

export interface CodexHealthResult {
  healthy: boolean;
  models?: string[];
  error?: string;
}

export class CodexAdapter {
  private headers(apiKey?: string): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) h["Authorization"] = `Bearer ${apiKey}`;
    return h;
  }

  async health(baseUrl: string, apiKey?: string): Promise<CodexHealthResult> {
    try {
      const res = await fetch(`${baseUrl}/models`, {
        headers: this.headers(apiKey),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return { healthy: false, error: `HTTP ${res.status}` };
      const body = (await res.json()) as { data: Array<{ id: string }> };
      return { healthy: true, models: body.data.map((m) => m.id) };
    } catch (err) {
      return { healthy: false, error: (err as Error).message };
    }
  }

  async complete(
    baseUrl: string,
    model: string,
    prompt: string,
    apiKey?: string,
  ): Promise<string> {
    const res = await fetch(`${baseUrl}/completions`, {
      method: "POST",
      headers: this.headers(apiKey),
      body: JSON.stringify({ model, prompt, max_tokens: 16 }),
    });
    if (!res.ok) throw new Error(`codex complete failed: ${res.status}`);
    const body = (await res.json()) as { choices: Array<{ text: string }> };
    return body.choices[0]?.text ?? "";
  }
}
