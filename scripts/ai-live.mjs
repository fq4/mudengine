/**
 * Explicit, bounded live verification of the production AI execution path.
 *
 * This file deliberately does nothing unless --live is supplied:
 *   npm run test:ai-live -- --live --profile kefka
 * The room-only diagnostic stops before provider or gameplay activity:
 *   node --import ./scripts/lib/register.mjs scripts/ai-live.mjs --live --profile kefka --room-probe-only
 * The navigation-only diagnostic uses Walker without provider activity:
 *   node --import ./scripts/lib/register.mjs scripts/ai-live.mjs --live --profile kefka --navigation-probe-only --max-ms 60000 --max-moves 4
 * The bounded combat diagnostic uses one exact hostile target without a provider:
 *   node --import ./scripts/lib/register.mjs scripts/ai-live.mjs --live --profile kefka --pve-probe-only --max-ms 60000 --max-moves 0
 * A known room and target can be requested; both are checked against live Walker/realm evidence:
 *   node --import ./scripts/lib/register.mjs scripts/ai-live.mjs --live --profile kefka --pve-probe-only --destination 1/2150 --target "big carrion beast" --max-ms 100000 --post-timeout-observe-ms 30000 --max-moves 4
 * The recovery diagnostic permits only a guarded rest in an empty room:
 *   node --import ./scripts/lib/register.mjs scripts/ai-live.mjs --live --profile kefka --recovery-probe-only --max-ms 60000 --max-moves 0
 *
 * The runner never prints credentials or raw login traffic, and exits as soon
 * as a safety limit is reached.
 */
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { SessionManager } from '../src/main/session/SessionManager.ts';
import { RealmLibrary } from '../src/main/world/RealmLibrary.ts';
import {
  exactCombatApproval,
  isExactCombatTargetDeathEvidence,
  LiveHarnessMonitor,
  navigateToWithWalker,
  requestRoomIdentity,
  canSkipNavigationPreflightAtDestination,
  createEscapeProbeAutomation,
  createRecoveryProbeAutomation,
  createRoomProbeAutomation,
  readOnlyNavigationPreflight,
  roomIdentityKey,
  summarizeCombatFightRecord,
  summarizeCombatEvidence,
  summarizeCombatOccupants,
  summarizeCombatState,
  shouldObserveForVerifiedAttacker,
  waitForCombatSettlement,
  waitForRecoveryHealth
} from '../src/main/ai/LiveHarness.ts';
import { homePaths } from './lib/home.mjs';
import fs from 'node:fs';
import YAML from 'yaml';
import { resolveProfile } from '../src/shared/profiles.ts';
import { mobKey, roomId } from '../src/shared/world.ts';
import {
  assessCombatEligibility,
  hasMappedCombatEscape
} from '../src/main/ai/CombatSafety.ts';
import {
  findSafeCombatNpc,
  findSafeNpc,
  summarizeCombatCandidates
} from '../src/main/ai/NpcDiscovery.ts';

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i < 0 ? undefined : args[i + 1];
};
if (!has('--live')) {
  console.error('AI live test is opt-in; rerun with --live');
  process.exitCode = 2;
  process.exit();
}

const profileId = valueOf('--profile') ?? 'kefka';
if (profileId !== 'kefka')
  throw new Error('The live harness is restricted to the authorized kefka profile');
const navigationProbeOnly = has('--navigation-probe-only');
const pveProbeOnly = has('--pve-probe-only');
const escapeProbeOnly = has('--escape-probe-only');
const recoveryProbeOnly = has('--recovery-probe-only');
const roomProbeOnly =
  has('--room-probe-only') ||
  navigationProbeOnly ||
  pveProbeOnly ||
  escapeProbeOnly ||
  recoveryProbeOnly;
if (
  [
    has('--room-probe-only'),
    navigationProbeOnly,
    pveProbeOnly,
    escapeProbeOnly,
    recoveryProbeOnly
  ].filter(Boolean).length > 1
)
  throw new Error('Choose only one room, navigation, PvE, escape, or recovery probe mode');
const gossipReplyTest = has('--gossip-reply-test');
const requestedRuntimeMs = Number(valueOf('--max-ms') ?? 120_000);
const requestedMaxMoves = Number(
  valueOf('--max-moves') ??
    (escapeProbeOnly ? 1 : navigationProbeOnly || pveProbeOnly || recoveryProbeOnly ? 0 : 12)
);
if (escapeProbeOnly && requestedMaxMoves !== 1)
  throw new Error('--escape-probe-only requires --max-moves 1');
if (recoveryProbeOnly && requestedMaxMoves !== 0)
  throw new Error('--recovery-probe-only requires --max-moves 0');
if (
  recoveryProbeOnly &&
  (!Number.isInteger(requestedRuntimeMs) ||
    requestedRuntimeMs < 1 ||
    requestedRuntimeMs > 60_000)
)
  throw new Error('--recovery-probe-only requires --max-ms from 1 through 60000');
const postTimeoutObserveMs = Number(valueOf('--post-timeout-observe-ms') ?? 0);
if (
  !Number.isInteger(postTimeoutObserveMs) ||
  postTimeoutObserveMs < 0 ||
  postTimeoutObserveMs > 30_000
)
  throw new Error('--post-timeout-observe-ms must be an integer from 0 through 30000');
if (postTimeoutObserveMs > 0 && !pveProbeOnly)
  throw new Error('--post-timeout-observe-ms is only available with --pve-probe-only');
if (postTimeoutObserveMs >= requestedRuntimeMs)
  throw new Error('--post-timeout-observe-ms must be shorter than --max-ms');
if (gossipReplyTest && requestedRuntimeMs > 300_000)
  throw new Error('The bounded gossip-reply test cannot run longer than five minutes');
const configuredHome = homePaths();
const profileFile = configuredHome.profile(profileId).file;
if (!fs.existsSync(profileFile))
  throw new Error(`profile ${profileId} is not configured in the active MudEngine home`);
const resolved = resolveProfile(profileId, YAML.parse(fs.readFileSync(profileFile, 'utf8')), {});
if (resolved.error !== undefined)
  throw new Error(`profile ${profileId} could not be resolved: ${resolved.error}`);
const profile = resolved.profile;
if (!profile.config.connection.login.username || !profile.config.connection.login.password)
  throw new Error(`profile ${profileId} has no complete login configuration`);
if (!roomProbeOnly && !process.env.OPENROUTER_API_KEY)
  throw new Error('OPENROUTER_API_KEY is not present in the environment');

const NEWHAVEN_ARENA = '1/2150';
const NEWHAVEN_ADVENTURERS_GUILD = '1/2147';
const NEWHAVEN_EAST_EXIT_ROOM = '1/2143';
const NEWHAVEN_EASTWARD_EXIT_ROOM = '1/2140';
const NEWHAVEN_SOUTHEAST_EXIT_ROOM = '1/2148';
const NEWHAVEN_SOUTH_EXIT_ROOM = '1/2149';
const NEWHAVEN_NORTH_EXIT_ROOM = '1/2141';
const NEWHAVEN_SOUTHWARD_EXIT_ROOM = '1/2142';
const requestedDestination = valueOf('--destination');
const requestedCombatTarget = valueOf('--target')?.trim();
if (
  requestedDestination !== undefined &&
  !navigationProbeOnly &&
  !pveProbeOnly
)
  throw new Error('--destination is only available with --navigation-probe-only or --pve-probe-only');
if (
  requestedDestination !== undefined &&
  ![
    NEWHAVEN_ARENA,
    NEWHAVEN_ADVENTURERS_GUILD,
    NEWHAVEN_EAST_EXIT_ROOM,
    NEWHAVEN_EASTWARD_EXIT_ROOM,
    NEWHAVEN_SOUTHEAST_EXIT_ROOM,
    NEWHAVEN_SOUTH_EXIT_ROOM,
    NEWHAVEN_NORTH_EXIT_ROOM,
    NEWHAVEN_SOUTHWARD_EXIT_ROOM
  ].includes(requestedDestination)
)
  throw new Error('--destination must be one of the pre-approved Newhaven probe rooms');
if (pveProbeOnly && requestedDestination !== undefined && requestedMaxMoves < 1)
  throw new Error('PvE navigation requires --max-moves of at least 1');
if (has('--target') && !pveProbeOnly)
  throw new Error('--target is only available with --pve-probe-only');
if (has('--target') && !requestedCombatTarget)
  throw new Error('--target requires an exact non-empty hostile name');
const navigationDestination =
  requestedDestination ?? (navigationProbeOnly ? NEWHAVEN_ADVENTURERS_GUILD : undefined);
const runNavigationProbe =
  navigationProbeOnly || (pveProbeOnly && requestedDestination !== undefined);
const MINIMUM_COMBAT_HEALTH_FRACTION = 0.6;
const MAX_ATTACKER_OBSERVATION_MS = 10_000;
const roomProbeAutomation = createRoomProbeAutomation();

