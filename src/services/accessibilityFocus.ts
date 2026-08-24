export interface AccessibilityFocusClock {
  setTimeout(task: () => void): unknown;
  clearTimeout(handle: unknown): void;
}

export interface AccessibilityFocusController {
  /** Replaces any earlier pending request, preventing stale modal focus. */
  request(target: () => number | null): void;
  /** Cancels pending work when the target becomes disabled, loading, or hidden. */
  cancel(): void;
  /** Cancels pending work permanently when the owning UI unmounts. */
  dispose(): void;
}

/**
 * Defers native accessibility focus until the next UI turn. The target is resolved
 * at delivery time so a close/back transition cannot focus an unmounted node.
 */
export const createAccessibilityFocusController = ({
  clock,
  setAccessibilityFocus,
}: {
  clock: AccessibilityFocusClock;
  setAccessibilityFocus: (node: number) => void;
}): AccessibilityFocusController => {
  let pending: unknown = null;
  let disposed = false;

  const cancel = () => {
    if (pending !== null) clock.clearTimeout(pending);
    pending = null;
  };

  return {
    request(target) {
      cancel();
      if (disposed) return;
      pending = clock.setTimeout(() => {
        pending = null;
        if (disposed) return;
        const node = target();
        if (node !== null) setAccessibilityFocus(node);
      });
    },
    cancel,
    dispose() {
      disposed = true;
      cancel();
    },
  };
};
