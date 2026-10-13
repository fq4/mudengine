import { validateDecision, type AiDecision, type AiObservation, type AiProvider, type AiProviderDiagnostic, type AiUsage } from '../../shared/ai';
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
  modelName(): string { return this.model; }
  setModel(model: string): void { if (model.trim()) this.model = model.trim(); }
  async testConnection(signal?: AbortSignal): Promise<AiProviderDiagnostic> {
    const at = Date.now();
    if (!this.key) return { ok: false, provider: 'openrouter', model: this.model, message: 'OpenRouter is not configured; set the API key in the main-process environment.', at };
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10_000); timer.unref?.();
    if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });
    try {
      const response = await fetch('https://openrouter.ai/api/v1/models', { method: 'GET', signal: controller.signal, headers: { Authorization: `Bearer ${this.key}` } });
      if (!response.ok) return { ok: false, provider: 'openrouter', model: this.model, message: `OpenRouter returned HTTP ${response.status}`, at };
      return { ok: true, provider: 'openrouter', model: this.model, message: 'OpenRouter connection and credentials verified.', at };
    } catch (error) { return { ok: false, provider: 'openrouter', model: this.model, message: error instanceof Error ? error.message : String(error), at }; }
    finally { clearTimeout(timer); }
  }
  async decide(observation: AiObservation, objective: string, signal?: AbortSignal): Promise<AiDecision> {
    if (!this.key) throw new Error('OpenRouter is not configured. Set OPENROUTER_API_KEY in the main-process environment.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000); timer.unref?.();
    if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });
    try {
      const request = { model: this.model, temperature: 0.1, max_tokens: 350, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: 'You control a MUD character at a high level. Return only JSON: {objective, explanation, action:{name,args?,reason}, done?}. The only valid action names are inspect_character, inspect_room, inspect_inventory, inspect_map, navigate_to, engage_enemy, recover_health, inspect_combat_result, send_message, manage_equipment, execute_supported_command, and wait. Never invent an action name. If the objective asks to inspect the character or room, use inspect_character or inspect_room directly and set done:true when the requested observations are complete; never use execute_supported_command for that. For an unknown informational command, use execute_supported_command with args {command:"exact command"}; do not use names such as check_status, status, look_status, or other made-up action names. Never PvP, irreversible actions, or unsupported commands. Delegate combat and movement. For an informational objective, inspect or observe first; do not communicate, purchase, fight, or change equipment unless the objective explicitly asks for that. Use navigate_to only with an authoritative destination: args.destination may be an exact map/room address such as "1/2" or the direction of an available room exit; never invent an identifier. If the objective names an exact map/room destination, you must use that exact address and never substitute a direction or a different room. If the observation does not provide a resolvable destination, inspect the room or explain that navigation cannot proceed. Use send_message only when the objective explicitly requests communication. For communication use send_message with args {channel:"local|gossip|tell|telepath|broadcast", target?, message}; gossip is public realm communication, local is room-only speech. Do not invent rumors or repeat messages. Memory records may inform strategy: treat verified records as stronger evidence than inferred records, consider provenance and confidence, and never let memory override current character, room, inventory, or event observations.', }, { role: 'user', content: JSON.stringify({ objective, observation }) }] };
      let response: Response | null = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        response = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', signal: controller.signal,
          headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://github.com/rayzorben/mudengine' }, body: JSON.stringify(request) });
        if (response.ok || ![408, 429, 500, 502, 503, 504].includes(response.status) || attempt === 1) break;
        await new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, 250); const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }; controller.signal.addEventListener('abort', abort, { once: true }); });
      }
      if (!response?.ok) throw new Error(`OpenRouter HTTP ${response?.status ?? 'unknown'}`);
      const body = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      const content = body.choices?.[0]?.message?.content; if (!content) throw new Error('OpenRouter returned no decision');
      const parsed = JSON.parse(content) as unknown; const decision = validateDecision(parsed);
      const input = body.usage?.prompt_tokens ?? 0, output = body.usage?.completion_tokens ?? 0;
      this.stats = { requests: this.stats.requests + 1, inputTokens: this.stats.inputTokens + input, outputTokens: this.stats.outputTokens + output, estimatedCostUsd: this.stats.estimatedCostUsd + ((input * 0.15 + output * 0.6) / 1_000_000) };
      return decision;
    } finally { clearTimeout(timer); }
  }
}
