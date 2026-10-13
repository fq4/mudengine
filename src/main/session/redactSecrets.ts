export const REDACTED_SECRET = '••••••••';

/** Redact configured secrets before any diagnostic, log, or capture sink. */
export function redactSecrets(value: string, secrets: readonly string[]): string {
  let result = value;
  for (const secret of secrets) {
    if (secret.length > 0) result = result.split(secret).join(REDACTED_SECRET);
  }
  return result;
}

/** Raw bytes cannot safely be decoded without knowing the negotiated encoding. */
export function redactInboundBytes(value: Buffer, secrets: readonly string[]): Buffer {
  return secrets.length > 0 ? Buffer.from('[redacted inbound bytes]', 'utf8') : value;
}
