import { describe, expect, it } from 'vitest';
import { objectiveNavigationDestination, resolveAiNavigationTarget } from '../navigation';

describe('AI navigation destination resolution', () => {
  it('preserves an exact objective address over a model-selected exit', () => {
    expect(objectiveNavigationDestination('Navigate to 1/2142, then stop', 'south')).toBe('1/2142');
    expect(objectiveNavigationDestination('Explore an available exit', 'south')).toBe('south');
  });
  const exits = [{ direction: 'north', targetMap: 1, targetRoom: 2 }];

  it('resolves an exact room address and a decorated room address', () => {
    expect(resolveAiNavigationTarget('1/2', exits)).toBe('1/2');
    expect(resolveAiNavigationTarget('room 1/2', exits)).toBe('1/2');
  });

  it('resolves an available exit from authoritative target data', () => {
    expect(resolveAiNavigationTarget('north', exits)).toBe('1/2');
  });

  it('rejects unresolved exits while preserving explicit addresses for graph validation', () => {
    expect(resolveAiNavigationTarget('99/99', [])).toBe('99/99');
    expect(resolveAiNavigationTarget('east', exits)).toBeNull();
  });
});
