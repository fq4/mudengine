import fs from 'node:fs';
import path from 'node:path';
import type { AiMemoryRecord } from '../../shared/ai';
export type { AiMemoryRecord } from '../../shared/ai';
export class AiMemoryStore {
  private records: AiMemoryRecord[];
  constructor(private readonly file: string, private readonly scope: { server: string; character: string }) { this.records = this.read().filter((item) => item.server === scope.server && item.character === scope.character); }
  list(now = Date.now()): AiMemoryRecord[] { this.records = this.records.filter((item) => item.pinned || item.expiresAt === null || item.expiresAt > now); return this.records.map((item) => ({ ...item })); }
  relevant(query: string, limit = 12, now = Date.now()): AiMemoryRecord[] {
    const terms = new Set(query.toLowerCase().split(/\W+/).filter((term) => term.length > 2));
    return this.list(now).map((item) => {
      const haystack = `${item.category} ${item.text} ${item.provenance}`.toLowerCase();
      const matches = [...terms].filter((term) => haystack.includes(term)).length;
      const ageDays = Math.max(0, now - item.updatedAt) / 86_400_000;
      const recency = 1 / (1 + ageDays);
      const score = matches * 10 + (item.verified ? 3 : 0) + item.confidence * 2 + recency + (item.pinned ? 1 : 0);
      return { item, score };
    }).sort((a, b) => b.score - a.score || b.item.updatedAt - a.item.updatedAt).slice(0, Math.max(0, limit)).map(({ item }) => item);
  }
  upsert(input: Omit<AiMemoryRecord, 'id' | 'server' | 'character' | 'createdAt' | 'updatedAt'>): AiMemoryRecord { const now = Date.now(); const existing = this.records.find((item) => item.text === input.text && item.category === input.category); const item = existing ? { ...existing, ...input, updatedAt: now } : { ...input, id: `${now}-${this.records.length}`, server: this.scope.server, character: this.scope.character, createdAt: now, updatedAt: now }; if (existing) this.records = this.records.map((candidate) => candidate.id === existing.id ? item : candidate); else this.records.push(item); this.write(); return { ...item }; }
  update(id: string, patch: Partial<Pick<AiMemoryRecord, 'text' | 'confidence' | 'verified' | 'expiresAt' | 'pinned'>>): boolean { const item = this.records.find((candidate) => candidate.id === id); if (!item) return false; Object.assign(item, patch, { updatedAt: Date.now() }); this.write(); return true; }
  remove(id: string): boolean { const before = this.records.length; this.records = this.records.filter((item) => item.id !== id); if (before !== this.records.length) this.write(); return before !== this.records.length; }
  clear(category?: AiMemoryRecord['category']): void { this.records = category ? this.records.filter((item) => item.category !== category) : []; this.write(); }
  private read(): AiMemoryRecord[] { try { const value = JSON.parse(fs.readFileSync(this.file, 'utf8')) as unknown; return Array.isArray(value) ? value as AiMemoryRecord[] : []; } catch { return []; } }
  private write(): void { fs.mkdirSync(path.dirname(this.file), { recursive: true }); const all = this.read().filter((item) => item.server !== this.scope.server || item.character !== this.scope.character); fs.writeFileSync(this.file, JSON.stringify([...all, ...this.records], null, 2), 'utf8'); }
}
