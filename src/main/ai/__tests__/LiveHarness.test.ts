import { describe, expect, it } from 'vitest';
import {
  createRoomProbeAutomation,
  exactCombatApproval,
  isExactCombatTargetDeath,
  isExactCombatTargetDeathEvidence,
  LiveHarnessMonitor,
  navigateToWithWalker,
  requestRoomIdentity,
  readOnlyNavigationPreflight,
  roomIdentityKey,
  summarizeCombatEvidence,
  summarizeCombatState,
  waitForCombatSettlement,
  waitForRecoveryHealth
} from '../LiveHarness';
import type { AiApproval } from '../../../shared/ai';
import { DEFAULT_CONFIG } from '../../../shared/config';

const limits = {
  maxRuntimeMs: 10_000,
  maxMoves: 1,
  maxRequests: 2,
  maxTokens: 100,
  maxCostUsd: 0.1,
  maxRepeatedAction: 2
};

describe('createRoomProbeAutomation', () => {
  it('leaves automation disabled and clears every independent automation source', () => {
    const config = createRoomProbeAutomation();
    const enabledFlags: string[] = [];
    const visit = (value: unknown, path: string) => {
      if (value === null || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        const childPath = `${path}.${key}`;
        if (key === 'enabled' && child === true) enabledFlags.push(childPath);
        visit(child, childPath);
      }
    };
    visit(config, 'automation');

    expect(config.enabled).toBe(false);
    expect(config.onEnterRealm).toEqual([]);
    expect(config.onPartyChange).toBe('');
    expect(config.idle.enabled).toBe(false);
    expect(config.supplies.enabled).toBe(false);
    expect(config.rules).toEqual([]);
    expect(config.loops).toEqual([]);
    expect(config.events).toEqual([]);
    expect(enabledFlags).toEqual([]);
    expect(DEFAULT_CONFIG.automation.enabled).toBe(true);
    expect(DEFAULT_CONFIG.automation.onEnterRealm.length).toBeGreaterThan(0);
  });

  it('can enable the queue without enabling unrelated play automation', () => {
    const config = createRoomProbeAutomation(true);
    const enabledFlags: string[] = [];
    const visit = (value: unknown, path: string) => {
      if (value === null || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        const childPath = `${path}.${key}`;
        if (key === 'enabled' && child === true) enabledFlags.push(childPath);
        visit(child, childPath);
      }
    };
    visit(config, 'automation');

    expect(config.enabled).toBe(true);
    expect(enabledFlags).toEqual(['automation.enabled']);
    expect(config.health).toMatchObject({
      restBelow: 0,
      restTo: 0,
      meditateBelow: 0,
      meditateTo: 0,
      potions: [],
      useWards: false
    });
    expect(config.combat).toMatchObject({ engage: 'none', retaliate: false });
    expect(config.movement).toMatchObject({
      provideLight: false,
      bashDoors: false,
      fightOnArrival: false,
      collectKeys: false
    });
    expect(config.party.requestPartyHealth).toBe(false);
  });
});

describe('roomIdentityKey', () => {
  it('uses coordinates only when both are present and otherwise reports the room name', () => {
    expect(roomIdentityKey({ map: 1, number: 2150, name: 'Arena' })).toBe('1/2150');
    expect(roomIdentityKey({ map: null, number: null, name: 'Arena' })).toBe('Arena');
    expect(roomIdentityKey({ map: null, number: null, name: null })).toBe('');
  });
});

