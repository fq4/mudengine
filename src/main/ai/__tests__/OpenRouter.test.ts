import { describe, expect, it, vi, afterEach } from 'vitest';
import { OpenRouterError, OpenRouterProvider } from '../OpenRouter';
afterEach(() => vi.restoreAllMocks());
describe('OpenRouterProvider', () => {
  it('rejects missing credentials without making a request', async () => { const fetch = vi.spyOn(globalThis, 'fetch'); await expect(new OpenRouterProvider({ apiKey: '' }).decide({ character: {}, room: {}, availableActions: [] }, 'x')).rejects.toThrow('OPENROUTER_API_KEY'); expect(fetch).not.toHaveBeenCalled(); });
  it('validates and records a structured response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ objective: 'x', explanation: 'look', action: { name: 'inspect_room', reason: 'safe' } }) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 }));
    const p = new OpenRouterProvider({ apiKey: 'test' }); expect((await p.decide({ character: {}, room: {}, availableActions: ['inspect_room'] }, 'x')).action.name).toBe('inspect_room'); expect(p.usage().requests).toBe(1);
  });
  it('reports a provider 400 body without exposing credentials and does not retry it', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ error: { code: 'context_length_exceeded', message: 'prompt is too large' } }), { status: 400 }));
    const p = new OpenRouterProvider({ apiKey: 'secret-test-key' });
    await expect(p.decide({ character: {}, room: {}, availableActions: [] }, 'x')).rejects.toMatchObject({ status: 400, category: 'context_limit', retryable: false });
    try { await p.decide({ character: {}, room: {}, availableActions: [] }, 'x'); } catch (error) { expect(error).toBeInstanceOf(OpenRouterError); expect(String(error)).toContain('prompt is too large'); expect(String(error)).not.toContain('secret-test-key'); }
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('classifies unsupported parameters and preserves a plain error body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'unsupported_parameter', message: 'response_format is not supported' } }), { status: 400 })).mockResolvedValueOnce(new Response('gateway rejected request', { status: 400 }));
    const p = new OpenRouterProvider({ apiKey: 'test' });
    await expect(p.decide({ character: {}, room: {}, availableActions: [] }, 'x')).rejects.toMatchObject({ category: 'unsupported_parameter' });
    await expect(p.decide({ character: {}, room: {}, availableActions: [] }, 'x')).rejects.toThrow('gateway rejected request');
  });
});
