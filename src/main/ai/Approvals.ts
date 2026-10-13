import type { AiApproval, AiTemporaryGrant } from '../../shared/ai';

export class ApprovalStore {
  private pending: AiApproval[] = [];
  private history: AiApproval[] = [];
  private grants: AiTemporaryGrant[] = [];
  request(command: string, reason: string, risk: 'high' | 'unknown', contextHash: string, now = Date.now()): AiApproval {
    const existing = this.pending.find((item) => item.command === command && item.reason === reason && item.expiresAt > now);
    if (existing) return existing;
    const approval: AiApproval = { id: `${now}-${this.pending.length}`, command, reason, risk, contextHash, createdAt: now, expiresAt: now + (risk === 'high' ? 60_000 : 120_000), status: 'pending' };
    this.pending.push(approval); return approval;
  }
  expire(now = Date.now()): void { this.expireAll(now); }
  approve(id: string, contextHash: string): AiApproval | null { const item = this.pending.find((candidate) => candidate.id === id); if (!item || item.expiresAt <= Date.now()) { if (item) this.finish(item, 'expired'); return null; } if (item.contextHash !== contextHash) { this.finish(item, 'expired'); return null; } this.finish(item, 'approved'); return item; }
  reject(id: string): AiApproval | null { const item = this.pending.find((candidate) => candidate.id === id); if (!item) return null; this.finish(item, 'rejected'); return item; }
  markExecuted(id: string): boolean {
    const item = this.history.find((candidate) => candidate.id === id && candidate.status === 'approved');
    if (!item) return false;
    item.status = 'executed';
    return true;
  }
  grant(command: string, contextHash: string, durationMs: number, maxUses: number | null = 1, now = Date.now()): AiTemporaryGrant {
    this.expireAll(now);
    const existing = this.grants.find((item) => item.command === command && item.contextHash === contextHash && item.status === 'active' && item.expiresAt > now);
    if (existing) return existing;
    const grant: AiTemporaryGrant = { id: `grant-${now}-${this.grants.length}`, command, contextHash, createdAt: now, expiresAt: now + Math.max(1, durationMs), remainingUses: maxUses === null ? null : Math.max(1, maxUses), status: 'active' };
    this.grants.push(grant);
    return grant;
  }
  allows(command: string, contextHash: string, now = Date.now()): boolean {
    this.expireAll(now);
    const grant = this.grants.find((item) => item.command === command && item.contextHash === contextHash && item.status === 'active' && item.expiresAt > now && (item.remainingUses === null || item.remainingUses > 0));
    if (!grant) return false;
    if (grant.remainingUses !== null) { grant.remainingUses -= 1; if (grant.remainingUses === 0) grant.status = 'exhausted'; }
    return true;
  }
  revokeGrant(id: string): boolean { const grant = this.grants.find((item) => item.id === id && item.status === 'active'); if (!grant) return false; grant.status = 'revoked'; return true; }
  resetTransient(): void { const now = Date.now(); for (const item of [...this.pending]) this.finish(item, 'expired'); for (const grant of this.grants) if (grant.status === 'active') grant.status = grant.expiresAt <= now ? 'expired' : 'revoked'; }
  snapshot(): { pending: AiApproval[]; history: AiApproval[]; grants: AiTemporaryGrant[] } { this.expireAll(Date.now()); return { pending: [...this.pending], history: this.history.slice(-100), grants: this.grants.filter((item) => item.status === 'active') }; }
  private expireAll(now: number): void { for (const grant of this.grants) if (grant.status === 'active' && grant.expiresAt <= now) grant.status = 'expired'; for (const item of this.pending) if (item.expiresAt <= now) this.finish(item, 'expired'); }
  private finish(item: AiApproval, status: AiApproval['status']): void { item.status = status; this.pending = this.pending.filter((candidate) => candidate.id !== item.id); this.history.push({ ...item }); }
}
