import { validateDecision, type AiDecision, type AiObservation, type AiProvider, type AiUsage } from '../../shared/ai';
export type { AiProvider } from '../../shared/ai';

export class OpenRouterProvider implements AiProvider {
  private readonly key: string | undefined;
  private model: string;
  private stats: AiUsage = { requests: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 };
  constructor(options: { apiKey?: string; model?: string } = {}) {
    this.key = options.apiKey ?? process.env.OPENROUTER_API_KEY;
    this.model = options.model ?? process.env.MUDENGINE_AI_MODEL ?? 'openai/gpt-4o-mini';
  }
  usage(): AiUsage { return { ...this.stats }; }
  setModel(model: string): void { if (model.trim()) this.model = model.trim(); }
  async decide(observation: AiObservation, objective: string, signal?: AbortSignal): Promise<AiDecision> {
    if (!this.key) throw new Error('OpenRouter is not configured. Set OPENROUTER_API_KEY in the main-process environment.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000); timer.unref?.();
    if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', signal: controller.signal,
        headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://github.com/rayzorben/mudengine' },
        body: JSON.stringify({ model: this.model, temperature: 0.1, max_tokens: 350, response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: 'You control a MUD character at a high level. Return only JSON: {objective, explanation, action:{name,args?,reason}, done?}. Never PvP, irreversible actions, or unsupported commands. Delegate combat and movement.', }, { role: 'user', content: JSON.stringify({ objective, observation }) }] }) });
      if (!response.ok) throw new Error(`OpenRouter HTTP ${response.status}`);
      const body = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      const content = body.choices?.[0]?.message?.content; if (!content) throw new Error('OpenRouter returned no decision');
      const parsed = JSON.parse(content) as unknown; const decision = validateDecision(parsed);
      const input = body.usage?.prompt_tokens ?? 0, output = body.usage?.completion_tokens ?? 0;
      this.stats = { requests: this.stats.requests + 1, inputTokens: this.stats.inputTokens + input, outputTokens: this.stats.outputTokens + output, estimatedCostUsd: this.stats.estimatedCostUsd + ((input * 0.15 + output * 0.6) / 1_000_000) };
      return decision;
    } finally { clearTimeout(timer); }
  }
}
