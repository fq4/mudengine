import type { ItemEntity } from '../../shared/entities';

export type ItemUseEligibility =
  { ok: true; item: ItemEntity; reason: string } | { ok: false; reason: string };

/** Match only the authoritative carried listing; never fuzzy-match an item. */
export function carriedItemByExactName(
  items: readonly ItemEntity[],
  requested: string
): ItemEntity | null {
  const name = requested.trim().toLowerCase();
  return name.length === 0
    ? null
    : (items.find((item) => item.name.trim().toLowerCase() === name) ?? null);
}

/** Conservative ordinary-item preflight used before an approved use command. */
export function assessItemUse(items: readonly ItemEntity[], requested: string): ItemUseEligibility {
  const item = carriedItemByExactName(items, requested);
  if (!item) return { ok: false, reason: 'item is not present in the authoritative inventory' };
  if (item.id === undefined && (!item.ids || item.ids.length === 0))
    return { ok: false, reason: 'item identity is not authoritative' };
  if (item.equipped)
    return { ok: false, reason: 'equipped items cannot be consumed by this action' };
  if (item.charges !== null && item.charges <= 0)
    return { ok: false, reason: 'item has no remaining uses' };
  if (item.notDroppable) return { ok: false, reason: 'protected items require manual handling' };
  return { ok: true, item, reason: 'identified carried item is eligible for supervised use' };
}
