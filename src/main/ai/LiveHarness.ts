import type { AiApproval } from '../../shared/ai';
import type { Block } from '../../shared/blocks';
import type { CharacterState, Combat, Room, Vitals } from '../../shared/character';
import { DEFAULT_CONFIG, type AutomationConfig } from '../../shared/config';
import type { WalkProgress } from '../../shared/walk';
import { mobKey } from '../../shared/world';
import { combatOutcome, type CombatOutcome } from './CombatOutcome';

/** Isolate a room diagnostic session from all background automation. */
export function createRoomProbeAutomation(enableQueue = false): AutomationConfig {
  return {
    ...DEFAULT_CONFIG.automation,
    enabled: enableQueue,
    onEnterRealm: [],
    onPartyChange: '',
    idle: { ...DEFAULT_CONFIG.automation.idle, enabled: false },
    supplies: { ...DEFAULT_CONFIG.automation.supplies, enabled: false },
    party: {
      ...DEFAULT_CONFIG.automation.party,
      assistLeader: false,
      defendParty: false,
      restWithLeader: false,
      requestPartyHealth: false,
      parEverySeconds: 0,
      parAfterRound: false
    },
    health: {
      ...DEFAULT_CONFIG.automation.health,
      restBelow: 0,
      restTo: 0,
      meditateBelow: 0,
      meditateTo: 0,
      potions: [],
      useWards: false
    },
    combat: {
      ...DEFAULT_CONFIG.automation.combat,
      engage: 'none',
      retaliate: false
    },
    movement: {
      ...DEFAULT_CONFIG.automation.movement,
      provideLight: false,
      lightDimRooms: false,
      extinguishInLight: false,
      bashDoors: false,
      fightOnArrival: false,
      collectKeys: false
    },
    loops: [],
    events: [],
    rules: []
  };
}

/** Show coordinates only when both are authoritative; otherwise retain the parsed room name. */
export function roomIdentityKey(room: Pick<Room, 'map' | 'number' | 'name'>): string {
  if (room.map !== null && room.number !== null) return `${room.map}/${room.number}`;
  return room.name ?? '';
}

export function readOnlyNavigationPreflight(
  state: Pick<CharacterState, 'phase'> & {
    vitals: Pick<Vitals, 'hp'>;
    combat: Pick<Combat, 'engaged' | 'target' | 'attackers'>;
  }
): { allowed: boolean; reason: string } {
  if (state.phase !== 'in-game') return { allowed: false, reason: 'Not in game' };
  if (state.vitals.hp === null || state.vitals.hp <= 0)
    return { allowed: false, reason: 'Current health is unknown or zero' };
  if (
    state.combat.engaged ||
    state.combat.target !== null ||
    state.combat.attackers.length > 0
  ) {
    return { allowed: false, reason: 'Combat or hostile attention is active' };
  }
  return { allowed: true, reason: 'In-game, alive, and not engaged or under attack' };
}

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

export interface LiveNavigationResult {
  before: string;
  after: string;
  status: WalkProgress['status'];
  reason: string | null;
  dispatchMessage: string;
  waitCompleted: boolean | null;
  arrived: boolean;
}

export function exactCombatApproval(
  approvals: readonly AiApproval[],
  targetName: string
): AiApproval | null {
  const matches = approvals.filter(
    ({ action }) =>
      action?.name === 'engage_enemy' && action.args?.name === targetName
  );
  return matches.length === 1 ? matches[0]! : null;
}

