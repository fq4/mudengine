import { describe, expect, it } from 'vitest';
import { ApprovalStore } from '../Approvals';
describe('ApprovalStore', () => {
  it('deduplicates and expires unknown-command approvals', () => {
    const store = new ApprovalStore(); const now = Date.now(); const first = store.request('mystery', 'need it', 'unknown', 'state', now); const same = store.request('mystery', 'need it', 'unknown', 'state', now + 100);
    expect(same.id).toBe(first.id); expect(store.snapshot().pending).toHaveLength(1); store.expire(now + 121001); expect(store.snapshot().history[0]?.status).toBe('expired');
  });
  it('approves one exact pending action only for the same state', () => { const store = new ApprovalStore(); const item = store.request('open vault', 'inspect', 'high', 'state'); expect(store.approve(item.id, 'changed')).toBeNull(); const next = store.request('open vault', 'inspect', 'high', 'state'); expect(store.approve(next.id, 'state')?.status).toBe('approved'); expect(store.snapshot().pending).toHaveLength(0); });
});
