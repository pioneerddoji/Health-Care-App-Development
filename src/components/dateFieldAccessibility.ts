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
