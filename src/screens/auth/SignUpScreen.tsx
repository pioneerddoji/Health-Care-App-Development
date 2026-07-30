import React, { useState } from 'react';
import { ScrollView, Text, StyleSheet, View, Alert } from 'react-native';
import { useApp } from '../../context/AppContext';
import { KeyboardScreen, Field, Button, Chip, Row, Muted, Card, tokens } from '../../components/ui';
import { isValidEmail, passwordError, digitsOnly, isValidPhone } from '../../lib/validation';
import { requestOtp, verifyOtp, resolveSmsMode } from '../../services/smsAuth';

// 전연령: 아이 보호자뿐 아니라 본인 기록·성인 가족 돌봄 사용자도 포함한다
const RELATIONSHIPS = ['엄마', '아빠', '배우자', '자녀', '본인', '기타'];

export const SignUpScreen = ({ onBack }: { onBack: () => void }) => {
  const { signUp, mode } = useApp();
  const smsMode = resolveSmsMode(mode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('엄마');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);

  // 문자 인증 단계
  const [otpSent, setOtpSent] = useState(false);
  const [otpInput, setOtpInput] = useState('');
  const [demoCode, setDemoCode] = useState<string | undefined>();

  const emailErr = email.length > 0 && !isValidEmail(email)
    ? '올바른 이메일 형식이 아닙니다 (예: parent@example.com)' : null;
  const pwErr = password.length > 0 ? passwordError(password) : null;
  const phoneErr = phone.length > 0 && !isValidPhone(phone)
    ? '휴대폰 번호를 숫자만으로 입력해 주세요 (예: 01012345678)' : null;

  const formValid =
    isValidEmail(email) && !passwordError(password) && !!name && isValidPhone(phone);

  const sendOtp = async () => {
    setBusy(true);
    try {
      const { demoCode: code } = await requestOtp(digitsOnly(phone), smsMode);
      setDemoCode(code);
      setOtpSent(true);
      setOtpInput('');
    } finally {
      setBusy(false);
    }
  };

  // 문자 인증이 꺼진 빌드(smsMode='off'): OTP 없이 바로 가입 — 이메일 확인으로 검증
  const doSignUp = async () => {
    setBusy(true);
    try {
      const error = await signUp({
        email: email.trim(), password, name, relationship, phone: digitsOnly(phone),
      });
      if (error === 'confirm') {
        Alert.alert('이메일 확인', '가입 확인 메일을 보냈습니다. 메일의 링크를 누른 뒤 로그인해 주세요.',
          [{ text: '확인', onPress: onBack }]);
      } else if (error) {
        // supabase: 기 등록된 이메일이면 여기서 "already registered" 오류가 표시된다
        Alert.alert('회원가입 실패', error);
      }
      // 성공 시 Gate가 동의 화면으로 전환
    } finally {
      setBusy(false);
    }
  };

  const confirmSignUp = async () => {
    const result = verifyOtp(digitsOnly(phone), otpInput);
    if (!result.ok) {
      Alert.alert('인증 실패', result.reason ?? '인증번호를 확인해 주세요.');
      return;
    }
    await doSignUp();
  };

  return (
    <KeyboardScreen>
      <ScrollView contentContainerStyle={{ padding: 24 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>회원가입</Text>
        <Muted>케어노트는 성인 본인만 가입할 수 있습니다. 가입 후 아이와 성인 가족을 관리 대상자로 등록할 수 있으며, 필요한 동의(미성년자는 법정대리인 동의, 성인 가족은 본인 동의)는 대상자를 등록할 때 각각 확인합니다.</Muted>
        <View style={{ height: 16 }} />

        <Field label="이메일" value={email} onChangeText={setEmail}
          autoCapitalize="none" keyboardType="email-address" placeholder="parent@example.com"
          editable={!otpSent} />
        {emailErr && <Text style={styles.error}>{emailErr}</Text>}

        <Field label="비밀번호 (8자 이상, 영문 필수 · 대소문자 구분 · 숫자/특수문자 가능)"
          value={password} onChangeText={setPassword} secureTextEntry editable={!otpSent} />
        {pwErr && <Text style={styles.error}>{pwErr}</Text>}

        <Field label="보호자 이름" value={name} onChangeText={setName} placeholder="김보호"
          editable={!otpSent} />

        <Text style={styles.label}>주로 기록할 대상자와의 관계</Text>
        <Row style={{ flexWrap: 'wrap', marginBottom: 12 }}>
          {RELATIONSHIPS.map((r) => (
            <Chip key={r} label={r} selected={relationship === r}
              onPress={() => !otpSent && setRelationship(r)} />
          ))}
        </Row>

        <Field label="연락처 (필수 — 아이디/비밀번호 찾기에 사용)"
          value={phone} onChangeText={(t) => setPhone(digitsOnly(t))}
          keyboardType="number-pad" placeholder="01012345678" maxLength={13}
          editable={!otpSent} />
        {phoneErr && <Text style={styles.error}>{phoneErr}</Text>}

        {smsMode === 'off' ? (
          <Button label={busy ? '가입 중…' : '가입 완료'}
            onPress={doSignUp} disabled={busy || !formValid} />
        ) : !otpSent ? (
          <Button label={busy ? '발송 중…' : '휴대폰 인증번호 받기'}
            onPress={sendOtp} disabled={busy || !formValid} />
        ) : (
          <Card>
            <Text style={styles.otpTitle}>문자 인증</Text>
            <Muted>{phone}로 발송된 6자리 인증번호를 3분 내에 입력해 주세요.</Muted>
            {demoCode && (
              <Text style={styles.demoCode}>
                📱 데모 모드 인증번호: {demoCode}{'\n'}
                (실서비스에서는 문자로만 전송됩니다)
              </Text>
            )}
            <Field label="" value={otpInput} onChangeText={(t) => setOtpInput(digitsOnly(t))}
              keyboardType="number-pad" maxLength={6} placeholder="6자리 숫자" />
            <Button label={busy ? '확인 중…' : '인증하고 가입 완료'}
              onPress={confirmSignUp} disabled={busy || otpInput.length !== 6} />
            <Button label="인증번호 다시 받기" variant="ghost" onPress={sendOtp} disabled={busy} />
            <Button label="번호 수정" variant="ghost" onPress={() => setOtpSent(false)} disabled={busy} />
          </Card>
        )}

        <Button label="뒤로" variant="ghost" onPress={onBack} disabled={busy} />
        <View style={{ height: 60 }} />
      </ScrollView>
    </KeyboardScreen>
  );
};

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '800', color: tokens.ink, marginBottom: 20 },
  label: { fontSize: 13, color: tokens.inkSecondary, marginBottom: 6 },
  error: { fontSize: 12, color: tokens.danger, marginTop: -8, marginBottom: 10 },
  otpTitle: { fontSize: 15, fontWeight: '700', color: tokens.ink, marginBottom: 4 },
  demoCode: {
    fontSize: 13, color: tokens.primary, fontWeight: '700', marginVertical: 8,
    backgroundColor: tokens.primarySoft, padding: 10, borderRadius: 8, lineHeight: 19,
  },
});
