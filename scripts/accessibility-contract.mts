import { type AccessibilityFocusClock } from '../src/services/accessibilityFocus';
import {
  createDateFieldModalLifecycle,
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
const harness = (clock: AccessibilityFocusClock, focused: number[]) => {
  const visibility: boolean[] = [];
  const lifecycle = createDateFieldModalLifecycle({
    clock,
    resolveNode: (node) => typeof node === 'number' ? node : null,
    setAccessibilityFocus: (node) => focused.push(node),
    setOpen: (open) => visibility.push(open),
    triggerRef: ref(201),
    doneRef: ref(101),
  });
  return { lifecycle, visibility };
};

{
  const clock = fakeClock();
  const focused: number[] = [];
  const { lifecycle, visibility } = harness(clock, focused);
  lifecycle.open();
  lifecycle.onModalShow();
  clock.flush();
  ok(visibility.join(',') === 'true' && focused.join(',') === '101', 'DateField open then modal onShow exposes the done target through its rendered lifecycle');
}

{
  const clock = fakeClock();
  const focused: number[] = [];
  const { lifecycle } = harness(clock, focused);
  lifecycle.open();
  lifecycle.setDoneTarget(ref(null));
  lifecycle.onModalShow();
  clock.flush();
  ok(focused.length === 0, 'DateField missing done target fails closed without a native focus call');
}

{
  const clock = fakeClock();
  const focused: number[] = [];
  const { lifecycle, visibility } = harness(clock, focused);
  lifecycle.open();
  lifecycle.onModalShow();
  lifecycle.close();
  clock.flush();
  ok(visibility.join(',') === 'true,false' && focused.join(',') === '201' && clock.pending() === 0, 'DateField backdrop close restores the trigger instead of the hidden modal target');
}

{
  const clock = fakeClock();
  const focused: number[] = [];
  const { lifecycle, visibility } = harness(clock, focused);
  lifecycle.open();
  lifecycle.onModalShow();
  lifecycle.updateAvailability({ disabled: true, loading: false, error: false });
  clock.flush();
  ok(visibility.join(',') === 'true,false' && focused.length === 0, 'DateField disabled transition closes the modal and cancels pending focus');
}

{
  const clock = fakeClock();
  const focused: number[] = [];
  const { lifecycle } = harness(clock, focused);
  lifecycle.open();
  lifecycle.onModalShow();
  lifecycle.updateAvailability({ disabled: false, loading: true, error: false });
  clock.flush();
  ok(focused.length === 0, 'DateField loading transition cancels pending focus before native delivery');
}

{
  const clock = fakeClock();
  const focused: number[] = [];
  const { lifecycle } = harness(clock, focused);
  lifecycle.open();
  lifecycle.onModalShow();
  lifecycle.updateAvailability({ disabled: false, loading: false, error: true });
  clock.flush();
  ok(focused.length === 0, 'DateField error transition cancels pending focus before native delivery');
}

{
  const clock = fakeClock();
  const focused: number[] = [];
  const { lifecycle } = harness(clock, focused);
  lifecycle.open();
  lifecycle.onModalShow();
  lifecycle.onRequestClose();
  clock.flush();
  ok(focused.join(',') === '201', 'DateField Android back handler restores the trigger through the same close lifecycle');
}

{
  const clock = fakeClock();
  const focused: number[] = [];
  const { lifecycle, visibility } = harness(clock, focused);
  lifecycle.open();
  lifecycle.onModalShow();
  lifecycle.close();
  lifecycle.open();
  lifecycle.onModalShow();
  clock.flush();
  ok(visibility.join(',') === 'true,false,true' && focused.join(',') === '101', 'DateField back-to-back open-close leaves one current modal focus target');
}

{
  const clock = fakeClock();
  const focused: number[] = [];
  const { lifecycle } = harness(clock, focused);
  lifecycle.open();
  lifecycle.onModalShow();
  lifecycle.unmount();
  clock.flush();
  ok(focused.length === 0, 'DateField unmount disposes pending focus work before it can call native accessibility APIs');
}

console.log(`ACCESSIBILITY_CONTRACT PASS=${pass} FAIL=${failures.length}`);
if (failures.length) {
  failures.forEach((failure) => console.error(`FAIL: ${failure}`));
  process.exit(1);
}
