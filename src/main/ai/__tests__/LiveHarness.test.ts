import { describe, expect, it } from 'vitest';
import { LiveHarnessMonitor } from '../LiveHarness';

const limits = {
  maxRuntimeMs: 10_000,
  maxMoves: 1,
  maxRequests: 2,
  maxTokens: 100,
  maxCostUsd: 0.1,
  maxRepeatedAction: 2
};

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

  it('allows the server-specific st navigation alias but rejects recovery commands', () => {
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
