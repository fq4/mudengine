import { describe, expect, it, vi } from 'vitest';
import { executeGameplayAction } from '../GameplayAdapter';

const deps = () => ({
  character: { room: { map: 1, number: 1 } } as never,
  queue: { enqueue: vi.fn().mockReturnValue(true) } as never,
  combat: { alsoFight: vi.fn() } as never,
  traveller: {},
  walkRoute: vi.fn().mockReturnValue(null)
});

describe('GameplayAdapter', () => {
  it('delegates recovery and supported commands to CommandQueue', () => {
    const d = deps();
    expect(executeGameplayAction({ name: 'recover_health', reason: 'low hp' }, d)).toMatchObject({ ok: true });
    expect(executeGameplayAction({ name: 'execute_supported_command', args: { command: 'look' }, reason: 'observe' }, d)).toMatchObject({ ok: true });
    expect((d.queue as { enqueue: ReturnType<typeof vi.fn> }).enqueue).toHaveBeenCalledTimes(2);
    expect(executeGameplayAction({ name: 'recover_health', reason: 'low hp' }, d).phase).toBe('accepted');
  });
  it('delegates authorized combat and refuses PvP', () => {
    const d = deps();
    expect(executeGameplayAction({ name: 'engage_enemy', args: { name: 'rat' }, reason: 'safe target' }, d)).toMatchObject({ ok: true });
    expect(executeGameplayAction({ name: 'engage_enemy', args: { name: '@player' }, reason: 'unsafe' }, d)).toMatchObject({ ok: false });
    expect((d.combat as { alsoFight: ReturnType<typeof vi.fn> }).alsoFight).toHaveBeenCalledWith('rat');
  });
  it('returns structured inspection detail and resolves named destinations through the world graph', () => {
    const d = deps();
    const world = { searchByName: vi.fn().mockReturnValue([{ map: 1, room: 9, name: 'Bank of Godfrey' }]), route: vi.fn().mockReturnValue({ steps: [{ command: 'e' }] }) };
    const withWorld = { ...d, world: world as never, inspect: () => '{"room":"Guild Street"}' };
    expect(executeGameplayAction({ name: 'inspect_room', reason: 'read state' }, withWorld).message).toContain('Guild Street');
    expect(executeGameplayAction({ name: 'navigate_to', args: { destination: 'Bank of Godfrey' }, reason: 'goal' }, withWorld)).toMatchObject({ ok: true, phase: 'accepted' });
    expect(world.route).toHaveBeenCalledWith('1/1', '1/9', {}, { alternatives: false });
  });
  it('refuses player names as destinations and routes social actions through the queue', () => {
    const d = { ...deps(), knownPlayers: ['Sunwolf'] };
    expect(executeGameplayAction({ name: 'navigate_to', args: { destination: 'Sunwolf' }, reason: 'social goal' }, d)).toMatchObject({ ok: false, phase: 'failed' });
    expect(executeGameplayAction({ name: 'send_message', args: { channel: 'gossip', message: 'hello, world' }, reason: 'roleplay' }, d)).toMatchObject({ ok: true, phase: 'accepted' });
    expect(executeGameplayAction({ name: 'send_message', args: { channel: 'local', message: 'hello room' }, reason: 'roleplay' }, d)).toMatchObject({ ok: true });
    expect((d.queue as { enqueue: ReturnType<typeof vi.fn> }).enqueue).toHaveBeenCalledWith(expect.objectContaining({ command: 'gos hello, world' }));
    expect((d.queue as { enqueue: ReturnType<typeof vi.fn> }).enqueue).toHaveBeenCalledWith(expect.objectContaining({ command: '.hello room' }));
  });
});
