import React, { useState } from 'react';
import { Text, StyleSheet, Alert, View, Pressable, ScrollView } from 'react-native';
import { useApp } from '../../context/AppContext';
import { KeyboardScreen, Field, Button, Muted, tokens } from '../../components/ui';
import { isValidEmail } from '../../lib/validation';
import { resolveKakaoLogin } from '../../services/socialAuth';

export const LoginScreen = ({
  onGoSignUp, onGoFind,
}: { onGoSignUp: () => void; onGoFind: () => void }) => {
  const { signIn, signInWithKakao, mode } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const kakaoEnabled = resolveKakaoLogin(mode);

  const emailErr = email.length > 0 && !isValidEmail(email)
    ? '올바른 이메일 형식이 아닙니다 (예: parent@example.com)' : null;

  const submit = async () => {
    if (!isValidEmail(email)) {
      Alert.alert('이메일 확인', '올바른 이메일 형식이 아닙니다.');
      return;
    }
    setBusy(true);
    try {
      const error = await signIn(email.trim(), password);
      if (error) Alert.alert('로그인 실패', error);
    } finally {
      setBusy(false);
    }
  };

  const kakao = async () => {
    setBusy(true);
    try {
      const error = await signInWithKakao();
      if (error) Alert.alert('카카오 로그인 실패', error);
      // 성공 시 Gate가 전환: 첫 진입은 동의 화면, 기존 계정은 홈
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardScreen>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.logo}>케어노트</Text>
        <Text style={styles.tagline}>우리 가족 건강 기록, 병원까지 한 번에</Text>
        <Field label="이메일" value={email} onChangeText={setEmail}
          autoCapitalize="none" keyboardType="email-address" placeholder="parent@example.com" />
        {emailErr && <Text style={styles.error}>{emailErr}</Text>}
        <Field label="비밀번호" value={password} onChangeText={setPassword}
          secureTextEntry placeholder="8자 이상" />
        <Button label={busy ? '로그인 중…' : '로그인'} onPress={submit}
          disabled={busy || !email || !password} />
        {kakaoEnabled && (
          <Pressable onPress={kakao} disabled={busy}
            style={({ pressed }) => [styles.kakaoBtn, pressed && { opacity: 0.8 }]}>
            <Text style={styles.kakaoText}>💬 카카오로 시작하기</Text>
          </Pressable>
        )}
        <Button label="회원가입" variant="ghost" onPress={onGoSignUp} />
        <Pressable onPress={onGoFind} style={{ alignItems: 'center', paddingVertical: 10 }}>
          <Text style={styles.findLink}>아이디 찾기 · 비밀번호 찾기</Text>
        </Pressable>
        <View style={{ alignItems: 'center', marginTop: 8 }}>
          <Muted>
            {mode === 'mock'
              ? '체험해 보려면 demo@carenote.app + 아무 비밀번호로 로그인하세요 (샘플 데이터)'
              : 'Supabase 연동 모드'}
          </Muted>
        </View>
      </ScrollView>
    </KeyboardScreen>
  );
};

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  logo: { fontSize: 32, fontWeight: '800', color: tokens.ink, textAlign: 'center' },
  tagline: { fontSize: 14, color: tokens.inkSecondary, textAlign: 'center', marginTop: 6, marginBottom: 32 },
  error: { fontSize: 12, color: tokens.danger, marginTop: -8, marginBottom: 10 },
  findLink: { fontSize: 13, color: tokens.primary, fontWeight: '600' },
  // 카카오 브랜드 가이드 색상 (#FEE500 배경 + 검정 87% 텍스트)
  kakaoBtn: {
    backgroundColor: '#FEE500', borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', marginBottom: 10,
  },
  kakaoText: { fontSize: 15, fontWeight: '700', color: 'rgba(0,0,0,0.87)' },
});
