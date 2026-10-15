import { describe, expect, it, vi, afterEach } from 'vitest';
import { OpenRouterProvider } from '../OpenRouter';
afterEach(() => vi.restoreAllMocks());
describe('OpenRouterProvider', () => {
  it('rejects missing credentials without making a request', async () => { const fetch = vi.spyOn(globalThis, 'fetch'); await expect(new OpenRouterProvider({ apiKey: '' }).decide({ character: {}, room: {}, availableActions: [] }, 'x')).rejects.toThrow('OPENROUTER_API_KEY'); expect(fetch).not.toHaveBeenCalled(); });
  it('validates and records a structured response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ objective: 'x', explanation: 'look', action: { name: 'inspect_room', reason: 'safe' } }) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 }));
    const p = new OpenRouterProvider({ apiKey: 'test', model: 'test/model' }); expect(p.modelName()).toBe('test/model'); expect((await p.decide({ character: {}, room: {}, availableActions: ['inspect_room'] }, 'x')).action.name).toBe('inspect_room'); expect(p.usage().requests).toBe(1);
  });
  it('sends structured memory trust signals with the decision context', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ objective: 'x', explanation: 'look', action: { name: 'inspect_room', reason: 'safe' } }) } }] }), { status: 200 }));
    const memories = [{ category: 'fact' as const, text: 'The north exit is blocked', provenance: 'Observed direction refusal', confidence: 0.9, verified: true }];
    await new OpenRouterProvider({ apiKey: 'test' }).decide({ character: {}, room: {}, availableActions: ['inspect_room'], memories }, 'x');
    const request = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as { messages: Array<{ role: string; content: string }> };
    expect(request.messages[0]?.content).toContain('verified records');
    const userMessage = request.messages.find(({ role }) => role === 'user')?.content ?? '';
    expect(userMessage).toContain('Observed direction refusal');
    expect(userMessage).toContain('"confidence":0.9');
  });
  it('instructs the model not to communicate for informational objectives', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ objective: 'inspect', explanation: 'look', action: { name: 'inspect_room', reason: 'safe' } }) } }] }), { status: 200 }));
    await new OpenRouterProvider({ apiKey: 'test' }).decide({ character: {}, room: {}, availableActions: ['inspect_room', 'send_message'] }, 'inspect the room');
    const request = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as { messages: Array<{ content: string }> };
    expect(request.messages[0]?.content).toContain('For an informational objective, inspect or observe first');
    expect(request.messages[0]?.content).toContain('Use send_message only when the objective explicitly requests communication');
  });
  it('composes a gossip reply from a fresh inbound event candidate', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                objective: 'reply',
                explanation: 'respond',
                action: {
                  name: 'send_message',
                  args: { channel: 'gossip', message: 'Welcome!' },
                  reason: 'reply to Jumanji'
                }
              })
            }
          }]
        }),
        { status: 200 }
      )
    );
    await new OpenRouterProvider({ apiKey: 'test' }).decide({
      character: {},
      room: {},
      availableActions: ['send_message'],
      activityCandidates: [
        {
          action: {
            name: 'send_message',
            args: { channel: 'gossip' },
            reason: 'reply briefly to inbound gossip'
          },
          priority: 85,
          rationale: 'a recent inbound gossip message is available'
        }
      ],
      event: 'conversation-gossip from Jumanji: Welcome, Kefka!'
    }, 'Respond to anyone on the gossip channel');
    const request = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    const replyInstruction = request.messages.find(({ content }) =>
      content.includes('Generate the reply message text from the event')
    );
    expect(replyInstruction?.role).toBe('system');
  });
  it('requires an exact destination when the objective names one', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ objective: 'travel', explanation: 'route', action: { name: 'navigate_to', args: { destination: '1/2' }, reason: 'exact target' } }) } }] }), { status: 200 }));
    await new OpenRouterProvider({ apiKey: 'test' }).decide({ character: {}, room: {}, availableActions: ['navigate_to'] }, 'Navigate to 1/2, then stop.');
    expect(request.mock.calls[0]?.[1]).toBeDefined();
    const body = JSON.parse(String(request.mock.calls[0]?.[1]?.body));
    expect(body.messages[0].content).toContain('must use that exact address and never substitute a direction');
  });
  it('directs unknown informational commands through the supported-command action', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ objective: 'status', explanation: 'check', action: { name: 'execute_supported_command', args: { command: 'status' }, reason: 'requested status' } }) } }] }), { status: 200 }));
    await new OpenRouterProvider({ apiKey: 'test' }).decide({ character: {}, room: {}, availableActions: ['execute_supported_command'] }, 'Check my current status using an unknown informational command');
    const request = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as { messages: Array<{ content: string }> };
    expect(request.messages[0]?.content).toContain('For an unknown informational command, use execute_supported_command');
    expect(request.messages[0]?.content).toContain('Never invent an action name');
  });
  it('normalizes safe inspection aliases but rejects unknown actions', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ objective: 'inspect', explanation: 'look', action: { name: 'look', reason: 'inspect room' }, done: true }) } }] }), { status: 200 }));
    const decision = await new OpenRouterProvider({ apiKey: 'test' }).decide({ character: {}, room: {}, availableActions: ['inspect_room'] }, 'inspect the room');
    expect(decision.action.name).toBe('inspect_room');
    fetch.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ objective: 'x', explanation: 'x', action: { name: 'dance', reason: 'x' } }) } }] }), { status: 200 }));
    await expect(new OpenRouterProvider({ apiKey: 'test' }).decide({ character: {}, room: {}, availableActions: [] }, 'x')).rejects.toThrow('dance');
  });
  it('does not turn an unknown status command into a named inspection', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ objective: 'check status', explanation: 'check status', action: { name: 'check_status', reason: 'requested status' } }) } }] }), { status: 200 }));
    await expect(new OpenRouterProvider({ apiKey: 'test' }).decide({ character: {}, room: {}, availableActions: ['execute_supported_command'] }, 'Check my current status using an unknown informational command')).rejects.toThrow('check_status');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('keeps safe inspection decisions auditable when the model omits reason', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ objective: 'inspect', explanation: 'look', action: { name: 'inspect_character' }, done: true }) } }] }), { status: 200 }));
    const decision = await new OpenRouterProvider({ apiKey: 'test' }).decide({ character: {}, room: {}, availableActions: ['inspect_character'] }, 'inspect the character');
    expect(decision.action.reason).toBe('Model requested inspect_character');
  });
  it('keeps equipment delegation auditable when the model omits reason', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ objective: 'equipment', explanation: 'manage', action: { name: 'manage_equipment' }, done: true }) } }] }), { status: 200 }));
    const decision = await new OpenRouterProvider({ apiKey: 'test' }).decide({ character: {}, room: {}, availableActions: ['manage_equipment'] }, 'manage my equipment');
    expect(decision.action.reason).toBe('Model requested manage_equipment');
  });
  it('reports provider connectivity without exposing credentials', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const result = await new OpenRouterProvider({ apiKey: 'secret', model: 'test/model' }).testConnection();
    expect(result).toMatchObject({ ok: true, provider: 'openrouter', model: 'test/model' });
    expect(fetch).toHaveBeenCalledWith('https://openrouter.ai/api/v1/models', expect.objectContaining({ method: 'GET', headers: { Authorization: 'Bearer secret' } }));
    expect(JSON.stringify(result)).not.toContain('secret');
  });
  it('reports missing credentials without making a request', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const result = await new OpenRouterProvider({ apiKey: '' }).testConnection();
    expect(result.ok).toBe(false); expect(fetch).not.toHaveBeenCalled();
  });
  it('retries one transient provider response but not a permanent failure', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ objective: 'x', explanation: 'look', action: { name: 'inspect_room', reason: 'safe' } }) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 }));
    await expect(new OpenRouterProvider({ apiKey: 'test' }).decide({ character: {}, room: {}, availableActions: [] }, 'x')).resolves.toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('does not retry an authentication failure', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 401 }));
    await expect(new OpenRouterProvider({ apiKey: 'test' }).decide({ character: {}, room: {}, availableActions: [] }, 'x')).rejects.toThrow('HTTP 401');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
