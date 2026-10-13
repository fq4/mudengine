/** Only events that can change an AI strategy should wake the provider. */
export function isMeaningfulAiEvent(event: string): boolean {
  return (
    event.startsWith('conversation-gossip') ||
    event.startsWith('conversation-broadcast') ||
    event.startsWith('conversation-directed') ||
    event.startsWith('conversation-local') ||
    event.startsWith('conversation-telepath') ||
    event.startsWith('conversation-gangpath') ||
    event.startsWith('conversation-auction') ||
    event === 'mob-dies' ||
    event === 'user-dies' ||
    event === 'user-gain-experience' ||
    event === 'room-exits' ||
    event === 'direction-failed' ||
    event === 'peek-failed' ||
    event === 'command-not-understood' ||
    event === 'command-refused' ||
    event === 'user-search-failed' ||
    event === 'spell-refused' ||
    event === 'status-line' ||
    event === 'player-status'
  );
}
