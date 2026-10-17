import { describe, expect, it } from 'vitest';
import {
  exactCombatApproval,
  LiveHarnessMonitor,
  navigateToWithWalker,
  waitForCombatSettlement,
  waitForRecoveryHealth
} from '../LiveHarness';
import type { AiApproval } from '../../../shared/ai';

const limits = {
  maxRuntimeMs: 10_000,
  maxMoves: 1,
  maxRequests: 2,
  maxTokens: 100,
  maxCostUsd: 0.1,
  maxRepeatedAction: 2
};

describe('exactCombatApproval', () => {
  const approval = (id: string, targetName: string): AiApproval => ({
    id,
    command: 'ai-action:engage_enemy',
    reason: 'verified target',
    risk: 'high',
    contextHash: 'room-and-target',
    target: targetName,
    createdAt: 0,
    expiresAt: 1_000,
    status: 'pending',
    action: {
      name: 'engage_enemy',
      reason: 'verified target',
      args: { name: targetName }
    }
  });

  it('matches only one pending engagement for the exact identified target', () => {
    expect(
      exactCombatApproval(
        [
          approval('other-target', 'rat'),
          approval('approval-1', 'acid slime')
        ],
        'acid slime'
      )
    ).toMatchObject({ id: 'approval-1' });
  });

  it('does not auto-approve a different action or ambiguous duplicate approvals', () => {
    const combat = approval('approval-1', 'acid slime');

    expect(
      exactCombatApproval(
        [
          {
            ...combat,
            action: {
              name: 'manage_equipment',
              reason: 'equipment action',
              args: {}
            }
          }
        ],
        'acid slime'
      )
    ).toBeNull();
    expect(
      exactCombatApproval([combat, approval('approval-2', 'acid slime')], 'acid slime')
    ).toBeNull();
  });
});

describe('navigateToWithWalker', () => {
  it('does not dispatch when already at the authoritative destination', async () => {
    let dispatches = 0;
    const result = await navigateToWithWalker({
      destination: '1/2150',
      roomKey: () => '1/2150',
      progress: () => ({ status: 'idle', reason: null }),
      dispatch: async () => {
        dispatches += 1;
        return { ok: true, message: 'Navigation delegated to Walker' };
      },
      waitFor: async () => false,
      isError: () => false
    });

    expect(dispatches).toBe(0);
    expect(result).toMatchObject({ waitCompleted: true, arrived: true });
  });

  it('dispatches once and waits through intermediate room transitions', async () => {
    let room = '1/2144';
    let status: 'idle' | 'walking' | 'arrived' = 'idle';
    let dispatches = 0;
    let waitedForWalker = false;

    const result = await navigateToWithWalker({
      destination: '1/2150',
      roomKey: () => room,
      progress: () => ({ status, reason: null }),
      dispatch: async () => {
        dispatches += 1;
        status = 'walking';
        return { ok: true, message: 'Navigation delegated to Walker' };
      },
      waitFor: async (predicate, timeoutMs) => {
        expect(timeoutMs).toBe(45_000);
        room = '1/2146';
        expect(predicate()).toBe(false);
        room = '1/2147';
        expect(predicate()).toBe(false);
        waitedForWalker = true;
        room = '1/2150';
        status = 'arrived';
        return predicate();
      },
      isError: () => false
    });

    expect(dispatches).toBe(1);
    expect(waitedForWalker).toBe(true);
    expect(result).toMatchObject({
      before: '1/2144',
      after: '1/2150',
      status: 'arrived',
      waitCompleted: true,
      arrived: true
    });
  });

  it('does not count a stopped route as arrival', async () => {
    const result = await navigateToWithWalker({
      destination: '1/2150',
      roomKey: () => '1/2146',
      progress: () => ({ status: 'stopped', reason: 'No confirmed exit' }),
      dispatch: async () => ({ ok: true, message: 'Navigation delegated to Walker' }),
      waitFor: async (predicate) => predicate(),
      isError: () => false
    });

    expect(result).toMatchObject({
      status: 'stopped',
      reason: 'No confirmed exit',
      waitCompleted: true,
      arrived: false
    });
  });

  it('does not count an arrival at a different room as success', async () => {
    const result = await navigateToWithWalker({
      destination: '1/2150',
      roomKey: () => '1/2147',
      progress: () => ({ status: 'arrived', reason: null }),
      dispatch: async () => ({ ok: true, message: 'Navigation delegated to Walker' }),
      waitFor: async (predicate) => predicate(),
      isError: () => false
    });

    expect(result.arrived).toBe(false);
  });

  it('does not wait or claim arrival when navigation dispatch is refused', async () => {
    let waited = false;
    const result = await navigateToWithWalker({
      destination: '1/2150',
      roomKey: () => '1/2144',
      progress: () => ({ status: 'stopped', reason: 'Move already pending' }),
      dispatch: async () => ({ ok: false, message: 'Move already pending' }),
      waitFor: async () => {
        waited = true;
        return false;
      },
      isError: () => false
    });

    expect(waited).toBe(false);
    expect(result).toMatchObject({
      dispatchMessage: 'Move already pending',
      reason: 'Move already pending',
      waitCompleted: null,
      arrived: false
    });
  });

  it('does not claim arrival when the walker wait times out', async () => {
    const result = await navigateToWithWalker({
      destination: '1/2150',
      roomKey: () => '1/2146',
      progress: () => ({ status: 'walking', reason: null }),
      dispatch: async () => ({ ok: true, message: 'Navigation delegated to Walker' }),
      waitFor: async () => false,
      isError: () => false
    });

    expect(result).toMatchObject({
      status: 'walking',
      waitCompleted: false,
      arrived: false
    });
  });
});

