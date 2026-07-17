// 아이디/비밀번호 찾기 — 가입 시 등록한 연락처로 문자 인증 후 진행.
// SMS 발송은 smsAuth.ts 참조 (데모: 코드를 화면에 표시).
import React, { useState } from 'react';
import { ScrollView, Text, StyleSheet, Alert, View } from 'react-native';
import { useApp } from '../../context/AppContext';
import { KeyboardScreen, Field, Button, Chip, Row, Muted, Card, tokens } from '../../components/ui';
import { digitsOnly, isValidPhone, isValidEmail, passwordError } from '../../lib/validation';
import { requestOtp, verifyOtp, resolveSmsMode } from '../../services/smsAuth';

type Tab = 'email' | 'password';
type Step = 'input' | 'otp' | 'done';

export const FindAccountScreen = ({ onBack }: { onBack: () => void }) => {
  const { findEmailByPhone, resetPassword, requestPasswordResetEmail, mode } = useApp();
  const smsMode = resolveSmsMode(mode);
  const [tab, setTab] = useState<Tab>('email');
  const [step, setStep] = useState<Step>('input');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');           // 비밀번호 찾기용
  const [otpInput, setOtpInput] = useState('');
  const [demoCode, setDemoCode] = useState<string | undefined>();
  const [newPw, setNewPw] = useState('');
  const [foundEmail, setFoundEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = (t: Tab) => {
    setTab(t); setStep('input'); setOtpInput(''); setFoundEmail(null); setNewPw('');
  };

  const sendOtp = async () => {
    if (!isValidPhone(phone)) {
      Alert.alert('확인', '휴대폰 번호를 숫자만으로 입력해 주세요 (예: 01012345678).');
      return;
    }
    if (tab === 'password' && !isValidEmail(email)) {
      Alert.alert('확인', '가입한 이메일을 올바른 형식으로 입력해 주세요.');
      return;
    }
    setBusy(true);
    try {
      const { demoCode: code } = await requestOtp(digitsOnly(phone), smsMode);
      setDemoCode(code);
      setStep('otp');
      setOtpInput('');
    } finally {
      setBusy(false);
    }
  };

  // 문자 인증이 꺼진 빌드(smsMode='off'): 비밀번호 재설정 메일로 대체
  const sendResetEmail = async () => {
    if (!isValidEmail(email)) {
      Alert.alert('확인', '가입한 이메일을 올바른 형식으로 입력해 주세요.');
      return;
    }
    setBusy(true);
    try {
      await requestPasswordResetEmail(email.trim());
      setStep('done');
    } catch (e) {
      Alert.alert('실패', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    const v = verifyOtp(digitsOnly(phone), otpInput);
    if (!v.ok) {
      Alert.alert('인증 실패', v.reason ?? '인증번호를 확인해 주세요.');
      return;
    }
    setBusy(true);
    try {
      if (tab === 'email') {
        const found = await findEmailByPhone(digitsOnly(phone));
        if (!found) {
          Alert.alert('결과 없음', '이 연락처로 가입된 계정을 찾지 못했습니다.');
          setStep('input');
          return;
        }
        setFoundEmail(found);
        setStep('done');
      } else {
        const pwErr = passwordError(newPw);
        if (pwErr) { Alert.alert('비밀번호 확인', pwErr); return; }
        await resetPassword(email.trim(), digitsOnly(phone), newPw);
        setStep('done');
      }
    } catch (e) {
      Alert.alert('실패', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardScreen>
      <ScrollView contentContainerStyle={{ padding: 24 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>계정 찾기</Text>
        <Row style={{ marginBottom: 16 }}>
          <Chip label="아이디(이메일) 찾기" selected={tab === 'email'} onPress={() => reset('email')} />
          <Chip label="비밀번호 재설정" selected={tab === 'password'} onPress={() => reset('password')} />
        </Row>

        {/* 문자 인증이 꺼진 빌드: 아이디 찾기는 안내만, 비밀번호는 재설정 메일 */}
        {smsMode === 'off' && tab === 'email' && (
          <Card>
            <Muted>
              아이디(이메일) 찾기는 휴대폰 문자 인증 도입 후 제공될 예정입니다.{'\n'}
              가입한 이메일이 기억나지 않으면 고객센터로 문의해 주세요.
            </Muted>
          </Card>
        )}
        {smsMode === 'off' && tab === 'password' && step !== 'done' && (
          <>
            <Field label="가입한 이메일" value={email} onChangeText={setEmail}
              autoCapitalize="none" keyboardType="email-address" placeholder="parent@example.com" />
            <Muted>입력한 이메일로 비밀번호 재설정 안내 메일을 보내 드립니다.</Muted>
            <View style={{ height: 8 }} />
            <Button label={busy ? '발송 중…' : '재설정 메일 보내기'}
              onPress={sendResetEmail} disabled={busy} />
          </>
        )}
        {smsMode === 'off' && tab === 'password' && step === 'done' && (
          <Card>
            <Text style={styles.doneTitle}>재설정 메일 발송</Text>
            <Muted>{email}(으)로 안내 메일을 보냈습니다. 메일함(스팸함 포함)을 확인해 주세요.</Muted>
            <Button label="로그인하러 가기" onPress={onBack} />
          </Card>
        )}

        {smsMode !== 'off' && step === 'input' && (
          <>
            {tab === 'password' && (
              <Field label="가입한 이메일" value={email} onChangeText={setEmail}
                autoCapitalize="none" keyboardType="email-address" placeholder="parent@example.com" />
            )}
            <Field label="가입 시 등록한 연락처" value={phone}
              onChangeText={(t) => setPhone(digitsOnly(t))}
              keyboardType="number-pad" placeholder="01012345678" maxLength={13} />
            <Button label={busy ? '발송 중…' : '인증번호 받기'} onPress={sendOtp} disabled={busy} />
          </>
        )}

        {smsMode !== 'off' && step === 'otp' && (
          <Card>
            <Muted>{phone}로 발송된 6자리 인증번호를 입력해 주세요.</Muted>
            {demoCode && (
              <Text style={styles.demoCode}>📱 데모 모드 인증번호: {demoCode}</Text>
            )}
            <Field label="" value={otpInput} onChangeText={(t) => setOtpInput(digitsOnly(t))}
              keyboardType="number-pad" maxLength={6} placeholder="6자리 숫자" />
            {tab === 'password' && (
              <Field label="새 비밀번호 (8자 이상, 영문 필수)" value={newPw}
                onChangeText={setNewPw} secureTextEntry />
            )}
            <Button
              label={busy ? '확인 중…' : tab === 'email' ? '인증하고 아이디 확인' : '인증하고 비밀번호 변경'}
              onPress={confirm}
              disabled={busy || otpInput.length !== 6 || (tab === 'password' && !newPw)} />
            <Button label="인증번호 다시 받기" variant="ghost" onPress={sendOtp} disabled={busy} />
          </Card>
        )}

        {smsMode !== 'off' && step === 'done' && (
          <Card>
            {tab === 'email' ? (
              <>
                <Text style={styles.doneTitle}>가입된 이메일</Text>
                <Text style={styles.foundEmail}>{foundEmail}</Text>
              </>
            ) : (
              <>
                <Text style={styles.doneTitle}>비밀번호 변경 완료</Text>
                <Muted>새 비밀번호로 로그인해 주세요.</Muted>
              </>
            )}
            <Button label="로그인하러 가기" onPress={onBack} />
          </Card>
        )}

        <Button label="뒤로" variant="ghost" onPress={onBack} disabled={busy} />
        <View style={{ height: 60 }} />
      </ScrollView>
    </KeyboardScreen>
  );
};

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '800', color: tokens.ink, marginBottom: 16 },
  demoCode: {
    fontSize: 13, color: tokens.primary, fontWeight: '700', marginVertical: 8,
    backgroundColor: tokens.primarySoft, padding: 10, borderRadius: 8,
  },
  doneTitle: { fontSize: 16, fontWeight: '700', color: tokens.ink, marginBottom: 6 },
  foundEmail: { fontSize: 18, fontWeight: '800', color: tokens.primary, marginBottom: 12 },
});
