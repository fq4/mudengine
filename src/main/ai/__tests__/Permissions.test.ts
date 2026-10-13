import { describe, expect, it } from 'vitest';
import { classifyCommand } from '../Permissions';

describe('AI command permissions', () => {
  it('allows known informational commands', () => expect(classifyCommand('look')).toMatchObject({ risk: 'safe', authorization: 'autonomous' }));
  it('allows routine commands within policy', () => expect(classifyCommand('go north')).toMatchObject({ risk: 'routine', authorization: 'autonomous' }));
  it('requires approval for unknown commands', () => expect(classifyCommand('mysterious verb')).toMatchObject({ risk: 'unknown', authorization: 'ask-first' }));
  it('rejects prohibited commands', () => expect(classifyCommand('kill @Player')).toMatchObject({ risk: 'prohibited', authorization: 'rejected' }));
  it('does not let command chaining inherit a routine prefix', () => expect(classifyCommand('go north; kill target')).toMatchObject({ risk: 'unknown', authorization: 'ask-first' }));
});