describe('waitForCombatSettlement', () => {
  it('allows an active low-health fight to settle through the combat owner', async () => {
    let engaged = true;
    let target: string | null = 'acid slime';
    const result = await waitForCombatSettlement({
      combat: () => ({ engaged, target, attackers: [] }),
      vitals: () => ({ hp: 20, hpMax: 100 }),
      wait: async (milliseconds) => {
        expect(milliseconds).toBe(500);
        engaged = false;
        target = null;
      },
      isStopped: () => false,
      timeoutMs: 1_000
    });

    expect(result).toEqual({ outcome: 'ended', unresolved: false });
  });

  it('reports an unresolved fight at the bounded deadline', async () => {
    const result = await waitForCombatSettlement({
      combat: () => ({ engaged: true, target: 'acid slime', attackers: [] }),
      vitals: () => ({ hp: 20, hpMax: 100 }),
      wait: async () => {
        throw new Error('No wait should occur after the deadline');
      },
      isStopped: () => false,
      timeoutMs: 0
    });

    expect(result).toEqual({ outcome: 'unsafe', unresolved: true });
  });

  it('does not report settlement while attackers remain after the target clears', async () => {
    let engaged = true;
    let target: string | null = 'acid slime';
    let attackers: string[] = [];
    const result = await waitForCombatSettlement({
      combat: () => ({ engaged, target, attackers }),
      vitals: () => ({ hp: 40, hpMax: 100 }),
      wait: async () => {
        engaged = false;
        target = null;
        attackers = ['second acid slime'];
      },
      isStopped: () => false,
      timeoutMs: 1_000
    });

    expect(result).toEqual({ outcome: 'ended', unresolved: true });
  });
});

describe('waitForRecoveryHealth', () => {
  it('waits for authoritative health to reach the requested recovery threshold', async () => {
    let hp = 40;
    let engaged = false;
    const ready = await waitForRecoveryHealth({
      vitals: () => ({ hp, hpMax: 100 }),
      combatActive: () => engaged,
      wait: async () => {
        hp = 65;
        engaged = false;
      },
      isStopped: () => false,
      minimumFraction: 0.6,
      timeoutMs: 1_000
    });

    expect(ready).toBe(true);
  });

  it('does not treat unknown health or active combat as recovery readiness', async () => {
    const ready = await waitForRecoveryHealth({
      vitals: () => ({ hp: null, hpMax: null }),
      combatActive: () => false,
      wait: async () => {
        throw new Error('No wait should occur after the deadline');
      },
      isStopped: () => false,
      minimumFraction: 0.6,
      timeoutMs: 0
    });

    expect(ready).toBe(false);
  });
});

