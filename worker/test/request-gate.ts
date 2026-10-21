/** Deterministic network suspension: tests decide when a provider may reply. */
export function requestGate() {
  let entered!: () => void;
  let release!: () => void;
  const arrived = new Promise<void>((resolve) => { entered = resolve; });
  const resumed = new Promise<void>((resolve) => { release = resolve; });
  return { arrived, release, async wait() { entered(); await resumed; } };
}
