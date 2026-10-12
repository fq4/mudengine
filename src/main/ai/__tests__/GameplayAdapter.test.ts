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
});
