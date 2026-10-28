export function createSharedPollingController(startPolling: () => () => void): (enabled: boolean) => void {
  let stopPolling: (() => void) | null = null;

  return (enabled) => {
    if (enabled && !stopPolling) {
      stopPolling = startPolling();
    } else if (!enabled && stopPolling) {
      stopPolling();
      stopPolling = null;
    }
  };
}