describe('readOnlyNavigationPreflight', () => {
  const state = {
    phase: 'in-game' as const,
    vitals: { hp: 50 },
    combat: { engaged: false, target: null, attackers: [] }
  };

  it('allows a living character with no combat or attackers', () => {
    expect(readOnlyNavigationPreflight(state)).toMatchObject({ allowed: true });
  });

  it('refuses when health is unknown or zero', () => {
    expect(
      readOnlyNavigationPreflight({ ...state, vitals: { hp: null } })
    ).toMatchObject({ allowed: false, reason: 'Current health is unknown or zero' });
    expect(
      readOnlyNavigationPreflight({ ...state, vitals: { hp: 0 } })
    ).toMatchObject({ allowed: false, reason: 'Current health is unknown or zero' });
  });

  it('refuses active combat and any listed attacker', () => {
    expect(
      readOnlyNavigationPreflight({ ...state, combat: { ...state.combat, engaged: true } })
    ).toMatchObject({ allowed: false, reason: 'Combat or hostile attention is active' });
    expect(
      readOnlyNavigationPreflight({ ...state, combat: { ...state.combat, target: 'rat' } })
    ).toMatchObject({ allowed: false, reason: 'Combat or hostile attention is active' });
    expect(
      readOnlyNavigationPreflight({
        ...state,
        combat: { ...state.combat, attackers: ['rat'] }
      })
    ).toMatchObject({ allowed: false, reason: 'Combat or hostile attention is active' });
  });

  it('refuses a session that is not in game', () => {
    expect(
      readOnlyNavigationPreflight({ ...state, phase: 'authenticating' as const })
    ).toMatchObject({ allowed: false, reason: 'Not in game' });
  });
});

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

describe('isExactCombatTargetDeath', () => {
  it('normalizes a leading article without matching a different monster', () => {
    expect(isExactCombatTargetDeath('The Lashworm', 'lashworm')).toBe(true);
    expect(isExactCombatTargetDeath('large lashworm', 'lashworm')).toBe(false);
  });

  it('does not treat an absent target or an empty death name as evidence', () => {
    expect(isExactCombatTargetDeath('lashworm', null)).toBe(false);
    expect(isExactCombatTargetDeath('', 'lashworm')).toBe(false);
    expect(isExactCombatTargetDeath('   ', '   ')).toBe(false);
  });
});

describe('isExactCombatTargetDeathEvidence', () => {
  it('matches both realm-resolved and server-fallback death group names', () => {
    expect(isExactCombatTargetDeathEvidence({ mob: 'nasty giant rat' }, 'nasty giant rat')).toBe(
      true
    );
    expect(
      isExactCombatTargetDeathEvidence({ attacker: 'nasty giant rat' }, 'nasty giant rat')
    ).toBe(true);
  });

  it('does not infer the target from an unrelated or unnamed death', () => {
    expect(isExactCombatTargetDeathEvidence({ attacker: 'cave rat' }, 'nasty giant rat')).toBe(
      false
    );
    expect(isExactCombatTargetDeathEvidence({ attacker: 'nasty giant rat' }, null)).toBe(false);
    expect(isExactCombatTargetDeathEvidence({}, 'nasty giant rat')).toBe(false);
  });
});

describe('summarizeCombatEvidence', () => {
  it('records target hit/miss identity without retaining raw text', () => {
    expect(
      summarizeCombatEvidence(
        { type: 'user-hits', groups: { target: 'large filthbug', damage: '7' } },
        'large filthbug'
      )
    ).toEqual({
      type: 'user-hits',
      target: 'large filthbug',
      targetMatch: true,
      damage: 7
    });
    expect(
      summarizeCombatEvidence(
        { type: 'user-misses', groups: { target: 'small kobold thief' } },
        'large filthbug'
      )
    ).toEqual({
      type: 'user-misses',
      target: 'small kobold thief',
      targetMatch: false
    });
  });

  it('summarizes attacker blows, combat transitions, refusals, XP, and deaths', () => {
    expect(
      summarizeCombatEvidence(
        { type: 'mob-hits', groups: { attacker: 'large filthbug', damage: '3' } },
        'large filthbug'
      )
    ).toEqual({ type: 'mob-hits', attacker: 'large filthbug', damage: 3 });
    expect(
      summarizeCombatEvidence(
        { type: 'combat-status', groups: { status: 'Off' } },
        'large filthbug'
      )
    ).toEqual({ type: 'combat-status', status: 'Off' });
    expect(
      summarizeCombatEvidence(
        { type: 'attack-ineffective', groups: { line: 'raw server message' } },
        'large filthbug'
      )
    ).toEqual({ type: 'attack-ineffective' });
    expect(
      summarizeCombatEvidence(
        { type: 'user-gain-experience', groups: { exp: '25' } },
        'large filthbug'
      )
    ).toEqual({ type: 'user-gain-experience', experience: 25 });
    expect(
      summarizeCombatEvidence(
        { type: 'mob-dies', groups: { attacker: 'large filthbug' } },
        'large filthbug'
      )
    ).toEqual({
      type: 'mob-dies',
      mob: null,
      attacker: 'large filthbug',
      candidates: null
    });
  });

  it('omits unrelated blocks and does not accept evidence without a selected target', () => {
    expect(
      summarizeCombatEvidence({ type: 'user-hits', groups: { damage: 'invalid' } }, null)
    ).toBeNull();
    expect(
      summarizeCombatEvidence({ type: 'room-name', groups: { name: 'Room' } }, 'large filthbug')
    ).toBeNull();
  });
});

