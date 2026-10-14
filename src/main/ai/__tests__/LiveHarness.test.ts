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
