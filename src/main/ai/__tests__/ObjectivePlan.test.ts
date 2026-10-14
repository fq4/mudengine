import { describe, expect, it } from 'vitest';
import { advanceObjectivePlan, buildObjectivePlan, objectivePlanComplete } from '../ObjectivePlan';

describe('bounded objective planning', () => {
  it('decomposes a destination and inspection objective in order', () => {
    const plan = buildObjectivePlan('Go to 1/2141, inspect the room, then stop.');
    expect(plan.map((step) => step.action)).toEqual(['navigate_to', 'inspect_room']);
    expect(plan[0]).toMatchObject({ destination: '1/2141', status: 'pending' });
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
});
