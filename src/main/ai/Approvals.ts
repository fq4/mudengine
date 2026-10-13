import type { AiApproval } from '../../shared/ai';

export class ApprovalStore {
  private pending: AiApproval[] = [];
  private history: AiApproval[] = [];
  request(command: string, reason: string, risk: 'high' | 'unknown', contextHash: string, now = Date.now()): AiApproval {
    const existing = this.pending.find((item) => item.command === command && item.reason === reason && item.expiresAt > now);
    if (existing) return existing;
    const approval: AiApproval = { id: `${now}-${this.pending.length}`, command, reason, risk, contextHash, createdAt: now, expiresAt: now + (risk === 'high' ? 60_000 : 120_000), status: 'pending' };
    this.pending.push(approval); return approval;
  }
  expire(now = Date.now()): void { for (const item of this.pending) if (item.expiresAt <= now) this.finish(item, 'expired'); }
  approve(id: string, contextHash: string): AiApproval | null { const item = this.pending.find((candidate) => candidate.id === id); if (!item || item.expiresAt <= Date.now()) { if (item) this.finish(item, 'expired'); return null; } if (item.contextHash !== contextHash) { this.finish(item, 'expired'); return null; } this.finish(item, 'approved'); return item; }
  reject(id: string): AiApproval | null { const item = this.pending.find((candidate) => candidate.id === id); if (!item) return null; this.finish(item, 'rejected'); return item; }
  snapshot(): { pending: AiApproval[]; history: AiApproval[] } { this.expire(); return { pending: [...this.pending], history: this.history.slice(-100) }; }
  private finish(item: AiApproval, status: AiApproval['status']): void { item.status = status; this.pending = this.pending.filter((candidate) => candidate.id !== item.id); this.history.push({ ...item }); }
}
