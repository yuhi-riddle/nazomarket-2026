import { describe, expect, it } from "vitest";
import { createSharedPollingController } from "./polling.ts";

describe("shared polling lifecycle", () => {
  it("keeps one polling loop while a shared list stays active across tab changes", () => {
    let starts = 0;
    let stops = 0;
    const setPolling = createSharedPollingController(() => {
      starts += 1;
      return () => { stops += 1; };
    });

    setPolling(true);
    setPolling(true);
    setPolling(true);

    expect(starts).toBe(1);
    expect(stops).toBe(0);
  });

  it("stops polling when leaving the shared list and can start again on resume", () => {
    let starts = 0;
    let stops = 0;
    const setPolling = createSharedPollingController(() => {
      starts += 1;
      return () => { stops += 1; };
    });

    setPolling(true);
    setPolling(false);
    setPolling(false);
    setPolling(true);

    expect(starts).toBe(2);
    expect(stops).toBe(1);
  });
});