describe('LiveHarnessMonitor', () => {
  it('allows observation and one safe movement', () => {
    const monitor = new LiveHarnessMonitor(limits);
    monitor.command('look');
    monitor.command('south');
    monitor.room('Village Entrance');
    expect(monitor.failed).toBe(false);
    expect(monitor.moveCount).toBe(1);
  });

  it('stops unsafe commands and repeated actions', () => {
    const monitor = new LiveHarnessMonitor(limits);
    monitor.command('gos hello');
    monitor.action('wait');
    monitor.action('wait');
    monitor.action('wait');
    expect(monitor.violations.map(({ code }) => code)).toEqual(['unsafe-command', 'repeat']);
  });

  it('counts the server-specific st navigation alias and rejects recovery commands', () => {
    const monitor = new LiveHarnessMonitor(limits);
    monitor.command('st');
    monitor.command('stand');
    monitor.command('rest');
    expect(monitor.violations.map(({ code }) => code)).toEqual([
      'unsafe-command',
      'unsafe-command'
    ]);
    expect(monitor.moveCount).toBe(1);
  });

  it('allows combat commands only for an explicitly authorized target', () => {
    const monitor = new LiveHarnessMonitor(limits);
    monitor.command('kill goblin');
    monitor.authorizeCombatTarget('Goblin');
    monitor.command('kill goblin');
    expect(monitor.violations.map(({ code }) => code)).toEqual(['unsafe-command']);
  });

  it('requires explicit phase authorization for recovery and equipment commands', () => {
    const monitor = new LiveHarnessMonitor(limits);
    monitor.command('rest');
    monitor.command('wear rusty helm');
    monitor.authorizeRecovery();
    monitor.authorizeEquipmentChanges();
    monitor.command('rest');
    monitor.command('wear rusty helm');
    expect(monitor.violations.map(({ code }) => code)).toEqual([
      'unsafe-command',
      'unsafe-command'
    ]);
  });

  it('rejects channel prefixes and emote aliases', () => {
    const monitor = new LiveHarnessMonitor(limits);
    monitor.command('.hello');
    monitor.command('broadcast hello');
    monitor.command('emote waves');
    expect(monitor.violations.map(({ code }) => code)).toEqual([
      'unsafe-command',
      'unsafe-command',
      'unsafe-command'
    ]);
  });

  it('permits bounded gossip replies only for recent inbound messages', () => {
    const monitor = new LiveHarnessMonitor(limits);
    monitor.authorizeGossipReplies();
    expect(monitor.gossipReplyEligibility('hello', 100_000)).toMatchObject({ ok: false });
    monitor.incomingGossip('Kefka', 'own echo', 'Kefka', 100_000);
    monitor.incomingGossip('OtherPlayer', 'hello', 'Kefka', 100_000);
    expect(monitor.gossipReplyEligibility('hello', 100_001)).toEqual({ ok: true });
    monitor.command('gos hello', 100_001);
    expect(monitor.gossipRepliesSent).toBe(1);
    expect(monitor.events.find(({ kind }) => kind === 'command')?.value).toBe('gos <redacted>');
    expect(monitor.failed).toBe(false);
  });

  it('rejects unmatched, stale, too-frequent, and excess gossip replies', () => {
    const monitor = new LiveHarnessMonitor(limits);
    monitor.authorizeGossipReplies();
    monitor.incomingGossip('OtherPlayer', 'first message', 'Kefka', 50_000);
    monitor.command('gos first reply', 50_000);
    monitor.incomingGossip('OtherPlayer', 'second message', 'Kefka', 79_999);
    expect(monitor.gossipReplyEligibility('second reply', 79_999)).toMatchObject({ ok: false });

    monitor.incomingGossip('OtherPlayer', 'hello', 'Kefka', 100_000);
    expect(monitor.gossipReplyEligibility('hello', 190_001)).toMatchObject({ ok: false });

    for (let reply = 0; reply < 4; reply += 1) {
      const at = 200_000 + reply * 30_000;
      monitor.incomingGossip('OtherPlayer', `message ${reply}`, 'Kefka', at);
      expect(monitor.gossipReplyEligibility(`reply ${reply}`, at)).toEqual({ ok: true });
      monitor.command(`gos reply ${reply}`, at);
    }

    expect(monitor.gossipRepliesSent).toBe(5);
    expect(monitor.gossipReplyEligibility('sixth reply', 350_000)).toMatchObject({ ok: false });
    monitor.command('gossip private text', 350_000);
    expect(monitor.violations.map(({ code }) => code)).toEqual(['unsafe-command']);
    expect(monitor.violations[0]?.message).not.toContain('private text');
    expect(JSON.stringify(monitor.events)).not.toContain('private text');
  });

  it('enforces provider usage limits', () => {
    const monitor = new LiveHarnessMonitor(limits);
    monitor.usage(3, 10, 0.01);
    monitor.usage(1, 101, 0.11);
    expect(monitor.violations.map(({ code }) => code)).toEqual(['requests', 'tokens', 'cost']);
  });

  it('deduplicates unchanged usage samples while preserving transitions', () => {
    const monitor = new LiveHarnessMonitor(limits);
    monitor.usage(1, 10, 0.01);
    monitor.usage(1, 10, 0.01);
    monitor.usage(2, 20, 0.02);
    expect(monitor.events.filter(({ kind }) => kind === 'usage').map(({ value }) => value)).toEqual(
      ['1 requests, 10 tokens, $0.01', '2 requests, 20 tokens, $0.02']
    );
  });
});