describe('requestRoomIdentity', () => {
  it('does not send a location request when a room is already known', async () => {
    let requests = 0;
    const result = await requestRoomIdentity({
      roomKey: () => '1/2150',
      request: () => {
        requests += 1;
        return true;
      },
      waitFor: async () => true,
      timeoutMs: 1_000
    });

    expect(result).toEqual({ resolved: true, requestSent: false });
    expect(requests).toBe(0);
  });

  it('waits for authoritative coordinates after one accepted configured request', async () => {
    let room = '';
    let requests = 0;
    const result = await requestRoomIdentity({
      roomKey: () => room,
      request: () => {
        requests += 1;
        return true;
      },
      waitFor: async (timeoutMs) => {
        expect(timeoutMs).toBe(500);
        room = '1/2150';
        return true;
      },
      timeoutMs: 500
    });

    expect(result).toEqual({ resolved: true, requestSent: true });
    expect(requests).toBe(1);
  });

  it('does not wait or retry when the configured location request is refused', async () => {
    let waits = 0;
    const result = await requestRoomIdentity({
      roomKey: () => '',
      request: () => false,
      waitFor: async () => {
        waits += 1;
        return true;
      },
      timeoutMs: 500
    });

    expect(result).toEqual({ resolved: false, requestSent: false });
    expect(waits).toBe(0);
  });

  it('does not accept an unlocated room observation as coordinates', async () => {
    const result = await requestRoomIdentity({
      roomKey: () => 'Arena',
      request: () => true,
      waitFor: async () => true,
      timeoutMs: 500
    });

    expect(result).toEqual({ resolved: false, requestSent: true });
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

describe('summarizeCombatState', () => {
  it('captures bounded structured progress without retaining unapproved state fields', () => {
    const summary = summarizeCombatState({
      elapsedMs: 5_000,
      room: '1/2150',
      vitals: { hp: 18, hpMax: 51 },
      combat: {
        engaged: true,
        target: 'large filthbug',
        attackers: ['large filthbug', 'small kobold thief']
      },
      scheduler: {
        status: 'active',
        activity: 'combat',
        currentAction: { name: 'engage_enemy', phase: 'running' }
      }
    });

    expect(summary).toEqual({
      elapsedMs: 5_000,
      room: '1/2150',
      hp: 18,
      hpMax: 51,
      engaged: true,
      target: 'large filthbug',
      attackers: ['large filthbug', 'small kobold thief'],
      schedulerStatus: 'active',
      schedulerActivity: 'combat',
      currentAction: { name: 'engage_enemy', phase: 'running' }
    });
    expect(summary).not.toHaveProperty('raw');
    expect(summary).not.toHaveProperty('credentials');
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

  it('samples state during the bounded combat wait', async () => {
    let engaged = true;
    let polls = 0;
    const result = await waitForCombatSettlement({
      combat: () => ({ engaged, target: engaged ? 'acid slime' : null, attackers: [] }),
      vitals: () => ({ hp: 20, hpMax: 100 }),
      wait: async () => {
        engaged = false;
      },
      isStopped: () => false,
      timeoutMs: 1_000,
      onPoll: () => polls++
    });

    expect(result).toEqual({ outcome: 'ended', unresolved: false });
    expect(polls).toBe(1);
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
        hp = 75;
        engaged = false;
      },
      isStopped: () => false,
      minimumFraction: 0.7,
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

  it('allows a production status-sheet probe without exempting actual directions', () => {
    const monitor = new LiveHarnessMonitor({ ...limits, maxMoves: 0 });
    monitor.authorizeStatusProbe();
    monitor.command('st');
    expect(monitor.moveCount).toBe(0);
    expect(monitor.failed).toBe(false);

    monitor.command('south');
    expect(monitor.moveCount).toBe(1);
    expect(monitor.violations.map(({ code }) => code)).toEqual(['moves']);
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
