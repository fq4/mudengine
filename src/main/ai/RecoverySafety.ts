export type RecoveryMode = 'passive' | 'resource-consuming' | 'unknown';

/** Classify recovery intent before it can reach CommandQueue. */
export function recoveryMode(command: string): RecoveryMode {
  const verb = command.trim().toLowerCase().split(/\s+/, 1)[0] ?? '';
  if (verb === 'rest' || verb === 'med' || verb === 'meditate') return 'passive';
  if (/^(?:use|quaff|drink|eat|apply|cast)$/.test(verb)) return 'resource-consuming';
  return 'unknown';
}

export function isPassiveRecovery(command: string): boolean {
  return recoveryMode(command) === 'passive';
}