export async function navigateToWithWalker(options: {
  destination: string;
  roomKey: () => string;
  progress: () => Pick<WalkProgress, 'status' | 'reason'>;
  dispatch: () => Promise<{ ok: boolean; message: string }>;
  waitFor: (predicate: () => boolean, timeoutMs: number) => Promise<boolean>;
  isError: () => boolean;
  timeoutMs?: number;
}): Promise<LiveNavigationResult> {
  const before = options.roomKey();
  if (before === options.destination) {
    const progress = options.progress();
    return {
      before,
      after: before,
      status: progress.status,
      reason: progress.reason,
      dispatchMessage: 'Already at destination',
      waitCompleted: true,
      arrived: true
    };
  }

  const dispatch = await options.dispatch();
  let waitCompleted: boolean | null = null;
  if (dispatch.ok) {
    waitCompleted = await options.waitFor(
      () => options.progress().status !== 'walking' || options.isError(),
      options.timeoutMs ?? 45_000
    );
  }

  const progress = options.progress();
  const after = options.roomKey();
  return {
    before,
    after,
    status: progress.status,
    reason: progress.reason,
    dispatchMessage: dispatch.message,
    waitCompleted,
    arrived: dispatch.ok && progress.status === 'arrived' && after === options.destination
  };
}

export interface CombatSettlementResult {
  outcome: CombatOutcome;
  unresolved: boolean;
}

/** Match a parsed monster-death sentence to the exact target selected for combat. */
export function isExactCombatTargetDeath(deathName: string, targetName: string | null): boolean {
  if (targetName === null) return false;
  const deathKey = mobKey(deathName);
  return deathKey.length > 0 && deathKey === mobKey(targetName);
}

/** Resolve the classifier's exact mob name across its two death-block shapes. */
export function isExactCombatTargetDeathEvidence(
  groups: { mob?: string; attacker?: string },
  targetName: string | null
): boolean {
  return isExactCombatTargetDeath(groups.mob ?? groups.attacker ?? '', targetName);
}

export function summarizeCombatEvidence(
  block: Pick<Block, 'type' | 'groups'>,
  targetName: string | null
): Record<string, string | number | boolean | null> | null {
  if (targetName === null) return null;
  const { type, groups } = block;
  switch (type) {
    case 'user-hits':
    case 'user-misses': {
      const target = groups.target ?? null;
      return {
        type,
        target,
        targetMatch: target !== null && mobKey(target) === mobKey(targetName),
        ...(type === 'user-hits' ? { damage: Number(groups.damage) || null } : {})
      };
    }
    case 'mob-hits':
    case 'mob-misses':
      return {
        type,
        attacker: groups.attacker ?? null,
        ...(type === 'mob-hits' ? { damage: Number(groups.damage) || null } : {})
      };
    case 'combat-status':
      return { type, status: groups.status ?? null };
    case 'user-gain-experience':
      return { type, experience: Number(groups.exp) || null };
    case 'mob-dies':
      return {
        type,
        mob: groups.mob ?? null,
        attacker: groups.attacker ?? null,
        candidates: groups.mobs ?? null
      };
    case 'attack-refused':
    case 'attack-ineffective':
      return { type };
    default:
      return null;
  }
}

export interface RoomIdentityRequestResult {
  resolved: boolean;
  requestSent: boolean;
}

/** Request one configured authoritative location response when entry probes leave room unknown. */
export async function requestRoomIdentity(options: {
  roomKey: () => string;
  request: () => boolean;
  waitFor: (timeoutMs: number) => Promise<boolean>;
  timeoutMs: number;
}): Promise<RoomIdentityRequestResult> {
  if (/^\d+\/\d+$/.test(options.roomKey())) return { resolved: true, requestSent: false };
  if (!options.request()) return { resolved: false, requestSent: false };
  const resolved = await options.waitFor(options.timeoutMs);
  return { resolved: resolved && /^\d+\/\d+$/.test(options.roomKey()), requestSent: true };
}

