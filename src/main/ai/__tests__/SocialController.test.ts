import { describe, expect, it } from 'vitest';
import { SocialController } from '../SocialController';

describe('SocialController', () => {
  it('paces unsolicited messages and releases on a matching reply', () => {
    const social = new SocialController();
    expect(social.beforeSend({ channel: 'gossip', message: 'hello', at: 1000 }).ok).toBe(true);
    expect(social.beforeSend({ channel: 'gossip', message: 'hello again', at: 32001 }).ok).toBe(false);
    expect(social.observeIncoming('gossip', 'Rin', 33000)).toBe(true);
    expect(social.beforeSend({ channel: 'gossip', message: 'a thoughtful reply', at: 64001 }).ok).toBe(true);
  });
  it('rejects near duplicates', () => {
    const social = new SocialController();
    expect(social.beforeSend({ channel: 'local', message: 'hello there friend', at: 1000 }).ok).toBe(true);
    expect(social.beforeSend({ channel: 'local', message: 'hello there friend!', at: 40000 }).ok).toBe(false);
  });
});
