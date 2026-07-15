// 공용 UI 컴포넌트 + 디자인 토큰
import React from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, ViewStyle, TextInputProps,
  KeyboardAvoidingView, Platform,
} from 'react-native';

export const tokens = {
  bg: '#f9f9f7',
  surface: '#fcfcfb',
  ink: '#0b0b0b',
  inkSecondary: '#52514e',
  muted: '#898781',
  border: 'rgba(11,11,11,0.10)',
  primary: '#2a78d6',
  primarySoft: '#e7f0fb',
  danger: '#d03b3b',
  radius: 14,
};

export const Screen = ({ children, style }: { children: React.ReactNode; style?: ViewStyle }) => (
  <View style={[s.screen, style]}>{children}</View>
);

/** 입력 폼이 있는 화면용 — 키보드가 올라오면 내용이 가려지지 않게 밀어올린다 */
export const KeyboardScreen = ({ children, style }: { children: React.ReactNode; style?: ViewStyle }) => (
  <KeyboardAvoidingView
    style={[s.screen, style]}
    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
  >
    {children}
  </KeyboardAvoidingView>
);

export const Card = ({ children, style }: { children: React.ReactNode; style?: ViewStyle }) => (
  <View style={[s.card, style]}>{children}</View>
);

export const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <View style={{ marginBottom: 16 }}>
    <Text style={s.sectionTitle}>{title}</Text>
    {children}
  </View>
);

export const Button = ({
  label, onPress, variant = 'primary', disabled,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
}) => (
  <Pressable
    onPress={onPress}
    disabled={disabled}
    style={({ pressed }) => [
      s.btn,
      variant === 'primary' && { backgroundColor: tokens.primary },
      variant === 'ghost' && { backgroundColor: 'transparent', borderWidth: 1, borderColor: tokens.border },
      variant === 'danger' && { backgroundColor: tokens.danger },
      (pressed || disabled) && { opacity: 0.6 },
    ]}
  >
    <Text style={[s.btnLabel, variant === 'ghost' && { color: tokens.ink }]}>{label}</Text>
  </Pressable>
);

export const Chip = ({
  label, selected, onPress,
}: { label: string; selected?: boolean; onPress?: () => void }) => (
  <Pressable
    onPress={onPress}
    style={[s.chip, selected && { backgroundColor: tokens.primarySoft, borderColor: tokens.primary }]}
  >
    <Text style={[s.chipLabel, selected && { color: tokens.primary, fontWeight: '600' }]}>{label}</Text>
  </Pressable>
);

export const Field = ({
  label, ...inputProps
}: { label: string } & TextInputProps) => (
  <View style={{ marginBottom: 12 }}>
    <Text style={s.fieldLabel}>{label}</Text>
    <TextInput
      placeholderTextColor={tokens.muted}
      {...inputProps}
      style={[s.input, inputProps.multiline && { height: 80, textAlignVertical: 'top' }]}
    />
  </View>
);

export const Row = ({ children, style }: { children: React.ReactNode; style?: ViewStyle }) => (
  <View style={[{ flexDirection: 'row', alignItems: 'center' }, style]}>{children}</View>
);

export const Muted = ({ children }: { children: React.ReactNode }) => (
  <Text style={{ color: tokens.muted, fontSize: 12 }}>{children}</Text>
);

/** 의료행위 아님 고지 — 대시보드/레포트 하단 고정 노출 */
export const Disclaimer = () => (
  <Text style={s.disclaimer}>
    이 앱의 기록과 그래프는 보호자의 관찰 기록이며 의학적 진단·처방이 아닙니다.
    필요 시 레포트를 참고하여 소아청소년과 의사와 상담하세요.
  </Text>
);

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: tokens.bg },
  card: {
    backgroundColor: tokens.surface,
    borderRadius: tokens.radius,
    padding: 16,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: tokens.border,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: tokens.ink, marginBottom: 8 },
  btn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginVertical: 6,
  },
  btnLabel: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: tokens.border,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginRight: 8,
    marginBottom: 8,
    backgroundColor: tokens.surface,
  },
  chipLabel: { fontSize: 13, color: tokens.inkSecondary },
  fieldLabel: { fontSize: 13, color: tokens.inkSecondary, marginBottom: 6 },
  input: {
    backgroundColor: tokens.surface,
    borderWidth: 1,
    borderColor: tokens.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: tokens.ink,
  },
  disclaimer: {
    fontSize: 11,
    color: tokens.muted,
    lineHeight: 16,
    marginTop: 8,
    marginBottom: 24,
  },
});
