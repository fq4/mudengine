import { describe, expect, it } from 'vitest';
import { classifyCommand } from '../Permissions';

describe('AI permission layers', () => {
  it('resolves profile over server over global for exact commands', () => {
    expect(classifyCommand('rest', { global: { commands: { rest: 'ask-first' } }, server: { commands: { rest: 'autonomous' } }, profile: { commands: { rest: 'ask-first' } } }).authorization).toBe('ask-first');
    expect(classifyCommand('rest', { global: { commands: { rest: 'ask-first' } }, server: { commands: { rest: 'autonomous' } } }).authorization).toBe('autonomous');
  });

  it('never lets a specific policy weaken a prohibited command', () => {
    const result = classifyCommand('kill goblin', { profile: { commands: { 'kill goblin': 'autonomous' } } });
    expect(result.authorization).toBe('rejected');
    expect(result.risk).toBe('prohibited');
  });

  it('does not apply an exact rule to commands with different arguments', () => {
    expect(classifyCommand('inspect altar', { global: { commands: { 'inspect altar': 'autonomous' } } }).authorization).toBe('autonomous');
    expect(classifyCommand('inspect chest', { global: { commands: { 'inspect altar': 'autonomous' } } }).authorization).toBe('ask-first');
  });
});