export async function waitForCombatSettlement(options: {
  combat: () => Pick<Combat, 'engaged' | 'target' | 'attackers'>;
  vitals: () => Pick<Vitals, 'hp' | 'hpMax'>;
  wait: (milliseconds: number) => Promise<void>;
  isStopped: () => boolean;
  timeoutMs: number;
  pollIntervalMs?: number;
}): Promise<CombatSettlementResult> {
  const stillFighting = () => {
    const combat = options.combat();
    return combat.engaged || combat.target !== null;
  };
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  const deadline = Date.now() + options.timeoutMs;
  while (
    stillFighting() &&
    options.vitals().hp !== 0 &&
    Date.now() < deadline &&
    !options.isStopped()
  ) {
    await options.wait(pollIntervalMs);
  }
  const combat = options.combat();
  const unresolved =
    stillFighting() ||
    combat.attackers.length > 0 ||
    options.vitals().hp === 0 ||
    options.isStopped();
  return { outcome: combatOutcome(combat, options.vitals()), unresolved };
}

export async function waitForRecoveryHealth(options: {
  vitals: () => Pick<Vitals, 'hp' | 'hpMax'>;
  combatActive: () => boolean;
  wait: (milliseconds: number) => Promise<void>;
  isStopped: () => boolean;
  minimumFraction: number;
  timeoutMs: number;
  pollIntervalMs?: number;
}): Promise<boolean> {
  const ready = () => {
    const { hp, hpMax } = options.vitals();
    return (
      hp !== null &&
      hpMax !== null &&
      hpMax > 0 &&
      hp / hpMax >= options.minimumFraction &&
      !options.combatActive()
    );
  };
  const deadline = Date.now() + options.timeoutMs;
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  while (!ready() && Date.now() < deadline && !options.isStopped())
    await options.wait(pollIntervalMs);
  return ready();
}

const unsafe =
  /^(?:[.>/-]|gos|gossip|say|tell|whisper|yell|shout|broadcast|emote|pose|ooc|channel|reply|osay|buy|sell|drop|give|put|kill|attack|cast|wear|remove|wield|equip|quit|delete|destroy|stand|rest)\b/i;
const movement =
  /^(?:n|s|e|w|ne|nw|se|sw|u|d|st|north|south|east|west|northeast|northwest|southeast|southwest|up|down)\b/i;

export class LiveHarnessMonitor {
  readonly events: LiveHarnessEvent[] = [];
  readonly violations: LiveHarnessViolation[] = [];
  private startedAt = Date.now();
  private moves = 0;
  private recentActions: string[] = [];
  private recentRooms: string[] = [];
  private lastUsage: string | null = null;
  private gossipRepliesAuthorized = false;
  private gossipInboundCount = 0;
  private gossipReplyCount = 0;
  private pendingGossipReplies: number[] = [];
  private lastGossipReplyAt = 0;
  private publicCommandRefusals = 0;
  private readonly authorizedCombatTargets = new Set<string>();
  private recoveryAuthorized = false;
  private equipmentAuthorized = false;
  private statusProbeAuthorized = false;

  constructor(readonly limits: LiveHarnessLimits) {}

  start(): void {
    this.startedAt = Date.now();
  }

  authorizeCombatTarget(name: string): void {
    const value = name.trim().toLowerCase();
    if (value) this.authorizedCombatTargets.add(value);
  }

  authorizeRecovery(): void {
    this.recoveryAuthorized = true;
  }

  authorizeEquipmentChanges(): void {
    this.equipmentAuthorized = true;
  }

  authorizeStatusProbe(): void {
    this.statusProbeAuthorized = true;
  }

  authorizeGossipReplies(): void {
    this.gossipRepliesAuthorized = true;
  }

  incomingGossip(
    speaker: string,
    message: string,
    characterName: string,
    at = Date.now()
  ): void {
    const normalizedSpeaker = speaker.trim().toLowerCase();
    const normalizedCharacter = characterName.trim().toLowerCase();
    if (
      !this.gossipRepliesAuthorized ||
      !normalizedSpeaker ||
      !message.trim() ||
      normalizedSpeaker === 'you' ||
      normalizedSpeaker === normalizedCharacter ||
      this.gossipReplyCount + this.pendingGossipReplies.length >= 5
    )
      return;
    this.gossipInboundCount += 1;
    this.pendingGossipReplies.push(at);
    this.events.push({ kind: 'state', value: 'incoming-gossip', at });
  }

