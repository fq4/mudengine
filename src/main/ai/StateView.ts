import type { AiActionName, AiCharacterView, AiNavigationView, AiRoomView, AiStateView, AiKnown } from '../../shared/ai';
import type { CharacterState } from '../../shared/character';
import type { WalkProgress } from '../../shared/walk';

const known = <T>(value: T | null, observedAt: number | null): AiKnown<T> => ({ value, observedAt });

export function aiStateView(character: CharacterState, navigation: WalkProgress, event: string | null = null, now = Date.now()): AiStateView {
  const inventory = character.inventory;
  const view: AiCharacterView = {
    phase: character.phase, realm: character.realm, name: character.name,
    race: character.race, className: character.className,
    vitals: {
      hp: known(character.vitals.hp, character.vitals.hp === null ? null : now),
      hpMax: known(character.vitals.hpMax, character.vitals.hpMax === null ? null : now),
      mana: known(character.vitals.mana, character.vitals.mana === null ? null : now),
      manaMax: known(character.vitals.manaMax, character.vitals.manaMax === null ? null : now),
      manaType: character.vitals.manaType, resting: character.vitals.resting, meditating: character.vitals.meditating
    },
    progress: {
      level: known(character.progress.level, character.progress.level === null ? null : now),
      exp: known(character.progress.exp, character.progress.exp === null ? null : now),
      expNeeded: known(character.progress.expNeeded, character.progress.expNeeded === null ? null : now),
      lives: known(character.progress.lives, character.progress.lives === null ? null : now)
    },
    stats: { strength: character.progress.strength, intellect: character.progress.intellect, willpower: character.progress.willpower, agility: character.progress.agility, health: character.progress.health, charm: character.progress.charm, perception: character.progress.perception, stealth: character.progress.stealthSkill, thievery: character.progress.thievery, traps: character.progress.traps, tracking: character.progress.tracking, spellcasting: character.progress.spellcasting, armourClass: character.progress.armourClass, damageResist: character.progress.damageResist, magicResist: character.progress.magicRes, martialArts: character.progress.martialArts },
    conditions: {
      inCombat: character.inCombat, mortallyWounded: character.mortallyWounded, afflictions: character.afflictions,
      buffs: character.buffs.slice(-20).map((buff) => ({ spell: buff.spell, appliedAt: buff.appliedAt, expiresAt: buff.expiresAt ?? null }))
    },
    combat: { engaged: character.combat.engaged, target: character.combat.target, attackers: character.combat.attackers.slice(), health: character.combat.health ? { name: character.combat.health.name, remaining: character.combat.health.remaining, observed: character.combat.health.observed } : null, blows: character.combat.blows },
    inventory: {
      knownAt: inventory.listedAt,
      items: inventory.items.map((item) => ({ name: item.name, quantity: item.count ?? null, equipped: item.equipped, slot: item.slot })),
      wealth: known(inventory.wealth, inventory.wealth === null ? null : inventory.listedAt),
      encumbrance: known(inventory.encumbrance, inventory.encumbrance === null ? null : inventory.listedAt),
      encumbranceMax: known(inventory.encumbranceMax, inventory.encumbranceMax === null ? null : inventory.listedAt), keys: [...inventory.keys]
    },
    abilities: {
      spellsKnownAt: character.spellbook === null ? null : now,
      spells: (character.spellbook ?? []).map((spell) => ({ name: spell.name, short: spell.short, level: spell.level, cost: spell.cost })),
      abilitiesKnownAt: character.abilities === null ? null : character.abilities.at
    }
  };
  const room: AiRoomView = {
    knownAt: character.room.arrival || null, map: character.room.map, number: character.room.number, name: character.room.name,
    description: character.room.description, light: character.room.light,
    exits: character.room.exits.map((exit) => ({ direction: exit.direction, destination: exit.targetMap !== null && exit.targetRoom !== null ? { map: exit.targetMap, room: exit.targetRoom } : null, note: exit.note })),
    occupants: character.room.occupants.map(({ name, kind, disposition, uncertain, charmed, hidden }) => ({ name, kind, disposition, uncertain, charmed, hidden })),
    items: character.room.items.map((item) => ({ name: item.name, quantity: item.count ?? null }))
  };
  const walk: AiNavigationView = { status: navigation.status, destination: navigation.destination, destinationRoom: navigation.destinationRoom, done: navigation.done, total: navigation.total, ahead: navigation.ahead.slice(0, 25), reason: navigation.reason, hold: navigation.hold };
  return { capturedAt: now, character: view, room, navigation: walk, presence: { online: character.online.map((player) => player.name).slice(0, 50), here: character.room.occupants.filter((occupant) => occupant.kind === 'player').map((occupant) => occupant.name) }, event };
}

export function describeAiInspection(action: AiActionName, view: AiStateView): string {
  const detail = action === 'inspect_character' ? view.character
    : action === 'inspect_room' ? view.room
      : action === 'inspect_inventory' ? view.character.inventory
        : action === 'inspect_map' ? view.navigation
          : { combat: view.character.conditions, navigation: view.navigation };
  return JSON.stringify(detail);
}
