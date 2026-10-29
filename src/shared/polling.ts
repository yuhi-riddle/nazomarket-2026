export type VisibilitySource = {
  getVisibilityState: () => string;
  subscribe: (listener: () => void) => void;
};

export function createSharedPollingController(
  startPolling: () => () => void,
  visibility?: VisibilitySource,
): (enabled: boolean, visible?: boolean) => void {
  let stopPolling: (() => void) | null = null;
  let enabled = false;
  let visible = visibility ? visibility.getVisibilityState() !== "hidden" : true;

  const update = () => {
    const shouldPoll = enabled && visible;
    if (shouldPoll && !stopPolling) {
      stopPolling = startPolling();
    } else if (!shouldPoll && stopPolling) {
      stopPolling();
      stopPolling = null;
    }
  };

  visibility?.subscribe(() => {
    visible = visibility.getVisibilityState() !== "hidden";
    update();
  });

  return (nextEnabled, nextVisible) => {
    enabled = nextEnabled;
    if (visibility) visible = visibility.getVisibilityState() !== "hidden";
    else if (nextVisible !== undefined) visible = nextVisible;
    update();
  };
}
