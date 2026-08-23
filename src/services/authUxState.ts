export const recoverySubmitDisabled = (state: {
  busy: boolean; password: string; confirm: string; error: boolean; mismatch: boolean;
}): boolean => state.busy || !state.password || !state.confirm || state.error || state.mismatch;

export const focusAccessibilityError = (
  target: number | null, accessibility: { setAccessibilityFocus(id: number): void },
): void => { if (target !== null) accessibility.setAccessibilityFocus(target); };

export const deletionSubmitDisabled = (state: {
  busy: boolean; phrase: string; methodReady: boolean;
}): boolean => state.busy || state.phrase !== '탈퇴합니다' || !state.methodReady;