const monitor = new LiveHarnessMonitor({
  maxRuntimeMs: requestedRuntimeMs,
  maxMoves: gossipReplyTest ? 0 : requestedMaxMoves,
  maxRequests: gossipReplyTest
    ? Math.min(Number(valueOf('--max-requests') ?? 16), 16)
    : Number(valueOf('--max-requests') ?? 16),
  maxTokens: gossipReplyTest
    ? Math.min(Number(valueOf('--max-tokens') ?? 60_000), 60_000)
    : Number(valueOf('--max-tokens') ?? 60_000),
  maxCostUsd: gossipReplyTest
    ? Math.min(Number(valueOf('--max-cost') ?? 0.05), 0.05)
    : Number(valueOf('--max-cost') ?? 0.05),
  maxRepeatedAction: 2
});
let combatVictoryEvidence = false;
let combatTargetName = null;
let combatTargetIdentity = null;
let combatEligibilityReason = null;
let combatTargetDied = false;
let combatStartedAt = null;
let pveScenarioIndex = null;
let escapeProbeMovementSent = false;
let healthObservationCount = 0;
const combatEvidenceEvents = [];
const combatCommands = [];
const combatSnapshots = [];
const combatFightEvidence = [];
const combatFightSink = {
  record: (record) => {
    const evidence = summarizeCombatFightRecord(record, combatTargetName);
    if (evidence === null) return;
    combatFightEvidence.push(evidence);
    if (combatFightEvidence.length > 8) combatFightEvidence.shift();
    if (evidence.exactTargetDeath) combatTargetDied = true;
  }
};
const captureCombatSnapshot = () => {
  if (combatStartedAt === null) return;
  const aiState = snapshot().state;
  const elapsedMs = Date.now() - combatStartedAt;
  const entry = summarizeCombatState({
    elapsedMs,
    room: roomKey(),
    vitals: session.character.vitals,
    combat: session.character.combat,
    scheduler: {
      status: aiState.status,
      activity: aiState.activity,
      currentAction: aiState.currentAction
        ? { name: aiState.currentAction.name, phase: aiState.currentAction.phase }
        : null
    }
  });
  const prior = combatSnapshots.at(-1);
  const comparable = JSON.stringify({ ...entry, elapsedMs: 0 });
  const priorComparable = prior ? JSON.stringify({ ...prior, elapsedMs: 0 }) : null;
  if (prior && comparable === priorComparable && elapsedMs - prior.elapsedMs < 5_000) return;
  combatSnapshots.push(entry);
  if (combatSnapshots.length > 24) combatSnapshots.shift();
};
let combatBlocksNavigation = false;
let recoveryBlocksNavigation = false;
let currentRoom = null;
let multiRoomTarget = null;
const loginBlockCounts = new Map();
const loginPromptSignals = new Set();
const recentLoginBlockSummaries = [];
let latestLocationEvidence = null;
const sink = {
  data: () => {},
  block: (block) => {
    if (block.type === 'user-health') healthObservationCount += 1;
    if (
      (block.type === 'user-location' || block.type === 'user-profile') &&
      /^\d+$/.test(block.groups.map ?? '') &&
      /^\d+$/.test(block.groups.room ?? '')
    ) {
      latestLocationEvidence = {
        type: block.type,
        map: block.groups.map,
        room: block.groups.room
      };
    }
    if (session.character.phase !== 'in-game' && loginBlockCounts.size < 12) {
      loginBlockCounts.set(block.type, (loginBlockCounts.get(block.type) ?? 0) + 1);
      const text = block.text.toLowerCase();
      const categories = [
        ['account', /\baccount\b/],
        ['character', /\bcharacter\b/],
        ['choose', /\bchoose\b|\bselect\b|\bchoice\b/],
        ['continue', /\bcontinue\b|\bnext\b/],
        ['enter', /\benter\b|\btype\b|\binput\b/],
        ['menu', /\bmenu\b|\boption\b/],
        ['password', /\bpassword\b/],
        ['realm', /\brealm\b|\bworld\b|\bserver\b/],
        ['rules', /\brules?\b|\baccept\b/],
        ['username', /\buser\s*name\b|\blogin\b/],
        ['welcome', /\bwelcome\b/]
      ];
      if (loginPromptSignals.size < 12) {
        for (const [name, pattern] of categories)
          if (pattern.test(text)) loginPromptSignals.add(name);
        if (block.terminator === 'flush') loginPromptSignals.add('flush-terminated');
        if (block.terminator === 'newline') loginPromptSignals.add('newline-terminated');
      }
      const matchedCategories = categories
        .filter(([, pattern]) => pattern.test(text))
        .map(([name]) => name);
      recentLoginBlockSummaries.push(
        `${block.type}[${matchedCategories.join(',') || 'other'}]${block.terminator === 'flush' ? ':flush' : ''}`
      );
      if (recentLoginBlockSummaries.length > 8) recentLoginBlockSummaries.shift();
    }
    if (block.type === 'user-gain-experience') {
      combatVictoryEvidence = true;
    }
    const combatEvidence = summarizeCombatEvidence(block, combatTargetName);
    if (combatEvidence !== null) combatEvidenceEvents.push(combatEvidence);
    if (combatEvidenceEvents.length > 20) combatEvidenceEvents.shift();
    if (
      block.type === 'mob-dies' &&
      isExactCombatTargetDeathEvidence(block.groups, combatTargetName)
    )
      combatTargetDied = true;
    if (
      gossipReplyTest &&
      block.type === 'conversation-gossip' &&
      session.character.phase === 'in-game'
    ) {
      monitor.incomingGossip(
        block.groups.player ?? '',
        block.groups.message ?? '',
        session.character.name ?? ''
      );
    }
  },
  state: () => {},
  character: () => {},
  dropped: () => monitor.fail('stall', 'Live-test connection dropped unexpectedly'),
  telnet: () => {},
  notice: () => {},
  line: () => {},
  command: (command, _source, coalesceKey) => {
    monitor.command(command, Date.now(), coalesceKey);
    if (
      escapeProbeOnly &&
      !escapeProbeMovementSent &&
      /^(?:n|s|e|w|ne|nw|se|sw|u|d|north|south|east|west|northeast|northwest|southeast|southwest|up|down)$/i.test(
        command.trim()
      )
    ) {
      escapeProbeMovementSent = true;
      setImmediate(() =>
        session.configure(
          roomProbeAutomation,
          profile.config.connection.login,
          profile.config.ui.rewrites,
          profile.config.connection.locate
        )
      );
    }
    if (combatStartedAt !== null && combatCommands.length < 40) {
      const value = command.trim().replace(/\s+/g, ' ').slice(0, 120);
      if (value) combatCommands.push({ elapsedMs: Date.now() - combatStartedAt, value });
    }
  }
};

const home = configuredHome;
const realms = new RealmLibrary({
  shippedDir: path.join(process.cwd(), 'resources', 'world'),
  resourcesDir: path.join(process.cwd(), 'resources'),
  cacheDir: path.join(home.root, 'state', 'realms'),
  notify: () => {}
});
const world = realms.load(profile.database ?? '').graph;
const harnessAutomation = roomProbeOnly
  ? roomProbeAutomation
  : profile.config.automation;
// Entry probes can overlap with room exits (notably "st").
const harnessAutomationConfig = {
  ...harnessAutomation,
  onEnterRealm: gossipReplyTest || roomProbeOnly ? [] : harnessAutomation.onEnterRealm,
  idle: { ...harnessAutomation.idle, enabled: false },
  rules: []
};
const session = new SessionManager(
  sink,
  world,
  harnessAutomationConfig,
  profile.config.connection.login,
  undefined,
  undefined,
  combatFightSink
);
session.configure(
  harnessAutomationConfig,
  profile.config.connection.login,
  profile.config.ui.rewrites,
  profile.config.connection.locate
);
session.resize({ cols: 100, rows: 30 });
// Keep the production session budget strict while allowing the provider-driven
// objective plus the existing bounded scenarios to run without prescribing
// their activity sequence.
session.aiBudget({
  requestsPerMinute: 12,
  requestsPerHour: 60,
  sessionTokens: 60_000,
  sessionCostUsd: 0.05
});

const report = {
  profile: profile.id,
  scenarios: [],
  violations: monitor.violations,
  trace: monitor.events
};
const roomKey = () => {
  return roomIdentityKey(session.character.room);
};
const snapshot = () => session.aiSnapshot;
const currentCombatSnapshot = () => {
  const aiState = snapshot().state;
  return summarizeCombatState({
    elapsedMs: combatStartedAt === null ? 0 : Date.now() - combatStartedAt,
    room: roomKey(),
    vitals: session.character.vitals,
    combat: session.character.combat,
    scheduler: {
      status: aiState.status,
      activity: aiState.activity,
      currentAction: aiState.currentAction
        ? { name: aiState.currentAction.name, phase: aiState.currentAction.phase }
        : null
    }
  });
};
const persistCombatDiagnostic = (diagnostic) => {
  const diagnosticDirectory = path.join(home.root, 'state', 'live-diagnostics');
  const diagnosticFile = path.join(
    diagnosticDirectory,
    `combat-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}.json`
  );
  fs.mkdirSync(diagnosticDirectory, { recursive: true });
  fs.writeFileSync(diagnosticFile, JSON.stringify(diagnostic, null, 2), {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600
  });
  return path.relative(home.root, diagnosticFile).split(path.sep).join('/');
};
const waitFor = async (predicate, timeout = 45_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end && !monitor.failed) {
    monitor.check();
    // Polling is observation only. Reuse the production tick without adding a
    // changing synthetic event, so unchanged state remains deduplicated while
    // a Walker room transition can settle the delegated action.
    await session.aiTick();
    const state = snapshot().state;
    monitor.usage(
      state.usage.requests,
      state.usage.inputTokens + state.usage.outputTokens,
      state.usage.estimatedCostUsd
    );
    if (predicate(state)) return true;
    await wait(250);
  }
  return false;
};
const waitForRecoveryFraction = (minimumFraction) =>
  waitForRecoveryHealth({
    vitals: () => session.character.vitals,
    combatActive: () =>
      session.character.combat.engaged || session.character.combat.attackers.length > 0,
    wait,
    isStopped: () => {
      monitor.check();
      return monitor.failed;
    },
    minimumFraction,
    timeoutMs: Math.max(0, monitor.limits.maxRuntimeMs - monitor.elapsedRuntimeMs),
    pollIntervalMs: 250
  });
