export type SocialChannel = 'local' | 'gossip' | 'tell' | 'telepath' | 'broadcast';
export interface SocialSend { channel: SocialChannel; target?: string; message: string; at?: number; }
export interface SocialDecision { ok: boolean; message: string; }
const MIN_INTERVAL_MS = 30_000;
const MAX_PENDING_MS = 5 * 60_000;
const words = (text: string): Set<string> => new Set(text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean));
const similarity = (a: string, b: string): number => { const left = words(a); const right = words(b); if (!left.size || !right.size) return 0; let common = 0; for (const word of left) if (right.has(word)) common++; return common / Math.max(left.size, right.size); };
export class SocialController {
  private lastSentAt = 0; private lastMessage = ''; private pending: { channel: SocialChannel; target: string; at: number } | null = null;
  beforeSend(send: SocialSend): SocialDecision { const now = send.at ?? Date.now(); if (this.lastSentAt !== 0 && now - this.lastSentAt < MIN_INTERVAL_MS) return { ok: false, message: 'Social pacing: wait before sending another unsolicited message' }; if (this.lastMessage && similarity(this.lastMessage, send.message) >= 0.75) return { ok: false, message: 'Social pacing: duplicate or near-duplicate message refused' }; if (this.pending && now - this.pending.at < MAX_PENDING_MS) return { ok: false, message: 'Conversation pacing: waiting for a meaningful reply or timeout' }; this.lastSentAt = now; this.lastMessage = send.message; this.pending = { channel: send.channel, target: (send.target ?? '').toLowerCase(), at: now }; return { ok: true, message: 'accepted' }; }
  observeIncoming(channel: SocialChannel, sender: string, at = Date.now()): boolean { if (!this.pending || at - this.pending.at >= MAX_PENDING_MS) { this.pending = null; return false; } const relevant = this.pending.channel === channel && (!this.pending.target || this.pending.target === sender.toLowerCase()); if (relevant) this.pending = null; return relevant; }
  isWaiting(): boolean { return this.pending !== null && Date.now() - this.pending.at < MAX_PENDING_MS; }
}
