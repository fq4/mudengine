export type AiRisk = 'safe' | 'routine' | 'high' | 'unknown' | 'prohibited';
export type AiAuthorization = 'autonomous' | 'ask-first' | 'rejected';
export interface CommandClassification { risk: AiRisk; authorization: AiAuthorization; reason: string; }

const SAFE = /^(look|l|score|sc|inventory|i|who|status|health|pro|exits|x)$/i;
const PROHIBITED = /^(kill|attack|hit|pk|pvp|suicide|delete|drop\s+all|quit|logout|password|passwd)\b/i;
const ROUTINE = /^(go|north|south|east|west|up|down|n|s|e|w|u|d|rest|med|wear|remove|get|take|open|close|search|examine|exa)\b/i;

export function classifyCommand(command: string): CommandClassification {
  const value = command.trim();
  if (!value) return { risk: 'unknown', authorization: 'rejected', reason: 'Empty command' };
  if (PROHIBITED.test(value)) return { risk: 'prohibited', authorization: 'rejected', reason: 'Command is prohibited by the default safety policy' };
  if (SAFE.test(value)) return { risk: 'safe', authorization: 'autonomous', reason: 'Known informational command' };
  if (ROUTINE.test(value)) return { risk: 'routine', authorization: 'autonomous', reason: 'Known routine gameplay command' };
  return { risk: 'unknown', authorization: 'ask-first', reason: 'Command is not verified by the current command evidence' };
}
