export interface LiveHarnessLimits {
  maxRuntimeMs: number;
  maxMoves: number;
  maxRequests: number;
  maxTokens: number;
  maxCostUsd: number;
  maxRepeatedAction: number;
}

export interface LiveHarnessEvent {
  kind: 'command' | 'room' | 'usage' | 'state' | 'line';
  value: string;
  at: number;
}

export interface LiveHarnessViolation {
  code:
    | 'runtime'
    | 'moves'
    | 'requests'
    | 'tokens'
    | 'cost'
    | 'unsafe-command'
    | 'repeat'
    | 'oscillation'
    | 'stall';
  message: string;
}

const unsafe =
  /^(?:gos|say|tell|whisper|yell|buy|sell|drop|give|put|kill|attack|cast|wear|remove|wield|equip|quit|delete|destroy)\b/i;
const movement =
  /^(?:n|s|e|w|ne|nw|se|sw|u|d|north|south|east|west|northeast|northwest|southeast|southwest|up|down)\b/i;

export class LiveHarnessMonitor {
  readonly events: LiveHarnessEvent[] = [];
  readonly violations: LiveHarnessViolation[] = [];
  private startedAt = Date.now();
  private moves = 0;
  private recentActions: string[] = [];
  private recentRooms: string[] = [];

  constructor(readonly limits: LiveHarnessLimits) {}

  start(): void {
    this.startedAt = Date.now();
  }

  command(command: string): void {
    const value = command.trim().replace(/\s+/g, ' ');
    if (!value) return;
    this.events.push({ kind: 'command', value, at: Date.now() });
    if (unsafe.test(value)) this.fail('unsafe-command', `Unsafe live-test command: ${value}`);
    if (movement.test(value)) {
      this.moves += 1;
      if (this.moves > this.limits.maxMoves)
        this.fail('moves', `Movement limit reached: ${this.moves}`);
    }
  }

  room(room: string): void {
    const value = room.trim();
    if (!value) return;
    this.events.push({ kind: 'room', value, at: Date.now() });
    this.recentRooms = [...this.recentRooms, value].slice(-6);
    if (this.recentRooms.length >= 4) {
      const [a, b, c, d] = this.recentRooms.slice(-4);
      if (a === c && b === d && a !== b)
        this.fail('oscillation', `Room oscillation detected: ${a} ↔ ${b}`);
    }
  }

  action(action: string): void {
    const value = action.trim();
    if (!value) return;
    this.events.push({ kind: 'state', value: `action:${value}`, at: Date.now() });
    this.recentActions = [...this.recentActions, value].slice(-this.limits.maxRepeatedAction - 1);
    if (
      this.recentActions.length > this.limits.maxRepeatedAction &&
      this.recentActions.every((item) => item === value)
    ) {
      this.fail('repeat', `Repeated AI action detected: ${value}`);
    }
  }

  usage(requests: number, tokens: number, costUsd: number): void {
    this.events.push({
      kind: 'usage',
      value: `${requests} requests, ${tokens} tokens, $${costUsd}`,
      at: Date.now()
    });
    if (requests > this.limits.maxRequests)
      this.fail('requests', `Request limit reached: ${requests}`);
    if (tokens > this.limits.maxTokens) this.fail('tokens', `Token limit reached: ${tokens}`);
    if (costUsd > this.limits.maxCostUsd) this.fail('cost', `Cost limit reached: $${costUsd}`);
  }

  check(now = Date.now()): void {
    if (now - this.startedAt > this.limits.maxRuntimeMs)
      this.fail('runtime', 'Live-test runtime limit reached');
  }

  fail(code: LiveHarnessViolation['code'], message: string): void {
    if (!this.violations.some((item) => item.code === code && item.message === message))
      this.violations.push({ code, message });
  }

  get failed(): boolean {
    return this.violations.length > 0;
  }
  get moveCount(): number {
    return this.moves;
  }
}
