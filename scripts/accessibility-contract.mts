import {
  createAccessibilityFocusController,
  type AccessibilityFocusClock,
} from '../src/services/accessibilityFocus';

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

{
  const clock = fakeClock();
  const focused: number[] = [];
  const controller = createAccessibilityFocusController({
    clock,
    setAccessibilityFocus: (node) => focused.push(node),
  });
  controller.request(() => 101);
  clock.flush();
  ok(focused.join(',') === '101', 'modal open moves focus only after the native tree can expose its target');
}

{
  const clock = fakeClock();
  const focused: number[] = [];
  const controller = createAccessibilityFocusController({ clock, setAccessibilityFocus: (node) => focused.push(node) });
  controller.request(() => null);
  clock.flush();
  ok(focused.length === 0, 'missing or unmounted focus targets fail closed without a native focus call');
}

{
  const clock = fakeClock();
  const focused: number[] = [];
  const controller = createAccessibilityFocusController({ clock, setAccessibilityFocus: (node) => focused.push(node) });
  controller.request(() => 1);
  controller.request(() => 2);
  clock.flush();
  ok(focused.join(',') === '2' && clock.pending() === 0, 'back-to-back modal transitions cancel stale focus restoration');
}

{
  const clock = fakeClock();
  const focused: number[] = [];
  const controller = createAccessibilityFocusController({ clock, setAccessibilityFocus: (node) => focused.push(node) });
  controller.request(() => 7);
  controller.cancel();
  clock.flush();
  ok(focused.length === 0, 'disabled or loading transitions can cancel a pending focus restoration');
}

{
  const clock = fakeClock();
  const focused: number[] = [];
  const controller = createAccessibilityFocusController({ clock, setAccessibilityFocus: (node) => focused.push(node) });
  controller.request(() => 9);
  controller.dispose();
  clock.flush();
  ok(focused.length === 0, 'unmount disposes pending focus work before it can call native accessibility APIs');
}

console.log(`ACCESSIBILITY_CONTRACT PASS=${pass} FAIL=${failures.length}`);
if (failures.length) {
  failures.forEach((failure) => console.error(`FAIL: ${failure}`));
  process.exit(1);
}