  gossipReplyEligibility(
    message: string,
    at = Date.now()
  ): { ok: true } | { ok: false; reason: string } {
    this.pendingGossipReplies = this.pendingGossipReplies.filter(
      (receivedAt) => at - receivedAt <= 90_000
    );
    if (!this.gossipRepliesAuthorized)
      return { ok: false, reason: 'Gossip replies are not authorized for this harness run' };
    if (this.gossipReplyCount >= 5)
      return { ok: false, reason: 'The bounded gossip-reply limit has been reached' };
    if (this.pendingGossipReplies.length === 0)
      return { ok: false, reason: 'A recent inbound gossip message is required before replying' };
    if (this.lastGossipReplyAt !== 0 && at - this.lastGossipReplyAt < 30_000)
      return { ok: false, reason: 'Gossip replies require a 30-second interval' };
    if (!message.trim() || message.length > 240 || /[\r\n\x00]/.test(message))
      return { ok: false, reason: 'Gossip reply must be a single non-empty line of at most 240 characters' };
    return { ok: true };
  }

  command(command: string, at = Date.now()): void {
    const value = command.trim().replace(/\s+/g, ' ');
    if (!value) return;
    const publicMessage = /^(?:[.>/-]|gos|gossip|say|tell|whisper|yell|shout|broadcast|emote|pose|ooc|channel|reply|osay)\b/i.test(
      value
    );
    this.events.push({
      kind: 'command',
      value: publicMessage ? `${value.split(/\s/, 1)[0]} <redacted>` : value,
      at
    });
    const gossipReply = /^gos\s+(.+)$/i.exec(value);
    if (gossipReply) {
      const eligibility = this.gossipReplyEligibility(gossipReply[1] ?? '', at);
      if (!eligibility.ok) {
        this.fail('unsafe-command', `Public gossip reply refused: ${eligibility.reason}`);
        return;
      }
      this.pendingGossipReplies.shift();
      this.gossipReplyCount += 1;
      this.lastGossipReplyAt = at;
      return;
    }
    const combatCommand = /^(?:kill|attack|hit|strike)\s+(.+)$/i.exec(value);
    const authorizedCombat =
      combatCommand !== null &&
      this.authorizedCombatTargets.has(combatCommand[1]?.trim().toLowerCase() ?? '');
    const authorizedRecovery = this.recoveryAuthorized && /^rest$/i.test(value);
    const authorizedEquipment =
      this.equipmentAuthorized && /^(?:wear|remove|wield|equip)\b/i.test(value);
    if (unsafe.test(value) && !authorizedCombat && !authorizedRecovery && !authorizedEquipment)
      this.fail(
        'unsafe-command',
        publicMessage
          ? `Public communication command refused by the live-test monitor (${
              ++this.publicCommandRefusals
            })`
          : `Unsafe live-test command: ${value}`
      );
    if (movement.test(value) && !(this.statusProbeAuthorized && value.toLowerCase() === 'st')) {
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
    const value = `${requests} requests, ${tokens} tokens, $${costUsd}`;
    if (value === this.lastUsage) {
      if (requests > this.limits.maxRequests)
        this.fail('requests', `Request limit reached: ${requests}`);
      if (tokens > this.limits.maxTokens) this.fail('tokens', `Token limit reached: ${tokens}`);
      if (costUsd > this.limits.maxCostUsd) this.fail('cost', `Cost limit reached: $${costUsd}`);
      return;
    }
    this.lastUsage = value;
    this.events.push({
      kind: 'usage',
      value,
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
  get elapsedRuntimeMs(): number {
    return Date.now() - this.startedAt;
  }
  get gossipInboundMessages(): number {
    return this.gossipInboundCount;
  }
  get gossipRepliesSent(): number {
    return this.gossipReplyCount;
  }
}
