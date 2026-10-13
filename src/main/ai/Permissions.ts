export type AiRisk = 'safe' | 'routine' | 'high' | 'unknown' | 'prohibited';
export type AiAuthorization = 'autonomous' | 'ask-first' | 'rejected';
export interface CommandClassification { risk: AiRisk; authorization: AiAuthorization; reason: string; }
export interface AiPermissionRules { commands?: Record<string, AiAuthorization>; }
export interface AiPermissionLayers { global?: AiPermissionRules; server?: AiPermissionRules; profile?: AiPermissionRules; }

const SAFE = /^(look|l|score|sc|inventory|i|who|status|health|pro|exits|x)$/i;
const PROHIBITED = /^(kill|attack|hit|pk|pvp|suicide|delete|drop\s+all|quit|logout|password|passwd)\b/i;
const HIGH_RISK = /^(buy|purchase|withdraw|transfer|give|sell|sacrifice)\b/i;
const ROUTINE = /^(go|north|south|east|west|up|down|n|s|e|w|u|d|rest|med|wear|remove|get|take|open|close|search|examine|exa)\b/i;

export function classifyCommand(command: string, layers?: AiPermissionLayers): CommandClassification {
  const value = command.trim();
  const classification = classifyDefault(value);
  if (classification.authorization === 'rejected') return classification;
  const rule = [layers?.profile, layers?.server, layers?.global]
    .map((layer) => layer?.commands?.[value.toLowerCase()])
    .find((authorization): authorization is AiAuthorization => authorization !== undefined);
  if (!rule) return classification;
  if (classification.risk === 'prohibited') return classification;
  if (rule === 'rejected') return { risk: 'prohibited', authorization: 'rejected', reason: 'Rejected by the effective AI permission policy' };
  return { ...classification, authorization: rule, reason: `${rule === 'autonomous' ? 'Allowed autonomously' : 'Requires approval'} by the effective AI permission policy` };
}

function classifyDefault(value: string): CommandClassification {
  if (!value) return { risk: 'unknown', authorization: 'rejected', reason: 'Empty command' };
  if (/[;&|`\r\n]/.test(value)) return { risk: 'prohibited', authorization: 'rejected', reason: 'Compound commands must be submitted as individually validated actions' };
  if (/^[.>\/\-]/.test(value) || /^(gos\w*|say|tell|telepath|broadcast|talk|yell|shout)\b/i.test(value)) return { risk: 'prohibited', authorization: 'rejected', reason: 'Use send_message so communication pacing and duplicate safeguards apply' };
  if (PROHIBITED.test(value)) return { risk: 'prohibited', authorization: 'rejected', reason: 'Command is prohibited by the default safety policy' };
  if (SAFE.test(value)) return { risk: 'safe', authorization: 'autonomous', reason: 'Known informational command' };
  if (HIGH_RISK.test(value)) return { risk: 'high', authorization: 'ask-first', reason: 'Command can spend, transfer, or permanently alter game resources' };
  if (ROUTINE.test(value)) return { risk: 'routine', authorization: 'autonomous', reason: 'Known routine gameplay command' };
  return { risk: 'unknown', authorization: 'ask-first', reason: 'Command is not verified by the current command evidence' };
}
