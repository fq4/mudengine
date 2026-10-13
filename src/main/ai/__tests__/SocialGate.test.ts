import { describe, expect, it } from 'vitest';
import { SocialGate } from '../SocialGate';
describe('SocialGate', () => {
  it('paces and suppresses near-duplicate messages', () => {
    const gate = new SocialGate();
    expect(gate.allow({ channel: 'gossip', message: 'hello realm', at: 1000 })).toMatchObject({ ok: true });
    expect(gate.allow({ channel: 'gossip', message: 'hello realm!', at: 32001 })).toMatchObject({ ok: false });
  });
});
