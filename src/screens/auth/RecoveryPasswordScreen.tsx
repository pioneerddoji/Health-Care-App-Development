import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useApp } from '../../context/AppContext';
import { Button, Field, KeyboardScreen, Muted, tokens } from '../../components/ui';
import { passwordError } from '../../lib/validation';

/** Supabase recovery redirect가 만든 짧은 세션에서만 보이는 비밀번호 설정 화면. */
export const RecoveryPasswordScreen = ({ onDone }: { onDone: () => void }) => {
  const { completePasswordRecovery } = useApp();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const error = password.length ? passwordError(password) : null;
  const mismatch = confirm.length > 0 && password !== confirm;

  const submit = async () => {
    if (error || mismatch) return;
    setBusy(true);
    try {
      await completePasswordRecovery(password);
      Alert.alert('비밀번호 변경 완료', '보안을 위해 다시 로그인해 주세요.', [{ text: '확인', onPress: onDone }]);
    } catch (e) {
      Alert.alert('비밀번호 변경 실패', e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  return (
    <KeyboardScreen>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>새 비밀번호 설정</Text>
        <Muted>재설정 링크로 본인 확인이 완료되었습니다. 새 비밀번호를 설정하면 이 링크의 세션은 바로 종료됩니다.</Muted>
        <View style={{ height: 20 }} />
        <Field label="새 비밀번호 (8자 이상, 영문 필수)" value={password}
          onChangeText={setPassword} secureTextEntry />
        {error && <Text style={styles.error}>{error}</Text>}
        <Field label="새 비밀번호 확인" value={confirm} onChangeText={setConfirm} secureTextEntry />
        {mismatch && <Text style={styles.error}>비밀번호가 일치하지 않습니다.</Text>}
        <Button label={busy ? '변경 중…' : '새 비밀번호 저장'} onPress={submit}
          disabled={busy || !password || !confirm || !!error || mismatch} />
      </ScrollView>
    </KeyboardScreen>
  );
};

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  title: { fontSize: 22, fontWeight: '800', color: tokens.ink, marginBottom: 12 },
  error: { fontSize: 12, color: tokens.danger, marginTop: -8, marginBottom: 10 },
});
