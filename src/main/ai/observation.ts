/** Remove fields that are carried separately in the AI observation contract. */
export function compactCharacterObservation<
  T extends { room: unknown; inventory: unknown }
>(state: T): Omit<T, 'room' | 'inventory'> {
  const { room: _room, inventory: _inventory, ...character } = state;
  return character;
}
