import { describe, expect, it } from 'vitest';
import {
  advanceObjectivePlan,
  buildObjectivePlan,
  objectivePlanComplete,
  replanObjectivePlan,
  skipUnavailableOptionalSteps
} from '../ObjectivePlan';
import { hasUnsupportedObjectiveIntent } from '../objectiveIntents';

describe('bounded objective planning', () => {
  it('decomposes a destination and inspection objective in order', () => {
    const plan = buildObjectivePlan('Go to 1/2141, inspect the room, then stop.');
    expect(plan.map((step) => step.action)).toEqual(['navigate_to', 'inspect_room']);
    expect(plan[0]).toMatchObject({ destination: '1/2141', status: 'pending' });
  });

  it('does not mistake send_message instructions for item use', () => {
    const replyGoal =
      'Reply to incoming gossip. Use send_message with channel gossip; do not use another channel.';
    expect(buildObjectivePlan(replyGoal)).toEqual([]);
    expect(buildObjectivePlan('Use the healing potion when HP is low.').map(({ action }) => action))
      .toEqual(['use_item']);
  });

  it('advances only the matching step and exposes the next step', () => {
    let plan = buildObjectivePlan('Navigate to 1/2 and inspect my inventory.');
    plan[0]!.status = 'active';
    plan = advanceObjectivePlan(plan, 'navigate_to', true);
    expect(plan.map((step) => step.status)).toEqual(['completed', 'active']);
    plan = advanceObjectivePlan(plan, 'inspect_inventory', true);
    expect(objectivePlanComplete(plan)).toBe(true);
  });

  it('blocks failed steps and never marks the objective complete', () => {
    let plan = buildObjectivePlan('Recover health, then inspect my room.');
    plan[0]!.status = 'active';
    plan = advanceObjectivePlan(plan, 'recover_health', false);
    expect(plan[0]!.status).toBe('blocked');
    expect(objectivePlanComplete(plan)).toBe(false);
  });

  it('does not skip an active prerequisite when a later action is proposed', () => {
    let plan = buildObjectivePlan('Navigate to 1/2 and inspect my inventory.');
    plan[0]!.status = 'active';
    plan = advanceObjectivePlan(plan, plan[1]!.action, true);
    expect(plan.map((step) => step.status)).toEqual(['active', 'pending']);
  });

  it('does not activate later steps after a failed prerequisite', () => {
    let plan = buildObjectivePlan('Navigate to 1/2 and inspect my inventory.');
    plan[0]!.status = 'active';
    plan = advanceObjectivePlan(plan, plan[0]!.action, false);
    expect(plan.map((step) => step.status)).toEqual(['blocked', 'pending']);
  });

  it('plans room discovery before inspecting a suitable NPC', () => {
    const plan = buildObjectivePlan('Find a non-player character here and inspect the NPC safely.');
    expect(plan.map((step) => step.action)).toEqual(['inspect_room', 'inspect_npc']);
  });

  it('plans verified target inspection before controlled PvE and result review', () => {
    const plan = buildObjectivePlan('Find an NPC, engage in combat, then recover health.');
    expect(plan.map((step) => step.action)).toEqual([
      'inspect_room',
      'inspect_npc',
      'engage_enemy',
      'inspect_combat_result',
      'recover_health'
    ]);
  });

  it('skips only explicitly optional combat after authoritative target absence', () => {
    let plan = buildObjectivePlan(
      'Find an NPC, inspect it, and fight a suitable hostile mob if one is available.'
    );
    expect(plan.map((step) => step.action)).toEqual([
      'inspect_room',
      'inspect_npc',
      'engage_enemy',
      'inspect_combat_result'
    ]);
    expect(plan.slice(2).every((step) => step.optional)).toBe(true);
    plan[0]!.status = 'completed';
    plan[1]!.status = 'completed';
    plan[2]!.status = 'active';

    plan = skipUnavailableOptionalSteps(plan, 'engage_enemy');

    expect(plan.map((step) => step.status)).toEqual([
      'completed',
      'completed',
      'skipped',
      'skipped'
    ]);
    expect(objectivePlanComplete(plan)).toBe(true);
  });

  it('plans a bounded navigation, observation, optional PvE, result, and recovery objective', () => {
    const plan = buildObjectivePlan(
      'Navigate to 1/2150, inspect the room, engage a suitable hostile mob if available, assess the combat result, recover health, then stop.'
    );

    expect(plan.map((step) => step.action)).toEqual([
      'navigate_to',
      'inspect_room',
      'engage_enemy',
      'inspect_combat_result',
      'recover_health'
    ]);
    expect(plan[0]).toMatchObject({ destination: '1/2150' });
    expect(plan[2]?.optional).toBe(true);
    expect(plan[3]?.optional).toBe(true);
  });

  it('does not accept partially recognized quest objectives as fully schedulable intent', () => {
    expect(
      hasUnsupportedObjectiveIntent('Travel to 1/2, inspect the room, then finish the quest.')
    ).toBe(true);
    expect(hasUnsupportedObjectiveIntent('Find an NPC, inspect it, and explore.')).toBe(false);
  });

  it('keeps a multi-capability objective in prerequisite order', () => {
    const plan = buildObjectivePlan(
      'Navigate to 1/2, inspect the room and inventory, engage an NPC, inspect combat, recover health, then manage equipment.'
    );
    expect(plan.map((step) => step.action)).toEqual([
      'navigate_to',
      'inspect_room',
      'inspect_inventory',
      'inspect_npc',
      'engage_enemy',
      'inspect_combat_result',
      'recover_health',
      'manage_equipment'
    ]);
  });

  it('replans a blocked step without discarding completed prerequisites', () => {
    let plan = buildObjectivePlan('Navigate to 1/2 and inspect my room.');
    plan[0]!.status = 'completed';
    plan[1]!.status = 'blocked';
    plan = replanObjectivePlan(plan);
    expect(plan.map((step) => step.status)).toEqual(['completed', 'active']);
  });
});
