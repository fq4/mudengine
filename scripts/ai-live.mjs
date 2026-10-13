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
import { LiveHarnessMonitor } from '../src/main/ai/LiveHarness.ts';
import { homePaths } from './lib/home.mjs';
import fs from 'node:fs';
import YAML from 'yaml';
import { resolveProfile } from '../src/shared/profiles.ts';
import { roomId } from '../src/shared/world.ts';

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

const monitor = new LiveHarnessMonitor({
  maxRuntimeMs: Number(valueOf('--max-ms') ?? 120_000),
  maxMoves: Number(valueOf('--max-moves') ?? 4),
  maxRequests: Number(valueOf('--max-requests') ?? 8),
  maxTokens: Number(valueOf('--max-tokens') ?? 30_000),
  maxCostUsd: Number(valueOf('--max-cost') ?? 0.05),
  maxRepeatedAction: 2
});
const lines = [];
let currentRoom = null;
let multiRoomTarget = null;
const sink = {
  data: () => {},
  block: () => {},
  state: () => {},
  telnet: () => {},
  notice: () => {},
  line: (line) => {
    if (currentRoom !== null && line.plain.trim()) lines.push(line.plain.trim().slice(0, 240));
  },
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
    idle: { ...profile.config.automation.idle, enabled: false },
    rules: []
  },
  profile.config.connection.login
);
session.resize({ cols: 100, rows: 30 });

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

async function main() {
  monitor.start();
  console.log(`AI live test -> ${profile.id} (credentials withheld)`);
  await session.connect(profile.target);
  const connected = await waitFor(() => session.character.phase === 'in-game');
  if (!connected) throw new Error(`did not reach in-game state: ${session.character.phase}`);
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
  const navigation = await runScenario(
    'one-room-navigation',
    'Explore one adjacent room using an available exit, then stop.',
    (before, after) => before !== after
  );
  const current = session.character.room;
  const twoRoomTarget =
    current?.map !== undefined && current.number !== undefined
      ? [...world.withinSteps(roomId(current.map, current.number), 2).entries()]
          .find(([target, distance]) => {
            if (distance !== 2) return false;
            const route = world.route(roomId(current.map, current.number), target);
            return !route.blocked && route.steps.length === 2;
          })?.[0]
      : undefined;
  if (twoRoomTarget === undefined)
    throw new Error('Could not find a bounded two-room target from the authoritative room');
  multiRoomTarget = twoRoomTarget;
  const multiRoom = await runScenario(
    'two-room-navigation',
    `Navigate to the authoritative destination ${twoRoomTarget}, then stop.`,
    (_before, after) => after === twoRoomTarget
  );
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
