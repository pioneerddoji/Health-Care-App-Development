import { type AccessibilityFocusClock } from '../src/services/accessibilityFocus';
import {
  createDateFieldAccessibilityBindings,
  type DateFieldAccessibilityRef,
} from '../src/components/dateFieldAccessibility';

let pass = 0;
const failures: string[] = [];
const ok = (condition: boolean, label: string) => {
  if (condition) pass++;
  else failures.push(label);
};

const fakeClock = (): AccessibilityFocusClock & { flush(): void; pending(): number } => {
  let nextId = 1;
  const tasks = new Map<number, () => void>();
  return {
    setTimeout(task) { const id = nextId++; tasks.set(id, task); return id; },
    clearTimeout(id) { tasks.delete(id as number); },
    flush() {
      const pending = [...tasks.values()];
      tasks.clear();
      pending.forEach((task) => task());
    },
    pending: () => tasks.size,
  };
};

const ref = (node: number | null): DateFieldAccessibilityRef => ({ current: node });
const bindings = (clock: AccessibilityFocusClock, focused: number[]) => createDateFieldAccessibilityBindings({
  clock,
  resolveNode: (node) => typeof node === 'number' ? node : null,
  setAccessibilityFocus: (node) => focused.push(node),
});

{
  const clock = fakeClock();
  const focused: number[] = [];
  const focus = bindings(clock, focused);
  focus.focusPicker(ref(101));
  clock.flush();
  ok(focused.join(',') === '101', 'modal onShow exposes the picker action as an independent focus target');
}

{
  const clock = fakeClock();
  const focused: number[] = [];
  const focus = bindings(clock, focused);
  focus.focusPicker(ref(null));
  clock.flush();
  ok(focused.length === 0, 'missing picker target fails closed without a native focus call');
}

{
  const clock = fakeClock();
  const focused: number[] = [];
  const focus = bindings(clock, focused);
  focus.focusPicker(ref(1));
  focus.restoreTrigger(ref(2));
  clock.flush();
  ok(focused.join(',') === '2' && clock.pending() === 0, 'close or Android back restores only the latest trigger focus');
}

{
  const clock = fakeClock();
  const focused: number[] = [];
  const focus = bindings(clock, focused);
  focus.focusPicker(ref(7));
  focus.cancel();
  clock.flush();
  ok(focused.length === 0, 'disabled, loading, error, or hidden modal transitions cancel pending focus');
}

{
  const clock = fakeClock();
  const focused: number[] = [];
  const focus = bindings(clock, focused);
  focus.focusPicker(ref(9));
  focus.dispose();
  clock.flush();
  ok(focused.length === 0, 'unmount disposes pending focus work before it can call native accessibility APIs');
}

{
  const clock = fakeClock();
  const focused: number[] = [];
  const focus = bindings(clock, focused);
  focus.focusPicker(ref(11));
  focus.restoreTrigger(ref(12));
  focus.cancel();
  focus.focusPicker(ref(13));
  clock.flush();
  ok(focused.join(',') === '13', 'back-to-back open and close transitions leave no duplicate modal focus target');
}

console.log(`ACCESSIBILITY_CONTRACT PASS=${pass} FAIL=${failures.length}`);
if (failures.length) {
  failures.forEach((failure) => console.error(`FAIL: ${failure}`));
  process.exit(1);
}
