import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AiMemoryStore } from '../MemoryStore';
describe('AiMemoryStore', () => {
  it('persists only the requested server/character scope and supports correction/removal', () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mud-ai-')); const file = path.join(dir, 'memory.json'); const first = new AiMemoryStore(file, { server: 'mud-a', character: 'hero' }); const item = first.upsert({ category: 'fact', text: 'look is informational', provenance: 'verified command response', confidence: 1, verified: true, expiresAt: null, pinned: false }); new AiMemoryStore(file, { server: 'mud-b', character: 'hero' }).upsert({ category: 'fact', text: 'different realm', provenance: 'test', confidence: .5, verified: false, expiresAt: null, pinned: false }); expect(new AiMemoryStore(file, { server: 'mud-a', character: 'hero' }).list()).toHaveLength(1); first.update(item.id, { verified: false, confidence: .4 }); expect(first.remove(item.id)).toBe(true); expect(first.list()).toHaveLength(0); });
});
