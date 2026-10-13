export type AiSocialChannel = 'local' | 'gossip' | 'tell' | 'telepath' | 'broadcast';
export interface SocialAttempt { channel: AiSocialChannel; target?: string; message: string; at?: number; }
export class SocialGate {
  private lastAt = 0;
  private lastMessage = '';
  allow(attempt: SocialAttempt): { ok: true } | { ok: false; reason: string } {
    const now = attempt.at ?? Date.now();
    if (this.lastAt !== 0 && now - this.lastAt < 30_000) return { ok: false, reason: 'Social pacing requires a 30-second interval' };
    if (this.lastMessage && this.similar(this.lastMessage, attempt.message)) return { ok: false, reason: 'Duplicate or near-duplicate social message refused' };
    this.lastAt = now; this.lastMessage = attempt.message;
    return { ok: true };
  }
  private similar(left: string, right: string): boolean {
    const a = new Set(left.toLowerCase().split(/\W+/).filter(Boolean));
    const b = new Set(right.toLowerCase().split(/\W+/).filter(Boolean));
    if (a.size === 0 || b.size === 0) return false;
    let common = 0; for (const word of a) if (b.has(word)) common++;
    return common / Math.max(a.size, b.size) >= 0.75;
  }
}
