import { describe, expect, it } from 'vitest';
import { ApprovalStore } from '../Approvals';
describe('ApprovalStore', () => {
  it('deduplicates and expires unknown-command approvals', () => {
    const store = new ApprovalStore(); const now = Date.now(); const first = store.request('mystery', 'need it', 'unknown', 'state', now); const same = store.request('mystery', 'need it', 'unknown', 'state', now + 100);
    expect(same.id).toBe(first.id); expect(store.snapshot().pending).toHaveLength(1); store.expire(now + 121001); expect(store.snapshot().history[0]?.status).toBe('expired');
  });
  it('approves one exact pending action only for the same state', () => { const store = new ApprovalStore(); const item = store.request('open vault', 'inspect', 'high', 'state'); expect(store.approve(item.id, 'changed')).toBeNull(); const next = store.request('open vault', 'inspect', 'high', 'state'); expect(store.approve(next.id, 'state')?.status).toBe('approved'); expect(store.snapshot().pending).toHaveLength(0); });
  it('limits a temporary authorization to the exact command and use count', () => {
    const store = new ApprovalStore(); const now = Date.now();
    store.grant('buy potion', 60_000, 2, now);
    expect(store.allows('buy potion', now + 1)).toBe(true);
    expect(store.allows('buy potion', now + 2)).toBe(true);
    expect(store.allows('buy potion', now + 3)).toBe(false);
    expect(store.allows('buy potion extra', now + 4)).toBe(false);
  });
  it('expires temporary authorizations without renewing them', () => {
    const store = new ApprovalStore(); const now = Date.now();
    store.grant('open vault', 100, 1, now);
    expect(store.allows('open vault', now + 101)).toBe(false);
    expect(store.snapshot().grants).toHaveLength(0);
  });
});
