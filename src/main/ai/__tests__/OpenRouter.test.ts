import { describe, expect, it, vi, afterEach } from 'vitest';
import { OpenRouterProvider } from '../OpenRouter';
afterEach(() => vi.restoreAllMocks());
describe('OpenRouterProvider', () => {
  it('rejects missing credentials without making a request', async () => { const fetch = vi.spyOn(globalThis, 'fetch'); await expect(new OpenRouterProvider({ apiKey: '' }).decide({ character: {}, room: {}, availableActions: [] }, 'x')).rejects.toThrow('OPENROUTER_API_KEY'); expect(fetch).not.toHaveBeenCalled(); });
  it('validates and records a structured response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ objective: 'x', explanation: 'look', action: { name: 'inspect_room', reason: 'safe' } }) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 }));
    const p = new OpenRouterProvider({ apiKey: 'test' }); expect((await p.decide({ character: {}, room: {}, availableActions: ['inspect_room'] }, 'x')).action.name).toBe('inspect_room'); expect(p.usage().requests).toBe(1);
  });
});
