import { describe, expect, it } from 'vitest';
import { ApprovalStore } from '../Approvals';
describe('ApprovalStore', () => {
  it('deduplicates and expires unknown-command approvals', () => {
    const store = new ApprovalStore(); const now = Date.now(); const first = store.request('mystery', 'need it', 'unknown', 'state', now); const same = store.request('mystery', 'need it', 'unknown', 'state', now + 100);
    expect(same.id).toBe(first.id); expect(store.snapshot().pending).toHaveLength(1); store.expire(now + 121001); expect(store.snapshot().history[0]?.status).toBe('expired');
  });
  it('approves one exact pending action only for the same state', () => { const store = new ApprovalStore(); const item = store.request('open vault', 'inspect', 'high', 'state'); expect(store.approve(item.id, 'changed')).toBeNull(); const next = store.request('open vault', 'inspect', 'high', 'state'); expect(store.approve(next.id, 'state')?.status).toBe('approved'); expect(store.snapshot().pending).toHaveLength(0); });
  it('records execution separately after an approved action is accepted', () => { const store = new ApprovalStore(); const item = store.request('open vault', 'inspect', 'high', 'state'); store.approve(item.id, 'state'); expect(store.markExecuted(item.id)).toBe(true); expect(store.snapshot().history.at(-1)?.status).toBe('executed'); });
  it('limits a temporary authorization to the exact command and use count', () => {
    const store = new ApprovalStore(); const now = Date.now();
    store.grant('buy potion', 'state-a', 60_000, 2, now);
    expect(store.allows('buy potion', 'state-a', now + 1)).toBe(true);
    expect(store.allows('buy potion', 'state-a', now + 2)).toBe(true);
    expect(store.allows('buy potion', 'state-a', now + 3)).toBe(false);
    expect(store.allows('buy potion extra', 'state-a', now + 4)).toBe(false);
    expect(store.allows('buy potion', 'state-b', now + 4)).toBe(false);
  });
  it('expires temporary authorizations without renewing them', () => {
    const store = new ApprovalStore(); const now = Date.now();
    store.grant('open vault', 'state', 100, 1, now);
    expect(store.allows('open vault', 'state', now + 101)).toBe(false);
    expect(store.snapshot().grants).toHaveLength(0);
  });
  it('revokes a temporary authorization immediately', () => {
    const store = new ApprovalStore(); const grant = store.grant('open vault', 'state', 60_000, null);
    expect(store.revokeGrant(grant.id)).toBe(true);
    expect(store.allows('open vault', 'state')).toBe(false);
    expect(store.snapshot().grants).toHaveLength(0);
  });
  it('invalidates pending approvals and grants when a session resets', () => {
    const store = new ApprovalStore();
    const approval = store.request('unknown action', 'test', 'unknown', 'state');
    const grant = store.grant('open vault', 'state', 60_000, null);
    store.resetTransient();
    expect(store.snapshot().pending).toHaveLength(0);
    expect(store.snapshot().grants).toHaveLength(0);
    expect(store.snapshot().history.find((item) => item.id === approval.id)?.status).toBe('expired');
    expect(grant.status).toBe('revoked');
  });
});