const waitForRecoveryReady = () => waitForRecoveryFraction(0.6);
const recoveryDiagnostic = () => {
  const { hp, hpMax, resting, meditating } = session.character.vitals;
  const { engaged, target, attackers } = session.character.combat;
  const { restBelow, restTo } = profile.config.automation.health;
  const state = snapshot().state;
  return [
    `HP=${hp ?? 'unknown'}/${hpMax ?? 'unknown'}`,
    `resting=${resting}`,
    `meditating=${meditating}`,
    `combatEngaged=${engaged}`,
    `target=${target ?? 'none'}`,
    `attackers=${attackers.length}`,
    `restBelow=${restBelow}`,
    `restTo=${restTo}`,
    `action=${state.currentAction?.name ?? 'none'}`,
    `actionResult=${state.lastActionResult || 'none'}`
  ].join('; ');
};
const combatDiagnostic = () => {
  const { hp, hpMax } = session.character.vitals;
  const { engaged, target, attackers } = session.character.combat;
  return [
    `HP=${hp ?? 'unknown'}/${hpMax ?? 'unknown'}`,
    `engaged=${engaged}`,
    `target=${target ?? 'none'}`,
    `attackers=${attackers.length}`
  ].join('; ');
};
const loginDiagnostic = () => {
  const { phase, room, vitals, combat } = session.character;
  return [
    `phase=${phase}`,
    `room=${room.map ?? 'unknown'}/${room.number ?? 'unknown'}`,
    `HP=${vitals.hp ?? 'unknown'}/${vitals.hpMax ?? 'unknown'}`,
    `combatEngaged=${combat.engaged}`,
    `targetPresent=${combat.target !== null}`,
    `attackers=${combat.attackers.length}`,
    `configuredLoginStepCount=${profile.config.connection.login.steps.length}`,
    `parsedBlockTypes=${[...loginBlockCounts]
      .map(([type, count]) => `${type}:${count}`)
      .join(',') || 'none'}`,
    `promptSignals=${[...loginPromptSignals].join(',') || 'none'}`,
    `recentBlocks=${recentLoginBlockSummaries.join(' > ') || 'none'}`
  ].join('; ');
};
const runScenario = async (name, objective, expected) => {
  const before = roomKey();
  currentRoom = before;
  monitor.room(before);
  session.aiGoal(objective);
  const complete = await waitFor(
    (state) =>
      state.objectiveComplete === true ||
      state.status === 'error' ||
      state.status === 'budget-paused'
  );
  const after = roomKey();
  monitor.room(after);
  const state = snapshot().state;
  const passed =
    complete &&
    state.objectiveComplete === true &&
    expected(before, after, state) &&
    !monitor.failed;
  report.scenarios.push({
    name,
    passed,
    before,
    after,
    ...(name === 'two-room-navigation' ? { target: multiRoomTarget } : {}),
    status: state.status,
    result: state.lastActionResult,
    usage: state.usage
  });
  session.aiClearGoal();
  if (monitor.failed) throw new Error(monitor.violations[0].message);
  return passed;
};
const runIntegratedAdventureObjective = async () => {
  const before = roomKey();
  const objective =
    'Navigate to 1/2150, inspect the room, engage a suitable hostile mob if available, assess the combat result, recover health, then stop.';
  combatVictoryEvidence = false;
  combatTargetName = null;
  combatTargetDied = false;
  combatEvidenceEvents.length = 0;
  combatFightEvidence.length = 0;
  session.aiGoal(objective);
  const complete = await waitFor(
    (state) => {
      for (const approval of state.pendingApprovals) {
        const targetName = approval.action?.args?.name;
        if (approval.action?.name !== 'engage_enemy' || typeof targetName !== 'string') continue;
        const room = session.character.room;
        const escapeAvailable =
          room?.exits.some(
            (exit) =>
              exit.targetMap !== null && exit.targetRoom !== null && exit.requirement === null
          ) ?? false;
        const eligibility = assessCombatEligibility(
          room?.occupants ?? [],
          session.character.vitals,
          targetName,
          0.6,
          escapeAvailable
        );
        if (!eligibility.ok || !eligibility.target) continue;
        combatTargetName = eligibility.target.name;
        monitor.authorizeCombatTarget(combatTargetName);
        session.aiApprove(approval.id);
      }
      return (
        state.objectiveComplete === true ||
        state.status === 'error' ||
        state.status === 'budget-paused'
      );
    },
    Math.max(0, monitor.limits.maxRuntimeMs - monitor.elapsedRuntimeMs)
  );
  const after = roomKey();
  const state = snapshot().state;
  const plan = state.plan ?? [];
  const planComplete =
    plan.length > 0 &&
    plan.every((step) => step.status === 'completed' || step.status === 'skipped');
  const arrived = after === NEWHAVEN_ARENA;
  const roomInspected = plan.some(
    (step) => step.action === 'inspect_room' && step.status === 'completed'
  );
  const combatStep = plan.find((step) => step.action === 'engage_enemy');
  const resultStep = plan.find((step) => step.action === 'inspect_combat_result');
  const combatReviewed =
    resultStep?.status === 'completed' || resultStep?.status === 'skipped';
  const passed =
    complete &&
    state.objectiveComplete === true &&
    planComplete &&
    arrived &&
    roomInspected &&
    combatReviewed &&
    !monitor.failed;
  report.scenarios.push({
    name: 'integrated-arena-objective',
    passed,
    before,
    after,
    objective,
    status: state.status,
    plan: plan.map(({ action, status }) => ({ action, status })),
    result: [
      state.lastActionResult,
      `rooms=${before === after ? before : `${before} -> ${after}`}`,
      `combat=${combatStep?.status ?? 'missing'}`,
      `target=${combatTargetName ?? 'none'}`,
      `xpVictory=${combatVictoryEvidence}`,
      `targetDeathObserved=${combatTargetDied}`,
      `HP=${session.character.vitals.hp ?? 'unknown'}/${session.character.vitals.hpMax ?? 'unknown'}`,
      `resting=${session.character.vitals.resting}`,
      `restBelow=${profile.config.automation.health.restBelow}`,
      `restTo=${profile.config.automation.health.restTo}`
    ].join('; '),
    usage: state.usage,
    note:
      'One explicit objective was executed through Agent planning, Walker, and the SessionManager. Combat/result steps are skipped when no eligible target is present; recovery follows the configured threshold. Any combat requires fresh hostile, health, and escape evidence.'
  });
  session.aiClearGoal();
  if (!passed)
    throw new Error(`integrated Arena objective did not complete: ${state.lastActionResult}`);
  return passed;
};
const runProviderDrivenObjective = async () => {
  const before = roomKey();
  currentRoom = before;
  monitor.room(before);
  const objective =
    'Observe the current area and make safe useful progress using your judgment. Stop when the useful observation or safe activity is complete.';
  const candidatesBefore = snapshot().observation.activityCandidates ?? [];
  session.aiGoal(objective);
  const complete = await waitFor(
    (state) =>
      state.objectiveComplete === true ||
      state.status === 'error' ||
      state.status === 'budget-paused',
    45_000
  );
  const after = roomKey();
  monitor.room(after);
  const state = snapshot().state;
  const action = state.currentAction?.name ?? state.activity;
  const passed =
    complete &&
    state.objectiveComplete === true &&
    !monitor.failed &&
    state.lastActionResult.length > 0;
  report.scenarios.push({
    name: 'provider-driven-broad-objective',
    passed,
    before,
    after,
    objective,
    providerSelectedAction: action,
    rankedCandidates: candidatesBefore.map(({ action: candidate }) => candidate.name),
    status: state.status,
    result: state.lastActionResult,
    usage: state.usage,
    note: 'The harness submitted one broad objective and did not prescribe an action sequence.'
  });
  session.aiClearGoal();
  if (!passed) throw new Error(`provider-driven objective did not complete: ${state.lastActionResult}`);
  return passed;
};

const runGossipReplyTest = async () => {
  monitor.authorizeGossipReplies();
  const startedAt = Date.now();
  const deadline =
    startedAt + Math.max(0, monitor.limits.maxRuntimeMs - monitor.elapsedRuntimeMs);
  const rejectedApprovals = [];
  const objective =
    'For up to five minutes, reply briefly and politely only to actual incoming gossip messages. Choose the send_message action for the gossip channel. Never initiate a message or communicate over another channel. Continue listening after each reply and stop after five replies.';
  session.aiGoal(objective);
  let approvedReplies = 0;
  while (
    Date.now() < deadline &&
    monitor.gossipRepliesSent < 5 &&
    !monitor.failed
  ) {
    await session.aiTick();
    monitor.check();
    const state = snapshot().state;
    monitor.usage(
      state.usage.requests,
      state.usage.inputTokens + state.usage.outputTokens,
      state.usage.estimatedCostUsd
    );
    if (state.status === 'budget-paused' || state.status === 'error') {
      monitor.fail('stall', `Gossip reply test stopped with AI status ${state.status}`);
      break;
    }
    if (monitor.failed) break;
    if (approvedReplies > monitor.gossipRepliesSent) {
      await wait(250);
      continue;
    }
    for (const approval of state.pendingApprovals) {
      monitor.check();
      if (monitor.failed) break;
      const action = approval.action;
      const message =
        action?.name === 'send_message' && action.args?.channel === 'gossip'
          ? String(action.args.message ?? '')
          : '';
      const eligibility =
        action?.name === 'send_message' && action.args?.channel === 'gossip'
          ? monitor.gossipReplyEligibility(message)
          : {
              ok: false,
              reason: 'Only replies to recent inbound gossip may be approved in this test'
            };
      if (eligibility.ok) {
        session.aiApprove(approval.id);
        approvedReplies += 1;
      } else {
        session.aiReject(approval.id);
        const commandVerb = approval.command.split(/\s/, 1)[0] ?? '';
        rejectedApprovals.push({
          action: action?.name ?? 'execute_supported_command',
          ...(typeof action?.args?.channel === 'string' ? { channel: action.args.channel } : {}),
          ...(!action && commandVerb
            ? {
                commandVerb: /^[.>/-]/.test(commandVerb) ? 'public-message' : commandVerb
              }
            : {})
        });
        monitor.fail(
          'unsafe-command',
          `Gossip test rejected an out-of-scope approval: ${eligibility.reason}`
        );
        break;
      }
      break;
    }
    if (!monitor.failed)
      await wait(Math.min(250, Math.max(0, deadline - Date.now())));
  }
  session.aiEmergencyStop();
  const state = snapshot().state;
  const passed = monitor.gossipRepliesSent > 0 && !monitor.failed;
  report.scenarios.push({
    name: 'bounded-gossip-replies',
    passed,
    inboundMessages: monitor.gossipInboundMessages,
    repliesSent: monitor.gossipRepliesSent,
    rejectedApprovals,
    durationMs: Date.now() - startedAt,
    status: state.status,
    activity: state.activity,
    currentAction: state.currentAction
      ? { name: state.currentAction.name, phase: state.currentAction.phase }
      : null,
    advertisedActions: snapshot().observation.availableActions,
    result:
      monitor.gossipRepliesSent > 0
        ? 'Replies were approval-gated and matched to recent inbound gossip'
        : 'No approved reply was sent; no inbound gossip may have arrived during the bounded window',
    usage: state.usage
  });
  report.violations = monitor.violations;
  report.trace = monitor.events.slice(-50);
  console.log(JSON.stringify(report, null, 2));
  if (!passed) process.exitCode = 1;
};

