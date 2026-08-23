import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, Alert, findNodeHandle, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { useApp } from '../../context/AppContext';
import { Button, Field, KeyboardScreen, Muted, tokens } from '../../components/ui';
import { passwordError } from '../../lib/validation';
import { recoverySubmitDisabled } from '../../services/authUxState';

/** Supabase recovery redirect가 만든 짧은 세션에서만 보이는 비밀번호 설정 화면. */
export const RecoveryPasswordScreen = ({
  onDone, linkError,
}: { onDone: () => void; linkError?: string }) => {
  const { completePasswordRecovery } = useApp();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const errorRef = useRef<Text>(null);
  const error = password.length ? passwordError(password) : null;
  const mismatch = confirm.length > 0 && password !== confirm;

  useEffect(() => {
    if (!linkError && !submitError) return;
    const node = findNodeHandle(errorRef.current);
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
  }, [linkError, submitError]);

  const submit = async () => {
    if (busy || error || mismatch) return;
    setBusy(true);
    setSubmitError(null);
    try {
      await completePasswordRecovery(password);
      Alert.alert('비밀번호 변경 완료', '보안을 위해 다시 로그인해 주세요.', [{ text: '확인', onPress: onDone }]);
    } catch (e) {
      setSubmitError(`비밀번호 변경 또는 보안 세션 종료에 실패했습니다. 다시 시도해 주세요. (${e instanceof Error ? e.message : String(e)})`);
    } finally { setBusy(false); }
  };

  return (
    <KeyboardScreen>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>새 비밀번호 설정</Text>
        {linkError ? <>
          <Text ref={errorRef} accessible accessibilityRole="alert" accessibilityLiveRegion="assertive"
            style={styles.errorBox}>{linkError}</Text>
          <Button label="로그인 화면으로 돌아가기" onPress={onDone} />
        </> : <>
          <Muted>재설정 링크로 본인 확인이 완료되었습니다. 새 비밀번호를 설정하면 이 링크의 세션은 바로 종료됩니다.</Muted>
          <View style={{ height: 20 }} />
          <Field label="새 비밀번호 (8자 이상, 영문 필수)" value={password}
            onChangeText={setPassword} secureTextEntry editable={!busy} />
          {error && <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}
          <Field label="새 비밀번호 확인" value={confirm} onChangeText={setConfirm}
            secureTextEntry editable={!busy} />
          {mismatch && <Text accessibilityLiveRegion="polite" style={styles.error}>비밀번호가 일치하지 않습니다.</Text>}
          {submitError && <Text ref={errorRef} accessible accessibilityRole="alert"
            accessibilityLiveRegion="assertive" style={styles.errorBox}>{submitError}</Text>}
          <Button label={busy ? '변경 및 세션 종료 중…' : '새 비밀번호 저장'} onPress={submit}
            disabled={recoverySubmitDisabled({ busy, password, confirm, error: !!error, mismatch })} />
        </>}
      </ScrollView>
    </KeyboardScreen>
  );
};

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  title: { fontSize: 22, fontWeight: '800', color: tokens.ink, marginBottom: 12 },
  error: { fontSize: 12, color: tokens.danger, marginTop: -8, marginBottom: 10 },
  errorBox: { fontSize: 13, color: tokens.danger, marginVertical: 12, padding: 12,
    borderWidth: 1, borderColor: tokens.danger, borderRadius: 8 },
});
