import { describe, expect, it } from 'vitest';
import { SessionDebug } from '../SessionDebug';

describe('session diagnostics redaction', () => {
  it('never emits synthetic credentials in diagnostic text or details', () => {
    const secret = 'synthetic-debug-secret';
    const records: Array<{ text: string; detail?: string }> = [];
    const debug = new SessionDebug((record) => records.push(record), [secret]);
    debug.notice(`login answer ${secret}`);
    debug.text(`server echoed ${secret}`);
    expect(JSON.stringify(records)).not.toContain(secret);
    expect(JSON.stringify(records)).toContain('••••••••');
  });
});
