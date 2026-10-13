import { describe, expect, it } from 'vitest';
import { classifyCommand } from '../Permissions';

describe('AI command permissions', () => {
  it('allows known informational commands', () => expect(classifyCommand('look')).toMatchObject({ risk: 'safe', authorization: 'autonomous' }));
  it('allows routine commands within policy', () => expect(classifyCommand('go north')).toMatchObject({ risk: 'routine', authorization: 'autonomous' }));
  it('requires approval for unknown commands', () => expect(classifyCommand('mysterious verb')).toMatchObject({ risk: 'unknown', authorization: 'ask-first' }));
  it('rejects prohibited commands', () => expect(classifyCommand('kill @Player')).toMatchObject({ risk: 'prohibited', authorization: 'rejected' }));
  it('does not let command chaining authorize prohibited actions', () => expect(classifyCommand('go north; kill target')).toMatchObject({ risk: 'prohibited', authorization: 'rejected' }));
  it.each(['gos hello', 'gossip hello', '.hello', '>Alice hello', '/Alice hello', '-hello', 'tell Alice hello'])('requires social safeguards for %s', (command) => expect(classifyCommand(command).authorization).toBe('rejected'));
  it('requires short-lived approval for resource-changing commands', () => expect(classifyCommand('buy potion')).toMatchObject({ risk: 'high', authorization: 'ask-first' }));
});
