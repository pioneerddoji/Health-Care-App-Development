import {
  createAccessibilityFocusController,
  type AccessibilityFocusClock,
} from '../services/accessibilityFocus';

export interface DateFieldAccessibilityRef {
  current: unknown;
}

interface DateFieldAccessibilityBindings {
  focusPicker(ref: DateFieldAccessibilityRef): void;
  restoreTrigger(ref: DateFieldAccessibilityRef): void;
  cancel(): void;
  dispose(): void;
}

export interface DateFieldModalLifecycle {
  open(): void;
  onModalShow(): void;
  close(): void;
  onRequestClose(): void;
  updateAvailability(state: { disabled: boolean; loading: boolean; error: boolean }): void;
  setDoneTarget(ref: DateFieldAccessibilityRef): void;
  unmount(): void;
}

/**
 * Keeps DateField's native focus work tied to the current rendered controls.
 * Callers resolve the ref only at delivery time, so modal transitions cannot
 * focus hidden or unmounted accessibility targets.
 */
export const createDateFieldAccessibilityBindings = ({
  clock,
  resolveNode,
  setAccessibilityFocus,
}: {
  clock: AccessibilityFocusClock;
  resolveNode: (node: unknown) => number | null;
  setAccessibilityFocus: (node: number) => void;
}): DateFieldAccessibilityBindings => {
  const focus = createAccessibilityFocusController({ clock, setAccessibilityFocus });
  const focusRef = (ref: DateFieldAccessibilityRef) => {
    focus.request(() => resolveNode(ref.current));
  };

  return {
    focusPicker: focusRef,
    restoreTrigger: focusRef,
    cancel: focus.cancel,
    dispose: focus.dispose,
  };
};

/**
 * The native DateField lifecycle is kept outside React so its timer/ref work can
 * be exercised deterministically. DateField wires every modal handler to this
 * object; unavailable states always close and cancel before native focus runs.
 */
export const createDateFieldModalLifecycle = ({
  clock,
  resolveNode,
  setAccessibilityFocus,
  setOpen,
  triggerRef,
  doneRef: initialDoneRef,
}: {
  clock: AccessibilityFocusClock;
  resolveNode: (node: unknown) => number | null;
  setAccessibilityFocus: (node: number) => void;
  setOpen: (open: boolean) => void;
  triggerRef: DateFieldAccessibilityRef;
  doneRef: DateFieldAccessibilityRef;
}): DateFieldModalLifecycle => {
  const focus = createDateFieldAccessibilityBindings({ clock, resolveNode, setAccessibilityFocus });
  let doneRef = initialDoneRef;
  let open = false;

  const hideWithoutRestoring = () => {
    if (open) setOpen(false);
    open = false;
    focus.cancel();
  };

  return {
    open() {
      focus.cancel();
      if (open) return;
      open = true;
      setOpen(true);
    },
    onModalShow() {
      if (open) focus.focusPicker(doneRef);
    },
    close() {
      if (!open) return;
      open = false;
      setOpen(false);
      focus.restoreTrigger(triggerRef);
    },
    onRequestClose() {
      this.close();
    },
    updateAvailability({ disabled, loading, error }) {
      if (disabled || loading || error) hideWithoutRestoring();
    },
    setDoneTarget(ref) {
      doneRef = ref;
    },
    unmount() {
      open = false;
      focus.dispose();
    },
  };
};
