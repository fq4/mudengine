import { describe, expect, it } from 'vitest';
import { isPassiveRecovery, recoveryMode } from '../RecoverySafety';

describe('recovery safety classification', () => {
  it('classifies rest and meditation as passive recovery', () => {
    expect(recoveryMode('rest')).toBe('passive');
    expect(recoveryMode('meditate')).toBe('passive');
    expect(isPassiveRecovery('rest')).toBe(true);
  });
  it('classifies item and spell recovery as resource-consuming', () => {
    expect(recoveryMode('use healing potion')).toBe('resource-consuming');
    expect(recoveryMode('cast heal')).toBe('resource-consuming');
    expect(isPassiveRecovery('use potion')).toBe(false);
  });
  it('does not guess for unknown recovery verbs', () => {
    expect(recoveryMode('recover')).toBe('unknown');
  });
});