async function main() {
  monitor.start();
  // Ordinary recovery is explicitly authorized for disposable Kefka and is
  // still bounded by the production recovery adapter and session budget.
  if (!roomProbeOnly) monitor.authorizeRecovery();
  console.log(`AI live test -> ${profile.id} (credentials withheld)`);
  await session.connect(profile.target);
  const connected = await waitFor(() => session.character.phase === 'in-game');
  if (!connected) {
    const result = loginDiagnostic();
    report.scenarios.push({
      name: 'login-in-game-state',
      passed: false,
      result
    });
    throw new Error(`did not reach in-game state (${result})`);
  }
  if (gossipReplyTest) {
    await runGossipReplyTest();
    return;
  }
  let roomKnown =
    !roomProbeOnly && (await waitFor(() => /^\d+\/\d+$/.test(roomKey()), 30_000));
  let roomProbe = { resolved: roomKnown, requestSent: false };
  if (!roomKnown && !roomProbeOnly) {
    roomProbe = await requestRoomIdentity({
      roomKey,
      request: () => session.askWhereIAm(),
      waitFor: (timeoutMs) => waitFor(() => /^\d+\/\d+$/.test(roomKey()), timeoutMs),
      timeoutMs: Math.min(
        5_000,
        Math.max(0, monitor.limits.maxRuntimeMs - monitor.elapsedRuntimeMs)
      )
    });
    roomKnown = roomProbe.resolved;
  }
  if (roomProbeOnly) {
    const locationProbeAttempts = [];
    const tryLocationProbe = async (name, request) => {
      const priorEvidence = latestLocationEvidence;
      const requestAccepted = request();
      const responseObserved =
        requestAccepted &&
        (await waitFor(
          () =>
            latestLocationEvidence !== priorEvidence &&
            latestLocationEvidence !== null &&
            /^\d+\/\d+$/.test(roomKey()) &&
            `${latestLocationEvidence.map}/${latestLocationEvidence.room}` === roomKey(),
          5_000
        ));
      locationProbeAttempts.push({
        name,
        requestAccepted,
        responseObserved,
        responseType:
          latestLocationEvidence === priorEvidence ? null : latestLocationEvidence?.type
      });
      return responseObserved;
    };
    let responseObserved = await tryLocationProbe('configured', () =>
      session.askWhereIAm(true)
    );
    // `pro` is documented by the production parser/config as returning the
    // character profile's `Location:` coordinates. Try it once, read-only,
    // only when the configured locator produced no authoritative response.
    if (!responseObserved) {
      responseObserved = await tryLocationProbe('documented-profile', () =>
        session.ask('pro', true)
      );
    }
    const healthRequestAccepted =
      responseObserved && session.character.phase === 'in-game'
        ? session.ask('health', true)
        : false;
    const healthDeadline = Date.now() + 5_000;
    while (
      healthRequestAccepted &&
      (session.character.vitals.hp === null || session.character.vitals.hpMax === null) &&
      Date.now() < healthDeadline &&
      !monitor.failed
    ) {
      monitor.check();
      await wait(250);
    }
    const statusRequestAccepted =
      healthRequestAccepted && session.character.vitals.hp !== null && session.character.vitals.hp < 0
        ? session.ask('st', true)
        : false;
    if (statusRequestAccepted) {
      const statusDeadline = Date.now() + 5_000;
      while (
        session.character.vitals.hpMax === null &&
        session.character.progress.lives === null &&
        Date.now() < statusDeadline &&
        !monitor.failed
      ) {
        monitor.check();
        await wait(250);
      }
    }
    const healthState = session.character;
    const visibleNpc = findSafeNpc(healthState.room.occupants);
    const eligibleCombatTarget = findSafeCombatNpc(
      healthState.room.occupants,
      undefined,
      healthState.combat.attackers
    );
    const healthProbe = {
      requestAccepted: healthRequestAccepted,
      statusRequestAccepted,
      phase: healthState.phase,
      hp: healthState.vitals.hp,
      hpMax: healthState.vitals.hpMax,
      resting: healthState.vitals.resting,
      meditating: healthState.vitals.meditating,
      lives: healthState.progress.lives,
      mortallyWounded: healthState.mortallyWounded,
      lastDeath: healthState.lastDeath,
      combatEngaged: healthState.combat.engaged,
      targetPresent: healthState.combat.target !== null,
      attackerCount: healthState.combat.attackers.length,
      attackers: healthState.combat.attackers,
      exits: healthState.room.exits.map((exit) => ({
        direction: exit.direction,
        destination:
          exit.targetMap !== null && exit.targetRoom !== null
            ? `${exit.targetMap}/${exit.targetRoom}`
            : null,
        requirement: exit.requirement?.kind ?? null,
        mappedAndUnblocked:
          exit.targetMap !== null && exit.targetRoom !== null && exit.requirement === null
      })),
      visibleNpc: visibleNpc?.npc
        ? { name: visibleNpc.npc.name, source: visibleNpc.npc.source ?? null }
        : null,
      eligibleCombatTarget: eligibleCombatTarget
        ? {
            name: eligibleCombatTarget.name,
            source: eligibleCombatTarget.mob?.source ?? null,
            disposition: eligibleCombatTarget.disposition ?? null
          }
        : null,
      visibleMobs: healthState.room.occupants
        .filter((occupant) => occupant.kind === 'mob')
        .map((mob) => ({
          name: mob.name,
          source: mob.mob?.source ?? null,
          disposition: mob.disposition ?? null,
          uncertain: mob.uncertain,
          charmed: mob.charmed,
          costly: mob.costly
        }))
    };
    let escapeProbe = null;
    if (escapeProbeOnly) {
      const state = session.character;
      const escapeTarget = findSafeCombatNpc(
        state.room.occupants,
        undefined,
        state.combat.attackers
      );
      const targetIsRecordedAttacker =
        escapeTarget !== null &&
        state.combat.attackers.some(
          (attacker) => mobKey(attacker) === mobKey(escapeTarget.name)
        );
      const exits = state.room.exits.map((exit) => exit.direction);
      const refusal = !responseObserved
        ? 'No authoritative starting room was resolved'
        : state.phase !== 'in-game'
          ? 'The character is not in-game'
          : state.vitals.hp === null || state.vitals.hp <= 0 || state.vitals.hpMax === null
            ? 'Positive current and maximum health are required'
            : state.combat.attackers.length < 1
            ? 'At least one authoritative attacker is required'
              : !escapeTarget || !targetIsRecordedAttacker
                ? 'No eligible realm-backed hostile matches the authoritative attacker list'
                : exits.length === 0
                  ? 'The current room has no server-listed exit'
                  : null;
      if (refusal !== null) {
        escapeProbe = {
          passed: false,
          attempted: false,
          result: `Refused without gameplay action: ${refusal}`
        };
      } else {
        const before = roomKey();
        const movesBefore = monitor.moveCount;
        const eventOffset = monitor.events.length;
        session.configure(
          createEscapeProbeAutomation(profile.config.automation),
          profile.config.connection.login,
          profile.config.ui.rewrites,
          profile.config.connection.locate
        );
        const triggerAccepted = session.ask('health', true);
        const movementRequested = await waitFor(
          () => monitor.moveCount > movesBefore,
          Math.min(10_000, Math.max(0, monitor.limits.maxRuntimeMs - monitor.elapsedRuntimeMs))
        );
        const roomChanged =
          movementRequested &&
          (await waitFor(
            () => roomKey() !== before,
            Math.min(10_000, Math.max(0, monitor.limits.maxRuntimeMs - monitor.elapsedRuntimeMs))
          ));
        session.configure(
          roomProbeAutomation,
          profile.config.connection.login,
          profile.config.ui.rewrites,
          profile.config.connection.locate
        );
        const postLocationRequestAccepted = roomChanged
          ? false
          : session.ask('pro', true);
        if (postLocationRequestAccepted) {
          const priorEvidence = latestLocationEvidence;
          await waitFor(
            () =>
              latestLocationEvidence !== priorEvidence &&
              /^\d+\/\d+$/.test(roomKey()),
            Math.min(5_000, Math.max(0, monitor.limits.maxRuntimeMs - monitor.elapsedRuntimeMs))
          );
        }
        const healthObservationsBefore = healthObservationCount;
        const postHealthRequestAccepted = session.ask('health', true);
        let postHealthObserved = false;
        if (postHealthRequestAccepted) {
          postHealthObserved = await waitFor(
            () => healthObservationCount > healthObservationsBefore,
            Math.min(5_000, Math.max(0, monitor.limits.maxRuntimeMs - monitor.elapsedRuntimeMs))
          );
        }
        const movementCommands = monitor.events
          .slice(eventOffset)
          .filter((event) => event.kind === 'command' && /^(?:n|s|e|w|ne|nw|se|sw|u|d|north|south|east|west|northeast|northwest|southeast|southwest|up|down)$/i.test(event.value))
          .map((event) => event.value);
        escapeProbe = {
          passed:
            triggerAccepted &&
            movementRequested &&
            roomChanged &&
            movementCommands.length === 1 &&
            !monitor.failed,
          attempted: true,
          reason: `One or more hostile attackers; ${escapeTarget.name} matched realm and attacker evidence`,
          target: escapeTarget.name,
          temporaryRetreat: { enabled: true, whenOutnumbered: 1 },
          before,
          after: roomKey(),
          exits,
          movementCommands,
          movementCount: monitor.moveCount - movesBefore,
          triggerAccepted,
          movementRequested,
          roomChanged,
          postLocationRequestAccepted,
          postHealthRequestAccepted,
          postHealthObserved,
          hp: session.character.vitals.hp,
          attackers: session.character.combat.attackers,
          result: roomChanged
            ? `SessionManager retreat sent one direction and observed room change to ${roomKey()}`
            : 'No authoritative room change was observed after the bounded retreat attempt'
        };
      }
    }
    let recoveryProbe = null;
    if (recoveryProbeOnly) {
      const state = session.character;
      const beforeRoom = roomKey();
      const beforeHp = state.vitals.hp;
      const hpMax = state.vitals.hpMax;
      const refusal = !responseObserved
        ? 'No authoritative room identity was resolved'
        : state.phase !== 'in-game'
          ? 'The character is not in-game'
          : beforeHp === null || hpMax === null || hpMax <= 0 || beforeHp <= 0
            ? 'Positive current and maximum health are required'
            : beforeHp / hpMax >= 0.98
              ? 'Health is not below the temporary 98% recovery threshold'
              : state.combat.engaged ||
                  state.combat.target !== null ||
                  state.combat.attackers.length > 0
                ? 'Combat or hostile attention is active'
                : state.room.occupants.length > 0
                  ? 'The room is occupied; recovery probe requires an empty room'
                  : state.vitals.resting || state.vitals.meditating
                    ? 'Recovery is already active; no new rest command will be tested'
                    : null;
      if (refusal !== null) {
        recoveryProbe = {
          passed: false,
          attempted: false,
          result: `Refused without gameplay action: ${refusal}`
        };
      } else {
        const observationsBefore = healthObservationCount;
        const eventOffset = monitor.events.length;
        monitor.authorizeRecovery();
        session.configure(
          createRecoveryProbeAutomation(),
          profile.config.connection.login,
          profile.config.ui.rewrites,
          profile.config.connection.locate
        );
        const requestAccepted = session.ask('health', true);
        const healthObserved =
          requestAccepted &&
          (await waitFor(
            () => healthObservationCount > observationsBefore,
            Math.min(5_000, Math.max(0, monitor.limits.maxRuntimeMs - monitor.elapsedRuntimeMs))
          ));
        const recoveryReady =
          healthObserved &&
          (await waitForRecoveryHealth({
            vitals: () => session.character.vitals,
            combatActive: () =>
              session.character.combat.engaged ||
              session.character.combat.target !== null ||
              session.character.combat.attackers.length > 0,
            wait,
            isStopped: () => {
              monitor.check();
              return monitor.failed;
            },
            minimumFraction: 1,
            timeoutMs: Math.max(
              0,
              monitor.limits.maxRuntimeMs - monitor.elapsedRuntimeMs
            ),
            pollIntervalMs: 500
          }));
        session.configure(
          roomProbeAutomation,
          profile.config.connection.login,
          profile.config.ui.rewrites,
          profile.config.connection.locate
        );
        const afterState = session.character;
        const restCommandObserved = monitor.events
          .slice(eventOffset)
          .some((event) => event.kind === 'command' && /^rest$/i.test(event.value));
        const hpIncreased =
          afterState.vitals.hp !== null &&
          beforeHp !== null &&
          afterState.vitals.hp > beforeHp;
        recoveryProbe = {
          passed:
            requestAccepted &&
            healthObserved &&
            restCommandObserved &&
            recoveryReady &&
            hpIncreased &&
            roomKey() === beforeRoom &&
            !monitor.failed,
          attempted: true,
          beforeRoom,
          afterRoom: roomKey(),
          beforeHp,
          afterHp: afterState.vitals.hp,
          hpMax: afterState.vitals.hpMax,
          resting: afterState.vitals.resting,
          temporaryRestThreshold: 0.98,
          temporaryRestTo: 1,
          recoveryReadyFraction: 1,
          requestAccepted,
          healthObserved,
          restCommandObserved,
          recoveryReady,
          result:
            recoveryReady && hpIncreased
              ? `Recovery reached ${afterState.vitals.hp}/${afterState.vitals.hpMax} HP without leaving ${beforeRoom}`
              : `Recovery was not verified to full health before the bounded wait ended at ${afterState.vitals.hp}/${afterState.vitals.hpMax} HP`
        };
      }
    }
    let navigation = null;
    if (runNavigationProbe) {
      const state = session.character;
      const preflight = readOnlyNavigationPreflight(state);
      const alreadyAtRequestedDestination = canSkipNavigationPreflightAtDestination(
        preflight,
        state.room,
        navigationDestination
      );
      const pveHealthReady =
        !pveProbeOnly ||
        (state.vitals.hp !== null &&
          state.vitals.hpMax !== null &&
          state.vitals.hp / state.vitals.hpMax >= MINIMUM_COMBAT_HEALTH_FRACTION);
      if (!responseObserved) {
        navigation = { arrived: false, result: 'No authoritative starting room was resolved' };
      } else if (!preflight.allowed && !alreadyAtRequestedDestination) {
        navigation = { arrived: false, result: preflight.reason };
      } else if (!pveHealthReady) {
        navigation = {
          arrived: false,
          result: 'PvE navigation requires known health at or above the 60% combat floor'
        };
      } else {
        const route = world.route(roomKey(), navigationDestination);
        if (route.blocked) {
          navigation = { arrived: false, result: route.reason };
        } else if (route.steps.length > monitor.limits.maxMoves) {
          navigation = {
            arrived: false,
            result: `Verified route requires ${route.steps.length} steps, exceeding the ${monitor.limits.maxMoves}-move limit`
          };
        } else {
          session.configure(
            createRoomProbeAutomation(true),
            profile.config.connection.login,
            profile.config.ui.rewrites,
            profile.config.connection.locate
          );
          const walk = await navigateToWithWalker({
            destination: navigationDestination,
            roomKey,
            progress: () => session.walker.progress,
            dispatch: async () => {
              const refusal = session.walkRoute(route);
              return {
                ok: refusal === null,
                message: refusal ?? 'Walker accepted the verified route'
              };
            },
            waitFor: (predicate, timeoutMs) => waitFor(() => predicate(), timeoutMs),
            isError: () => monitor.failed,
            timeoutMs: Math.min(
              45_000,
              Math.max(0, monitor.limits.maxRuntimeMs - monitor.elapsedRuntimeMs)
            )
          });
          monitor.room(walk.after);
          navigation = {
            ...walk,
            arrived: walk.arrived && !monitor.failed && walk.after === navigationDestination,
            ...(walk.dispatchMessage === 'Already at destination'
              ? {
                  result: `Already at ${navigationDestination}; no movement command was dispatched`
                }
              : {})
          };
        }
      }
    }
    let pveProbe = null;
    if (pveProbeOnly) {
      const beforeRoom = roomKey();
      let state = session.character;
      let room = state.room;
      let target = findSafeCombatNpc(
        room?.occupants ?? [],
        requestedCombatTarget,
        state.combat.attackers
      );
      let attackerEvidenceWaitMs = 0;
      if (
        !target &&
        (requestedDestination === undefined || navigation?.arrived === true) &&
        state.phase === 'in-game' &&
        !state.combat.engaged &&
        state.combat.target === null &&
        state.vitals.hp !== null &&
        state.vitals.hpMax !== null &&
        state.vitals.hp / state.vitals.hpMax >= MINIMUM_COMBAT_HEALTH_FRACTION &&
        shouldObserveForVerifiedAttacker(
          room?.occupants ?? [],
          requestedCombatTarget,
          state.combat.attackers
        )
      ) {
        const waitBudgetMs = Math.min(
          MAX_ATTACKER_OBSERVATION_MS,
          Math.max(
            0,
            monitor.limits.maxRuntimeMs - monitor.elapsedRuntimeMs - postTimeoutObserveMs
          )
        );
        const waitStartedAt = Date.now();
        await waitFor(() => {
          const current = session.character;
          const healthReady =
            current.vitals.hp !== null &&
            current.vitals.hpMax !== null &&
            current.vitals.hp / current.vitals.hpMax >= MINIMUM_COMBAT_HEALTH_FRACTION;
          return (
            current.phase !== 'in-game' ||
            current.combat.engaged ||
            current.combat.target !== null ||
            current.combat.attackers.length > 0 ||
            !healthReady
          );
        }, waitBudgetMs);
        attackerEvidenceWaitMs = Math.min(Date.now() - waitStartedAt, waitBudgetMs);
        state = session.character;
        room = state.room;
        target = findSafeCombatNpc(
          room?.occupants ?? [],
          requestedCombatTarget,
          state.combat.attackers
        );
      }
      // Match SessionManager's PvE policy; keep this probe's stricter health floor.
      const eligibility = assessCombatEligibility(
        room?.occupants ?? [],
        state.vitals,
        target?.name,
        MINIMUM_COMBAT_HEALTH_FRACTION,
        true,
        state.combat.attackers
      );
      if (requestedDestination !== undefined && navigation?.arrived !== true) {
        pveProbe = {
          passed: false,
          requestedTarget: requestedCombatTarget ?? null,
          result: `Walker did not verify arrival at ${navigationDestination}; combat was not initiated`
        };
      } else if (!responseObserved || roomKey() === '') {
        pveProbe = {
          passed: false,
          result: 'No authoritative room identity was resolved; combat was not initiated'
        };
      } else if (state.phase !== 'in-game') {
        pveProbe = { passed: false, result: 'The character is not in-game; combat was not initiated' };
      } else if (state.combat.engaged || state.combat.target !== null) {
        pveProbe = {
          passed: false,
          result: 'An encounter is already active; no second target was requested'
        };
      } else if (state.vitals.hp === null || state.vitals.hpMax === null) {
        pveProbe = {
          passed: false,
          result: `Safely refused before combat: health remained unknown after the ${healthRequestAccepted ? 'accepted' : 'refused'} read-only health request`
        };
      } else if (state.vitals.hp <= 0) {
        pveProbe = { passed: false, result: 'The character is dead; combat was not initiated' };
      } else if (!eligibility.ok || !eligibility.target) {
        pveProbe = {
          passed: false,
          result: `Safely refused before combat: ${eligibility.reason}; ${summarizeCombatCandidates(room?.occupants ?? [], state.combat.attackers)}`
        };
      } else {
        combatTargetIdentity = {
          name: eligibility.target.name,
          entityIds: [...(eligibility.target.mob?.ids ?? [])],
          entitySource: eligibility.target.mob?.source ?? null,
          entityRow: eligibility.target.mob?.row ?? null,
          disposition: eligibility.target.disposition ?? null,
          uncertain: eligibility.target.uncertain,
          charmed: eligibility.target.charmed,
          costly: eligibility.target.costly,
          verifiedAttacker: state.combat.attackers.some(
            (attacker) => mobKey(attacker) === mobKey(eligibility.target.name)
          )
        };
        combatEligibilityReason = eligibility.reason;
        session.configure(
          createRoomProbeAutomation(true),
          profile.config.connection.login,
          profile.config.ui.rewrites,
          profile.config.connection.locate
        );
        // Match the production gateway: known health and an exact hostile are
        // required; ordinary PvE does not require a mapped escape from Kefka.
        // AutoCombat can ask Routines for the `st` sheet; in this mode it is a
        // status probe, not an attempted Walker step.
        combatVictoryEvidence = false;
        combatTargetName = eligibility.target.name;
        combatTargetDied = false;
        combatEvidenceEvents.length = 0;
        combatFightEvidence.length = 0;
        combatCommands.length = 0;
        combatSnapshots.length = 0;
        combatStartedAt = Date.now();
        monitor.authorizeCombatTarget(combatTargetName);
        captureCombatSnapshot();
        pveScenarioIndex = report.scenarios.length;
        report.scenarios.push({
          name: 'bounded-provider-free-pve-probe',
          passed: false,
          phase: 'exact-target-engagement-requested',
          target: combatTargetName,
          targetIdentity: combatTargetIdentity,
          eligibilityReason: combatEligibilityReason,
          startingRoom: beforeRoom,
          startingHp: state.vitals.hp,
          startingHpMax: state.vitals.hpMax,
          ...(requestedCombatTarget === undefined
            ? {}
            : { requestedTarget: requestedCombatTarget })
        });
        session.aiAgent.state.objective = `Engage the verified PvE enemy ${combatTargetName}`;
        let dispatch = await session.aiAction({
          name: 'engage_enemy',
          args: { name: combatTargetName },
          reason: 'bounded provider-free exact-target PvE probe'
        });
        if (!dispatch.ok) {
          const approval = exactCombatApproval(
            snapshot().state.pendingApprovals,
            combatTargetName
          );
          if (approval) {
            session.aiApprove(approval.id);
            const approvalDeadline = Date.now() + 5_000;
            let approvalCompleted = false;
            while (Date.now() < approvalDeadline && !monitor.failed) {
              monitor.check();
              const approvalResult = snapshot().state.approvalHistory.find(
                (entry) => entry.id === approval.id
              );
              if (
                approvalResult &&
                ['executed', 'failed', 'rejected', 'expired'].includes(approvalResult.status)
              ) {
                approvalCompleted = approvalResult.status === 'executed';
                break;
              }
              await wait(250);
            }
            dispatch = {
              ok: approvalCompleted,
              message: approvalCompleted
                ? 'Exact-target combat approval executed through SessionManager'
                : `Exact-target combat action was not executed: ${snapshot().state.lastActionResult}`
            };
          }
        }
        let outcome = 'not-started';
        let unresolved = false;
        let combatDeadlineUnresolved = false;
        let postTimeoutObservationCompletedMs = 0;
        if (dispatch.ok) {
          const engageDeadline = Date.now() + 5_000;
          while (
            Date.now() < engageDeadline &&
            !monitor.failed &&
            !combatVictoryEvidence &&
            !session.character.combat.engaged &&
            session.character.combat.target === null
          ) {
            monitor.check();
            await wait(250);
          }
          const settlement = await waitForCombatSettlement({
            combat: () => session.character.combat,
            vitals: () => session.character.vitals,
            wait,
            isStopped: () => {
              monitor.check();
              return monitor.failed;
            },
            timeoutMs: Math.max(
              0,
              requestedRuntimeMs - postTimeoutObserveMs - monitor.elapsedRuntimeMs
            ),
            pollIntervalMs: 250,
            onPoll: captureCombatSnapshot
          });
          outcome = settlement.outcome;
          unresolved = settlement.unresolved;
          combatDeadlineUnresolved = unresolved;
          if (unresolved && postTimeoutObserveMs > 0) {
            const observationStartedAt = Date.now();
            const observationDeadline =
              observationStartedAt +
              Math.min(
                postTimeoutObserveMs,
                Math.max(0, monitor.limits.maxRuntimeMs - monitor.elapsedRuntimeMs)
              );
            while (Date.now() < observationDeadline && !monitor.failed) {
              monitor.check();
              captureCombatSnapshot();
              const combat = session.character.combat;
              const terminalVictory =
                combatTargetDied &&
                combatVictoryEvidence &&
                !combat.engaged &&
                combat.target === null &&
                combat.attackers.length === 0;
              if (terminalVictory || session.character.vitals.hp === 0) break;
              await wait(Math.min(250, observationDeadline - Date.now()));
            }
            postTimeoutObservationCompletedMs = Math.min(
              Date.now() - observationStartedAt,
              postTimeoutObserveMs
            );
          }
          const finalSettlement = await waitForCombatSettlement({
            combat: () => session.character.combat,
            vitals: () => session.character.vitals,
            wait,
            isStopped: () => monitor.failed,
            timeoutMs: 0
          });
          outcome = finalSettlement.outcome;
          unresolved = finalSettlement.unresolved;
          if (unresolved) session.aiEmergencyStop();
          captureCombatSnapshot();
        }
        const verifiedVictory = combatTargetDied && combatVictoryEvidence && !unresolved;
        const afterRoom = roomKey();
        const finalCombat = session.character.combat;
        const finalVitals = session.character.vitals;
        pveProbe = {
          passed:
            verifiedVictory &&
            dispatch.ok &&
            afterRoom === beforeRoom &&
            monitor.violations.length === 0,
          beforeRoom,
          afterRoom,
          roomChanged: afterRoom !== beforeRoom,
          target: combatTargetName,
          targetIdentity: combatTargetIdentity,
          eligibilityReason: combatEligibilityReason,
          targetDied: combatTargetDied,
          experienceObserved: combatVictoryEvidence,
          combatEvidenceEvents: [...combatEvidenceEvents],
          combatFightEvidence: [...combatFightEvidence],
          combatCommands: [...combatCommands],
          combatSnapshots: [...combatSnapshots],
          combatDeadlineUnresolved,
          postTimeoutObserveMs,
          postTimeoutObservationCompletedMs,
          outcome,
          unresolved,
          finalHp: finalVitals.hp,
          finalHpMax: finalVitals.hpMax,
          combatEngaged: finalCombat.engaged,
          activeTargetPresent: finalCombat.target !== null,
          attackerCount: finalCombat.attackers.length,
          attackers: finalCombat.attackers,
          result: `${dispatch.message}; outcome=${outcome}; target=${combatTargetName}; targetDeath=${combatTargetDied}; XP=${combatVictoryEvidence}; HP=${finalVitals.hp ?? 'unknown'}/${finalVitals.hpMax ?? 'unknown'}; engaged=${finalCombat.engaged}; activeTargetPresent=${finalCombat.target !== null}; attackers=${finalCombat.attackers.length}; room=${beforeRoom}->${afterRoom}; ${summarizeCombatCandidates(room?.occupants ?? [], finalCombat.attackers)}`
        };
        const targetForAttackerEvidence = requestedCombatTarget ?? target?.name;
        pveProbe.attackerEvidenceWaitMs = attackerEvidenceWaitMs;
        pveProbe.verifiedTargetAttackerObserved = Boolean(
          targetForAttackerEvidence &&
            state.combat.attackers.some(
              (attacker) => mobKey(attacker) === mobKey(targetForAttackerEvidence)
            )
        );
        pveProbe.targetCandidates = summarizeCombatOccupants(
          room?.occupants ?? [],
          state.combat.attackers
        );
        if (pveProbeOnly && pveProbe.target) {
          try {
            pveProbe.diagnosticArtifact = persistCombatDiagnostic({
              profile: profile.id,
              scenario: 'bounded-provider-free-pve-probe',
              target: pveProbe.target,
              targetIdentity: pveProbe.targetIdentity,
              eligibilityReason: pveProbe.eligibilityReason,
              dispatch: dispatch.message,
              beforeRoom: pveProbe.beforeRoom,
              afterRoom: pveProbe.afterRoom,
              combatDeadlineUnresolved: pveProbe.combatDeadlineUnresolved,
              postTimeoutObserveMs: pveProbe.postTimeoutObserveMs,
              postTimeoutObservationCompletedMs: pveProbe.postTimeoutObservationCompletedMs,
              combatCommands: pveProbe.combatCommands,
              combatEvidenceEvents: pveProbe.combatEvidenceEvents,
              combatSnapshots: pveProbe.combatSnapshots,
              combatFightEvidence: pveProbe.combatFightEvidence,
              attackerEvidenceWaitMs: pveProbe.attackerEvidenceWaitMs,
              verifiedTargetAttackerObserved: pveProbe.verifiedTargetAttackerObserved,
              targetCandidates: pveProbe.targetCandidates,
              targetDied: pveProbe.targetDied,
              experienceObserved: pveProbe.experienceObserved,
              outcome: pveProbe.outcome,
              unresolved: pveProbe.unresolved,
              finalHp: pveProbe.finalHp,
              finalHpMax: pveProbe.finalHpMax,
              combatEngaged: pveProbe.combatEngaged,
              activeTargetPresent: pveProbe.activeTargetPresent,
              attackers: pveProbe.attackers
            });
          } catch (error) {
            pveProbe.diagnosticArtifactError =
              error instanceof Error ? error.message : String(error);
            pveProbe.passed = false;
          }
        }
        combatStartedAt = null;
        combatTargetName = null;
        combatTargetIdentity = null;
        combatEligibilityReason = null;
      }
      const pveScenario = {
        name: 'bounded-provider-free-pve-probe',
        ...pveProbe,
        providerRequests: monitor.providerRequests
      };
      if (pveScenarioIndex === null) report.scenarios.push(pveScenario);
      else report.scenarios[pveScenarioIndex] = pveScenario;
      pveScenarioIndex = null;
      const combatSettled = pveProbe?.outcome === 'ended' && pveProbe?.unresolved === false;
      const hpFraction =
        pveProbe?.finalHp !== null &&
        pveProbe?.finalHp !== undefined &&
        pveProbe?.finalHpMax !== null &&
        pveProbe?.finalHpMax !== undefined &&
        pveProbe.finalHpMax > 0
          ? pveProbe.finalHp / pveProbe.finalHpMax
          : null;
      const { restBelow, restTo } = profile.config.automation.health;
      if (!combatSettled) {
        report.scenarios.push({
          name: 'bounded-provider-free-post-combat-recovery',
          passed: false,
          result: pveProbe?.unresolved
            ? 'Skipped because combat or attacker settlement is unresolved; no recovery command was requested'
            : 'Skipped because no settled PvE encounter is available for post-combat recovery'
        });
      } else if (hpFraction === null) {
        report.scenarios.push({
          name: 'bounded-provider-free-post-combat-recovery',
          passed: false,
          result: 'Skipped because authoritative HP is unavailable'
        });
      } else if (restBelow <= 0 || hpFraction >= restBelow) {
        report.scenarios.push({
          name: 'bounded-provider-free-post-combat-recovery',
          passed: true,
          result: `Rest not due at HP ${pveProbe.finalHp}/${pveProbe.finalHpMax}; configured restBelow=${restBelow}`
        });
      } else {
        const recoveryAutomation = createRoomProbeAutomation(true);
        recoveryAutomation.health = {
          ...recoveryAutomation.health,
          restBelow,
          restTo
        };
        session.configure(
          recoveryAutomation,
          profile.config.connection.login,
          profile.config.ui.rewrites,
          profile.config.connection.locate
        );
        monitor.authorizeRecovery();
        const commandsBeforeRecovery = monitor.events.filter(
          (event) => event.kind === 'command'
        ).length;
        const recovery = await session.aiAction({
          name: 'recover_health',
          reason: 'bounded provider-free post-combat recovery'
        });
        const recoveryTarget = restTo > 0 ? restTo : restBelow;
        const recoveryReady = recovery.ok
          ? await waitForRecoveryFraction(recoveryTarget)
          : false;
        const restCommandObserved = monitor.events
          .filter((event) => event.kind === 'command')
          .slice(commandsBeforeRecovery)
          .some(
            (event) => event.kind === 'command' && /^rest$/i.test(event.value)
          );
        report.scenarios.push({
          name: 'bounded-provider-free-post-combat-recovery',
          passed:
            recovery.ok &&
            restCommandObserved &&
            recoveryReady &&
            !monitor.failed,
          result: `${recovery.message}; restCommandObserved=${restCommandObserved}; restTargetReached=${recoveryReady}; target=${Math.round(recoveryTarget * 100)}%; ${recoveryDiagnostic()}`
        });
      }
    }
    report.scenarios.push({
      name: 'configured-room-location',
      passed: responseObserved,
      room: roomKey(),
      serverFamily: session.family,
      configuredLocationMethod: profile.config.connection.locate,
      locationRequestState: session.locationRequestState(),
      locationProbeAttempts,
      healthProbe,
      ...(escapeProbeOnly ? { escapeProbe } : {}),
      ...(recoveryProbeOnly ? { recoveryProbe } : {}),
      providerRequests: monitor.providerRequests,
      result: responseObserved
        ? pveProbeOnly
          ? 'Authoritative coordinates were resolved before the separate bounded PvE probe'
          : recoveryProbeOnly
            ? 'Authoritative coordinates were resolved before the temporary provider-free recovery probe'
            : navigationProbeOnly
              ? 'Authoritative coordinates were resolved before the separate Walker navigation probe'
              : 'A configured or documented read-only profile probe returned authoritative coordinates; no gameplay scenario was run'
        : 'Configured and documented read-only profile probes did not return authoritative coordinates; no AI or gameplay scenario was run'
    });
    if (runNavigationProbe) {
      report.scenarios.push({
        name: navigationProbeOnly
          ? 'walker-navigation-only'
          : 'walker-navigation-before-pve',
        passed: navigation?.arrived === true,
        ...(navigation === null ? {} : navigation),
        destination: navigationDestination,
        result:
          navigation?.result ??
          (navigation?.arrived
            ? `Walker verified arrival at ${navigationDestination}`
            : navigation?.reason ?? 'Walker did not verify destination arrival')
      });
    }
    if (recoveryProbeOnly) {
      report.scenarios.push({
        name: 'bounded-provider-free-recovery-probe',
        passed: recoveryProbe?.passed === true,
        ...(recoveryProbe === null ? {} : recoveryProbe)
      });
    }
    report.violations = monitor.violations;
    report.trace = monitor.events.slice(-50);
    console.log(JSON.stringify(report, null, 2));
    if (
      !responseObserved ||
      monitor.violations.length > 0 ||
      (runNavigationProbe && navigation?.arrived !== true) ||
      (pveProbeOnly && pveProbe?.passed !== true) ||
      (recoveryProbeOnly && recoveryProbe?.passed !== true)
    ) {
      process.exitCode = 1;
    }
    return;
  }
  if (!roomKnown) {
    const result = loginDiagnostic();
    const locationProbeDiagnostic = [
      `configuredLocationProbe=${roomProbe.requestSent ? 'sent' : 'not-sent'}`,
      `locationRequestState=${session.locationRequestState()}`,
      `locationResolved=${roomProbe.resolved}`
    ].join('; ');
    report.scenarios.push({
      name: 'login-room-identity',
      passed: false,
      result: `${result}; ${locationProbeDiagnostic}`
    });
    monitor.fail('stall', `No authoritative room identity was observed after login (${result})`);
    throw new Error(monitor.violations[0].message);
  }
  await runProviderDrivenObjective();
  session.aiClearGoal();
  session.aiEnable();
  const expectedSchedulerAction =
    snapshot().observation.activityCandidates?.[0]?.action.name ?? null;
  let schedulerSelectedAction = null;
  const schedulerSettled = await waitFor((state) => {
    schedulerSelectedAction ??= state.currentAction?.name ?? null;
    return (
      state.currentAction !== null ||
      state.activity === 'autonomous_idle' ||
      state.status === 'error'
    );
  }, 10_000);
  report.scenarios.push({
    name: 'autonomous-scheduler-selection',
    passed:
      schedulerSettled &&
      expectedSchedulerAction !== null &&
      schedulerSelectedAction === expectedSchedulerAction &&
      !monitor.failed,
    selectedAction: schedulerSelectedAction,
    expectedAction: expectedSchedulerAction,
    status: snapshot().state.status,
    result: snapshot().state.lastActionResult,
    note:
      'No objective or activity sequence was supplied; the session scheduler selected the top currently ranked policy-filtered candidate.'
  });
  session.aiClearGoal();
  if (schedulerSelectedAction === 'recover_health') {
    const recoverySettled = await waitForRecoveryReady();
    report.scenarios.push({
      name: 'autonomous-recovery-before-next-goal',
      passed: recoverySettled && !monitor.failed,
      result: recoverySettled
        ? `Authoritative HP met combat preflight; movement may end the rest normally (${recoveryDiagnostic()})`
        : `Recovery did not reach combat preflight health within the remaining harness runtime (${recoveryDiagnostic()})`
    });
    if (!recoverySettled)
      throw new Error('autonomous recovery did not settle before the next gameplay objective');
  }
  const inspection = await runScenario(
    'inspection',
    'Inspect my current character and room, then stop.',
    (before, after) => before === after
  );
  const inventoryInspection = await runScenario(
    'inventory-inspection',
    'Inspect my current inventory, then stop.',
    (before, after) => before === after
  );
  const inventorySafety = await session.aiAction({
    name: 'use_item',
    args: { name: '__unverified_phase4_item__' },
    reason: 'phase 4 inventory safety refusal check'
  });
  report.scenarios.push({
    name: 'inventory-safety-refusal',
    passed: !inventorySafety.ok && /refused/i.test(inventorySafety.message),
    result: inventorySafety.message
  });
  const equipmentSafety = await session.aiAction({
    name: 'manage_equipment',
    reason: 'phase 4 equipment safety refusal check'
  });
  report.scenarios.push({
    name: 'equipment-safety-refusal',
    passed: !equipmentSafety.ok && /refused/i.test(equipmentSafety.message),
    result: equipmentSafety.message
  });
  const visibleNpc = findSafeNpc(session.character.room?.occupants ?? []);
  if (visibleNpc?.npc?.name) {
    await runScenario(
      'npc-inspection',
      `Inspect the visible non-player character ${visibleNpc.npc.name}, then stop.`,
      (before, after) => before === after
    );
  } else {
    report.scenarios.push({
      name: 'npc-inspection',
      passed: true,
      result: 'Skipped safely: no authoritative visible NPC in the current room'
    });
  }
  const combatSafety = await session.aiAction({
    name: 'engage_enemy',
    args: { name: '__unverified_phase4_target__' },
    reason: 'phase 4 safety refusal check'
  });
  report.scenarios.push({
    name: 'combat-safety-refusal',
    passed: !combatSafety.ok && /refused/i.test(combatSafety.message),
    result: combatSafety.message
  });
  const arenaRoute = await navigateToWithWalker({
    destination: NEWHAVEN_ARENA,
    roomKey,
    progress: () => session.walker.progress,
    dispatch: () =>
      session.aiAction({
        name: 'navigate_to',
        args: { destination: NEWHAVEN_ARENA },
        reason: 'bounded Newhaven Arena route'
      }),
    waitFor: (predicate, timeout) => waitFor(() => predicate(), timeout),
    isError: () => snapshot().state.status === 'error'
  });
  const arenaBefore = arenaRoute.before;
  const arenaAfter = arenaRoute.after;
  monitor.room(arenaAfter);
  const arenaNavigation = arenaRoute.arrived && !monitor.failed;
  report.scenarios.push({
    name: 'newhaven-arena-navigation',
    passed: arenaNavigation,
    before: arenaBefore,
    after: arenaAfter,
    status: arenaRoute.status,
    waitCompleted: arenaRoute.waitCompleted,
    result: `${arenaRoute.dispatchMessage}; ${
      arenaRoute.waitCompleted === false
        ? 'harness wait ended before Walker completed the route'
        : (arenaRoute.reason ?? 'no Walker stop reason')
    }`
  });
  if (!arenaNavigation) {
    const reason = `Skipped because Walker did not verify arrival at ${NEWHAVEN_ARENA}`;
    for (const name of [
      'newhaven-arena-inspection',
      'newhaven-arena-health-probe',
      'newhaven-arena-target-discovery',
      'newhaven-arena-combat-preflight',
      'newhaven-arena-bounded-combat'
    ]) {
      report.scenarios.push({ name, passed: false, skipped: true, result: reason });
    }
    report.violations = monitor.violations;
    report.trace = monitor.events.slice(-50);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 1;
    return;
  }
  const arenaRoomInspection = await session.aiAction({
    name: 'inspect_room',
    reason: 'authoritative arena room inspection'
  });
  const arenaHealthInspection = await session.aiAction({
    name: 'inspect_character',
    reason: 'authoritative arena health inspection'
  });
  const healthProbeQueued = session.aiRequestHealth();
  const healthKnown = await waitFor(
    () => session.character.vitals.hp !== null && session.character.vitals.hpMax !== null,
    5_000
  );
  report.scenarios.push({
    name: 'newhaven-arena-health-probe',
    passed: healthProbeQueued && healthKnown,
    result: healthKnown
      ? 'Production Routines → CommandQueue → CharacterTracker reported authoritative health'
      : 'Production health probe completed without an authoritative current/max HP pair'
  });
  const arenaInspection = arenaNavigation && arenaRoomInspection.ok && arenaHealthInspection.ok;
  report.scenarios.push({
    name: 'newhaven-arena-inspection',
    passed: arenaInspection,
    before: arenaAfter,
    after: roomKey(),
    status: snapshot().state.status,
    result: `${arenaRoomInspection.message}; ${arenaHealthInspection.message}`
  });
  const arenaRoom = session.character.room;
  const arenaTargets = arenaRoom?.occupants?.filter(
    (occupant) => occupant.kind === 'mob' && occupant.mob?.name
  );
  report.scenarios.push({
    name: 'newhaven-arena-target-discovery',
    passed: arenaNavigation && arenaInspection,
    result: arenaTargets?.length
      ? `Observed authoritative mobs; ${summarizeCombatCandidates(arenaRoom?.occupants ?? [], session.character.combat.attackers)}`
      : 'No authoritative mob target visible in the arena'
  });
  const arenaNpc = findSafeNpc(arenaRoom?.occupants ?? []);
  if (arenaNpc?.npc?.name) {
    const npcInspection = await session.aiAction({
      name: 'inspect_npc',
      args: { name: arenaNpc.npc.name },
      reason: 'inspect the authoritatively visible arena NPC'
    });
    report.scenarios.push({
      name: 'newhaven-arena-npc-inspection',
      passed: npcInspection.ok,
      result: npcInspection.message
    });
  } else {
    report.scenarios.push({
      name: 'newhaven-arena-npc-inspection',
      passed: true,
      result:
        'Skipped safely: no authoritative room resident identity is visible; combat mobs are checked separately'
    });
  }
  const arenaTarget = findSafeCombatNpc(arenaRoom?.occupants ?? []);
  const arenaEscapeAvailable = hasMappedCombatEscape(arenaRoom);
  const arenaEligibility = assessCombatEligibility(
    arenaRoom?.occupants ?? [],
    session.character.vitals,
    arenaTarget?.name,
    MINIMUM_COMBAT_HEALTH_FRACTION,
    arenaEscapeAvailable,
    session.character.combat.attackers
  );
  report.scenarios.push({
    name: 'newhaven-arena-combat-preflight',
    passed: arenaNavigation && arenaInspection,
    result: arenaEligibility.ok
      ? `Eligible target ${arenaEligibility.target?.name}; ${summarizeCombatCandidates(arenaRoom?.occupants ?? [], session.character.combat.attackers)}; health and escape route verified`
      : `Safely refused before combat: ${arenaEligibility.reason}; ${summarizeCombatCandidates(arenaRoom?.occupants ?? [], session.character.combat.attackers)}`
  });
  if (arenaEligibility.ok && arenaEligibility.target) {
    combatVictoryEvidence = false;
    combatTargetName = arenaEligibility.target.name;
    combatTargetDied = false;
    combatEvidenceEvents.length = 0;
    combatFightEvidence.length = 0;
    monitor.authorizeCombatTarget(arenaEligibility.target.name);
    // The harness supplies the explicit authorized objective; the executor's
    // target, health, classification, and escape checks remain authoritative.
    session.aiAgent.state.objective = `Engage the verified PvE enemy ${arenaEligibility.target.name}`;
    let combatDispatch = await session.aiAction({
      name: 'engage_enemy',
      args: { name: arenaEligibility.target.name },
      reason: 'bounded authorized Newhaven Arena PvE test'
    });
    if (!combatDispatch.ok) {
      const approval = exactCombatApproval(
        snapshot().state.pendingApprovals,
        arenaEligibility.target.name
      );
      if (approval) {
        session.aiApprove(approval.id);
        const approvalSettled = await waitFor(
          (state) =>
            state.approvalHistory.some(
              (entry) =>
                entry.id === approval.id &&
                ['executed', 'rejected', 'expired'].includes(entry.status)
            ),
          5_000
        );
        const approvedState = snapshot().state;
        const approvalResult = approvedState.approvalHistory.find(
          (entry) => entry.id === approval.id
        );
        combatDispatch = {
          ok: approvalSettled && approvalResult?.status === 'executed',
          message:
            approvalResult?.status === 'executed'
              ? 'Exact-target combat approval executed through SessionManager'
              : 'The exact-target combat approval did not complete'
        };
      }
    }

    let combatObserved = false;
    let outcome = 'unknown';
    let combatUnresolved = false;
    if (combatDispatch.ok) {
      session.aiRequestHealth();
      combatObserved = await waitFor(
        () =>
          combatVictoryEvidence ||
          session.character.combat.engaged ||
          session.character.combat.target !== null ||
          session.character.combat.attackers.length > 0,
        5_000
      );
      const settlement = await waitForCombatSettlement({
        combat: () => session.character.combat,
        vitals: () => session.character.vitals,
        wait,
        isStopped: () => {
          monitor.check();
          return monitor.failed;
        },
        timeoutMs: Math.max(0, monitor.limits.maxRuntimeMs - monitor.elapsedRuntimeMs)
      });
      outcome = settlement.outcome;
      combatUnresolved = settlement.unresolved;
      if (settlement.unresolved) session.aiEmergencyStop();
      combatBlocksNavigation = settlement.unresolved || outcome === 'unsafe';
      combatObserved ||= combatVictoryEvidence || session.character.combat.engaged;
    }
    const combatResult = combatVictoryEvidence
      ? combatUnresolved
        ? 'victory evidence; combat unresolved'
        : 'victory'
      : outcome;
    report.scenarios.push({
      name: 'newhaven-arena-bounded-combat',
      passed:
        combatDispatch.ok &&
        combatObserved &&
        outcome !== 'unsafe' &&
        !combatUnresolved &&
        !monitor.failed,
      result: `${combatDispatch.message}; observed=${combatObserved}; outcome=${combatResult}; unresolved=${combatUnresolved}; targetDeathObserved=${combatTargetDied}; xpVictory=${combatVictoryEvidence}; ${combatDiagnostic()}`
    });

    if (combatObserved && outcome === 'ended' && !combatUnresolved) {
      const hp = session.character.vitals.hp;
      const hpMax = session.character.vitals.hpMax;
      if (hp === null || hpMax === null || hpMax <= 0) {
        recoveryBlocksNavigation = true;
        report.scenarios.push({
          name: 'newhaven-arena-post-combat-recovery',
          passed: false,
          result: 'Recovery readiness is unknown because authoritative HP is unavailable'
        });
      } else if (hp / hpMax < profile.config.automation.health.restBelow) {
        const commandsBeforeRecovery = monitor.events.length;
        monitor.authorizeRecovery();
        const recovery = await session.aiAction({
          name: 'recover_health',
          reason: 'bounded post-combat recovery'
        });
        const restTarget = profile.config.automation.health.restTo;
        const recoveryReady = await waitForRecoveryFraction(restTarget);
        const restCommandObserved = monitor.events
          .slice(commandsBeforeRecovery)
          .some((event) => event.kind === 'command' && /^rest$/i.test(event.value));
        recoveryBlocksNavigation = !recoveryReady;
        report.scenarios.push({
          name: 'newhaven-arena-post-combat-recovery',
          passed: recovery.ok && restCommandObserved && recoveryReady && !monitor.failed,
          result: `${recovery.message}; restCommandObserved=${restCommandObserved}; restTargetReached=${recoveryReady}; target=${Math.round(restTarget * 100)}%; ${recoveryDiagnostic()}`
        });
      } else if (hp < hpMax) {
        report.scenarios.push({
          name: 'newhaven-arena-post-combat-recovery',
          passed: true,
          result: `Rest not due; no live recovery claim. HP=${hp}/${hpMax} is above restBelow=${profile.config.automation.health.restBelow}; ${recoveryDiagnostic()}`
        });
      } else {
        report.scenarios.push({
          name: 'newhaven-arena-post-combat-recovery',
          passed: hp !== null && hpMax !== null,
          result: 'Recovery not required; authoritative HP is already at maximum'
        });
      }
      const inventory = await session.aiAction({
        name: 'inspect_inventory',
        reason: 'bounded post-combat inventory verification'
      });
      report.scenarios.push({
        name: 'newhaven-arena-post-combat-inventory',
        passed: inventory.ok && !monitor.failed,
        result: `${inventory.message}; items=${session.character.inventory.items.length}`
      });
      session.aiAgent.state.objective = 'Evaluate ordinary equipment after combat';
      const equipment = await session.aiAction({
        name: 'manage_equipment',
        reason: 'bounded post-combat equipment evaluation'
      });
      const equipmentApproval = snapshot().state.pendingApprovals.some(
        (pending) => pending.action?.name === 'manage_equipment'
      );
      report.scenarios.push({
        name: 'newhaven-arena-post-combat-equipment',
        passed: !equipment.ok && equipmentApproval,
        result: equipmentApproval
          ? 'Equipment action remained approval-gated and was not approved by this run'
          : equipment.message
      });
    } else {
      const reason = combatObserved
        ? combatUnresolved
          ? 'Skipped because authoritative attackers remain; no post-combat action was issued'
          : `Skipped because combat remained ${outcome}; no post-combat action was issued`
        : 'Skipped because no combat engagement was authoritatively observed';
      for (const name of [
        'newhaven-arena-post-combat-recovery',
        'newhaven-arena-post-combat-inventory',
        'newhaven-arena-post-combat-equipment'
      ]) {
        report.scenarios.push({ name, passed: true, skipped: true, result: reason });
      }
    }
  }
  if (combatBlocksNavigation || recoveryBlocksNavigation) {
    for (const name of ['one-room-navigation', 'two-room-navigation']) {
      report.scenarios.push({
        name,
        passed: true,
        skipped: true,
        result: combatBlocksNavigation
          ? 'Skipped because combat remained active or the character was dead; no route was requested'
          : 'Skipped because authoritative recovery did not reach the combat health threshold'
      });
    }
  } else {
    await runScenario(
      'one-room-navigation',
      'Explore one adjacent room using an available exit, then stop.',
      (before, after) => before !== after
    );
    const current = session.character.room;
    const twoRoomTarget =
      current?.map !== undefined && current.number !== undefined
        ? [...world.withinSteps(roomId(current.map, current.number), 2).entries()].find(
            ([target, distance]) => {
              if (distance !== 2) return false;
              const route = world.route(roomId(current.map, current.number), target);
              return !route.blocked && route.steps.length === 2;
            }
          )?.[0]
        : undefined;
    if (twoRoomTarget === undefined)
      throw new Error('Could not find a bounded two-room target from the authoritative room');
    multiRoomTarget = twoRoomTarget;
    await runScenario(
      'two-room-navigation',
      `Navigate to the authoritative destination ${twoRoomTarget}, then stop.`,
      (_before, after) => after === twoRoomTarget
    );
  }
  const residentDestination = roomId(1, 2147);
  const residentRoom = world.byId(residentDestination);
  const expectedResident = residentRoom ? world.buildNpcEntity(residentRoom) : null;
  if (
    expectedResident &&
    !combatBlocksNavigation &&
    !recoveryBlocksNavigation &&
    !monitor.failed
  ) {
    const residentRoute = await navigateToWithWalker({
      destination: NEWHAVEN_ADVENTURERS_GUILD,
      roomKey,
      progress: () => session.walker.progress,
      dispatch: () =>
        session.aiAction({
          name: 'navigate_to',
          args: { destination: NEWHAVEN_ADVENTURERS_GUILD },
          reason: "bounded route to the realm-mapped Newhaven Adventurers' Guild resident"
        }),
      waitFor: (predicate, timeout) => waitFor(() => predicate(), timeout),
      isError: () => snapshot().state.status === 'error'
    });
    const residentArrived = residentRoute.arrived && !monitor.failed;
    monitor.room(residentRoute.after);
    report.scenarios.push({
      name: 'newhaven-resident-navigation',
      passed: residentArrived,
      before: residentRoute.before,
      after: residentRoute.after,
      status: residentRoute.status,
      waitCompleted: residentRoute.waitCompleted,
      result: `${residentRoute.dispatchMessage}; ${
        residentRoute.waitCompleted === false
          ? 'harness wait ended before Walker completed the route'
          : (residentRoute.reason ?? 'no Walker stop reason')
      }`
    });
    if (residentArrived) {
      await session.aiAction({
        name: 'inspect_room',
        reason: 'observe the realm-mapped resident room'
      });
      const visibleResident = await waitFor(
        () =>
          roomKey() === NEWHAVEN_ADVENTURERS_GUILD &&
          findSafeNpc(session.character.room?.occupants ?? [], expectedResident.name) !== null,
        5_000
      );
      const residentOccupant = visibleResident
        ? findSafeNpc(session.character.room?.occupants ?? [], expectedResident.name)
        : undefined;
      if (residentOccupant?.npc?.name) {
        const npcInspection = await session.aiAction({
          name: 'inspect_npc',
          args: { name: residentOccupant.npc.name },
          reason: 'inspect the server-listed resident in the mapped shop room'
        });
        report.scenarios.push({
          name: 'newhaven-resident-inspection',
          passed: npcInspection.ok,
          result: npcInspection.message
        });
      } else {
        report.scenarios.push({
          name: 'newhaven-resident-inspection',
          passed: true,
          skipped: true,
          result: `Skipped safely: room observation did not list ${expectedResident.name} as an NPC occupant`
        });
      }
    } else {
      report.scenarios.push({
        name: 'newhaven-resident-inspection',
        passed: true,
        skipped: true,
        result: `Skipped safely: Walker did not verify arrival at ${NEWHAVEN_ADVENTURERS_GUILD}`
      });
    }
  } else {
    const residentSkipReason =
      combatBlocksNavigation || recoveryBlocksNavigation || monitor.failed
        ? 'Skipped because combat or recovery is unresolved; no movement was requested'
        : `Skipped: the loaded realm has no resident identity at ${NEWHAVEN_ADVENTURERS_GUILD}`;
    report.scenarios.push({
      name: 'newhaven-resident-navigation',
      passed: true,
      skipped: true,
      result: residentSkipReason
    });
    report.scenarios.push({
      name: 'newhaven-resident-inspection',
      passed: true,
      skipped: true,
      result: residentSkipReason
    });
  }
  if (combatBlocksNavigation || recoveryBlocksNavigation || monitor.failed) {
    report.scenarios.push({
      name: 'integrated-arena-objective',
      passed: !monitor.failed,
      skipped: true,
      result: 'Skipped because prior combat or recovery is unresolved; no objective was launched'
    });
  } else {
    await runIntegratedAdventureObjective();
  }
  const invalid = await session.aiAction({
    name: 'navigate_to',
    args: { destination: '999/999999' },
    reason: 'harness invalid destination check'
  });
  report.scenarios.push({
    name: 'invalid-destination',
    passed: !invalid.ok,
    result: invalid.message
  });
  const unknown = await session.aiAction({
    name: 'execute_supported_command',
    args: { command: 'check status' },
    reason: 'harness unknown-command approval check'
  });
  report.scenarios.push({
    name: 'unknown-command-approval',
    passed: unknown.ok === false && unknown.message.toLowerCase().includes('approval'),
    result: unknown.message
  });
  session.aiEmergencyStop();
  session.aiGoal('Explore one adjacent room using an available exit, then stop.');
  await wait(500);
  session.send('look\r');
  await wait(500);
  const manualLook = monitor.events.some(
    (event) => event.kind === 'command' && event.value.toLowerCase() === 'look'
  );
  session.aiEmergencyStop();
  report.scenarios.push({
    name: 'manual-interruption',
    passed: manualLook,
    result: manualLook
      ? 'Manual look executed while AI objective was active'
      : 'Manual look was not observed'
  });
  session.aiBudget({ sessionTokens: 100 });
  session.aiGoal('Observe the current room, then stop.');
  const budgetPaused = await waitFor((state) => state.status === 'budget-paused', 5_000);
  const budgetState = snapshot().state;
  report.scenarios.push({
    name: 'budget-enforcement',
    passed: budgetPaused && budgetState.status === 'budget-paused',
    result: budgetState.lastActionResult
  });
  session.aiBudget({ sessionTokens: 25_000 });
  const emergency = session.aiEmergencyStop();
  report.scenarios.push({
    name: 'emergency-stop',
    passed: emergency.state.status === 'stopped' || emergency.state.status === 'disabled',
    result: emergency.state.lastActionResult
  });
  report.violations = monitor.violations;
  report.trace = monitor.events.slice(-50);
  console.log(JSON.stringify(report, null, 2));
  if (report.scenarios.some((item) => !item.passed) || report.violations.length)
    process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  report.violations.push({
    code: 'stall',
    message: error instanceof Error ? error.message : String(error)
  });
  if (combatStartedAt !== null && combatTargetName !== null) {
    const diagnostic = {
      profile: profile.id,
      scenario: 'bounded-provider-free-pve-probe',
      phase: 'harness-error-before-cleanup',
      target: combatTargetName,
      targetIdentity: combatTargetIdentity,
      eligibilityReason: combatEligibilityReason,
      combatCommands: [...combatCommands],
      combatEvidenceEvents: [...combatEvidenceEvents],
      combatFightEvidence: [...combatFightEvidence],
      combatSnapshots: [...combatSnapshots, currentCombatSnapshot()].slice(-24),
      targetDied: combatTargetDied,
      experienceObserved: combatVictoryEvidence,
      currentState: currentCombatSnapshot()
    };
    report.combatDiagnostic = diagnostic;
    if (pveScenarioIndex !== null) {
      report.scenarios[pveScenarioIndex] = {
        ...report.scenarios[pveScenarioIndex],
        phase: 'harness-error-before-cleanup',
        targetDied: combatTargetDied,
        experienceObserved: combatVictoryEvidence,
        currentState: diagnostic.currentState,
        combatEvidenceEvents: diagnostic.combatEvidenceEvents,
        combatFightEvidence: diagnostic.combatFightEvidence
      };
    }
    try {
      diagnostic.diagnosticArtifact = persistCombatDiagnostic(diagnostic);
    } catch (diagnosticError) {
      report.combatDiagnosticPersistenceError =
        diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError);
    }
  }
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  session.disconnect();
  session.dispose();
}
