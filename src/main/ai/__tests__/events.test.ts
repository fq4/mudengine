import { describe, expect, it } from 'vitest';
import { isMeaningfulAiEvent } from '../events';

describe('AI event relevance', () => {
  it('wakes on strategic state changes', () => {
    expect(isMeaningfulAiEvent('room-exits')).toBe(true);
    expect(isMeaningfulAiEvent('direction-failed')).toBe(true);
    expect(isMeaningfulAiEvent('conversation-gossip:reply')).toBe(true);
  });

  it('ignores routine parser churn', () => {
    expect(isMeaningfulAiEvent('line')).toBe(false);
    expect(isMeaningfulAiEvent('prompt')).toBe(false);
    expect(isMeaningfulAiEvent('combat-round')).toBe(false);
  });
});
