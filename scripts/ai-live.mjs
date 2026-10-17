/**
 * Explicit, bounded live verification of the production AI execution path.
 *
 * This file deliberately does nothing unless --live is supplied:
 *   npm run test:ai-live -- --live --profile kefka
 *
 * The runner never prints credentials or raw login traffic. It only permits
 * inspection and movement, and exits as soon as a safety limit is reached.
 */
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { SessionManager } from '../src/main/session/SessionManager.ts';
import { RealmLibrary } from '../src/main/world/RealmLibrary.ts';
import {
  exactCombatApproval,
  LiveHarnessMonitor,
  navigateToWithWalker,
  waitForCombatSettlement,
  waitForRecoveryHealth
} from '../src/main/ai/LiveHarness.ts';
import { homePaths } from './lib/home.mjs';
import fs from 'node:fs';
import YAML from 'yaml';
import { resolveProfile } from '../src/shared/profiles.ts';
import { roomId } from '../src/shared/world.ts';
import { assessCombatEligibility } from '../src/main/ai/CombatSafety.ts';
import { findSafeCombatNpc } from '../src/main/ai/NpcDiscovery.ts';

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
const gossipReplyTest = has('--gossip-reply-test');
const requestedRuntimeMs = Number(valueOf('--max-ms') ?? 120_000);
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
if (!process.env.OPENROUTER_API_KEY)
  throw new Error('OPENROUTER_API_KEY is not present in the environment');

const NEWHAVEN_ARENA = '1/2150';

const monitor = new LiveHarnessMonitor({
  maxRuntimeMs: requestedRuntimeMs,
  maxMoves: gossipReplyTest ? 0 : Number(valueOf('--max-moves') ?? 12),
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
let combatTargetDied = false;
let combatBlocksNavigation = false;
let recoveryBlocksNavigation = false;
let currentRoom = null;
let multiRoomTarget = null;
const loginBlockCounts = new Map();
const sink = {
  data: () => {},
  block: (block) => {
    if (session.character.phase !== 'in-game' && loginBlockCounts.size < 12)
      loginBlockCounts.set(block.type, (loginBlockCounts.get(block.type) ?? 0) + 1);
    if (block.type === 'user-gain-experience') combatVictoryEvidence = true;
    if (
      block.type === 'mob-dies' &&
      combatTargetName !== null &&
      block.groups.mob?.trim().toLowerCase() === combatTargetName.trim().toLowerCase()
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
  command: (command) => monitor.command(command)
};

const home = configuredHome;
const realms = new RealmLibrary({
  shippedDir: path.join(process.cwd(), 'resources', 'world'),
  resourcesDir: path.join(process.cwd(), 'resources'),
  cacheDir: path.join(home.root, 'state', 'realms'),
  notify: () => {}
});
const world = realms.load(profile.database ?? '').graph;
const session = new SessionManager(
  sink,
  world,
  {
    ...profile.config.automation,
    // Entry probes can overlap with room exits (notably "st"); keep the social run motionless.
    onEnterRealm: gossipReplyTest ? [] : profile.config.automation.onEnterRealm,
    idle: { ...profile.config.automation.idle, enabled: false },
    rules: []
  },
  profile.config.connection.login
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
  const room = session.character.room;
  return room?.map !== undefined && room?.number !== undefined
    ? `${room.map}/${room.number}`
    : (room?.name ?? '');
};
const snapshot = () => session.aiSnapshot;
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
const waitForRecoveryReady = () =>
  waitForRecoveryHealth({
    vitals: () => session.character.vitals,
    combatActive: () =>
      session.character.combat.engaged || session.character.combat.attackers.length > 0,
    wait,
    isStopped: () => {
      monitor.check();
      return monitor.failed;
    },
    minimumFraction: 0.6,
    timeoutMs: Math.max(0, monitor.limits.maxRuntimeMs - monitor.elapsedRuntimeMs),
    pollIntervalMs: 250
  });
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
    `parsedBlockTypes=${[...loginBlockCounts]
      .map(([type, count]) => `${type}:${count}`)
      .join(',') || 'none'}`
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
  monitor.authorizeRecovery();
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
  const roomKnown = await waitFor(() => /^\d+\/\d+$/.test(roomKey()), 30_000);
  if (!roomKnown) {
    const result = loginDiagnostic();
    report.scenarios.push({
      name: 'login-room-identity',
      passed: false,
      result
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
  const visibleNpc = session.character.room?.occupants?.find(
    (occupant) => occupant.kind !== 'player' && occupant.npc?.name
  );
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
      ? `Observed ${arenaTargets.length} authoritative mob target(s); combat remains policy-gated`
      : 'No authoritative mob target visible in the arena'
  });
  const arenaNpc = arenaRoom?.occupants?.find(
    (occupant) => occupant.kind === 'npc' && occupant.npc?.name
  );
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
        'Skipped safely: no inspectable room resident (occupant kind "npc") is visible; combat mobs are checked separately'
    });
  }
  const arenaTarget = findSafeCombatNpc(arenaRoom?.occupants ?? []);
  const arenaEscapeAvailable =
    arenaRoom?.exits?.some(
      (exit) => exit.targetMap !== null && exit.targetRoom !== null && exit.requirement === null
    ) ?? false;
  const arenaEligibility = assessCombatEligibility(
    arenaRoom?.occupants ?? [],
    session.character.vitals,
    arenaTarget?.name,
    0.6,
    arenaEscapeAvailable
  );
  report.scenarios.push({
    name: 'newhaven-arena-combat-preflight',
    passed: arenaNavigation && arenaInspection,
    result: arenaEligibility.ok
      ? `Eligible target ${arenaEligibility.target?.name}; health and escape route verified`
      : `Safely refused before combat: ${arenaEligibility.reason}`
  });
  if (arenaEligibility.ok && arenaEligibility.target) {
    combatVictoryEvidence = false;
    combatTargetName = arenaEligibility.target.name;
    combatTargetDied = false;
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
    if (combatDispatch.ok) {
      session.aiRequestHealth();
      combatObserved = await waitFor(
        () =>
          combatVictoryEvidence ||
          session.character.combat.engaged ||
          session.character.combat.target !== null,
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
      if (settlement.unresolved) session.aiEmergencyStop();
      combatBlocksNavigation = settlement.unresolved || outcome === 'unsafe';
      combatObserved ||= combatVictoryEvidence || session.character.combat.engaged;
    }
    const combatResult = combatVictoryEvidence ? 'victory' : outcome;
    report.scenarios.push({
      name: 'newhaven-arena-bounded-combat',
      passed:
        combatDispatch.ok && combatObserved && outcome !== 'unsafe' && !monitor.failed,
      result: `${combatDispatch.message}; observed=${combatObserved}; outcome=${combatResult}; targetDeathObserved=${combatTargetDied}; xpVictory=${combatVictoryEvidence}; ${combatDiagnostic()}`
    });

    if (combatObserved && outcome === 'ended') {
      const hp = session.character.vitals.hp;
      const hpMax = session.character.vitals.hpMax;
      if (hp === null || hpMax === null || hpMax <= 0) {
        recoveryBlocksNavigation = true;
        report.scenarios.push({
          name: 'newhaven-arena-post-combat-recovery',
          passed: false,
          result: 'Recovery readiness is unknown because authoritative HP is unavailable'
        });
      } else if (hp < hpMax) {
        monitor.authorizeRecovery();
        const recovery = await session.aiAction({
          name: 'recover_health',
          reason: 'bounded post-combat recovery'
        });
        const recoveryReady = await waitForRecoveryReady();
        recoveryBlocksNavigation = !recoveryReady;
        report.scenarios.push({
          name: 'newhaven-arena-post-combat-recovery',
          passed: recovery.ok && recoveryReady && !monitor.failed,
          result: `${recovery.message}; combatReadyHealth=${recoveryReady}; target=60%; ${recoveryDiagnostic()}`
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
        ? `Skipped because combat remained ${outcome}; no post-combat action was issued`
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
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  session.disconnect();
  session.dispose();
}
