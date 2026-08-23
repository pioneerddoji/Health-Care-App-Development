// 날짜/시간 선택 필드 — 네이티브에서는 달력/시계 픽커, 웹에서는 텍스트 입력 폴백.
import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, findNodeHandle, Platform, Pressable, Text, TextInput, View, StyleSheet, Modal,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { tokens } from './ui';
import { createDateFieldAccessibilityBindings } from './dateFieldAccessibility';

const pad = (n: number) => String(n).padStart(2, '0');
const toDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toTimeStr = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

interface Props {
  label: string;
  mode: 'date' | 'time';
  /** date: 'YYYY-MM-DD' / time: 'HH:MM' (빈 문자열 허용) */
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maximumDate?: Date;       // date 모드: 미래 선택 제한 등
}

export const DateField = ({ label, mode, value, onChange, placeholder, maximumDate }: Props) => {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<React.ComponentRef<typeof Pressable>>(null);
  const doneRef = useRef<React.ComponentRef<typeof Pressable>>(null);
  const focus = useRef(createDateFieldAccessibilityBindings({
    clock: { setTimeout: (task) => setTimeout(task, 0), clearTimeout },
    resolveNode: (node) => findNodeHandle(node as React.ComponentRef<typeof Pressable> | null),
    setAccessibilityFocus: (node) => AccessibilityInfo.setAccessibilityFocus(node),
  })).current;
  useEffect(() => () => focus.dispose(), [focus]);
  const openPicker = () => {
    focus.cancel();
    setOpen(true);
  };
  const closePicker = () => {
    setOpen(false);
    focus.restoreTrigger(triggerRef);
  };

  // 웹: 네이티브 픽커 미지원 → 텍스트 입력 폴백 (Playwright 테스트도 이 경로 사용)
  if (Platform.OS === 'web') {
    return (
      <View style={{ marginBottom: 12 }}>
        <Text style={s.label}>{label}</Text>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder ?? (mode === 'date' ? 'YYYY-MM-DD' : 'HH:MM')}
          placeholderTextColor={tokens.muted}
          style={s.input}
        />
      </View>
    );
  }

  const current = (): Date => {
    const now = new Date();
    if (!value) return now;
    if (mode === 'date') {
      const d = new Date(`${value}T00:00:00`);
      return isNaN(d.getTime()) ? now : d;
    }
    const [h, m] = value.split(':').map(Number);
    if (Number.isFinite(h) && Number.isFinite(m)) now.setHours(h, m, 0, 0);
    return now;
  };

  const handlePicked = (event: DateTimePickerEvent, picked?: Date) => {
    if (Platform.OS === 'android') closePicker();
    if (event.type === 'dismissed' || !picked) return;
    onChange(mode === 'date' ? toDateStr(picked) : toTimeStr(picked));
  };

  const picker = (
    <DateTimePicker
      value={current()}
      mode={mode}
      display={Platform.OS === 'ios' ? (mode === 'date' ? 'inline' : 'spinner') : 'default'}
      onChange={handlePicked}
      maximumDate={maximumDate}
      locale="ko-KR"
    />
  );

  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={s.label}>{label}</Text>
      <Pressable
        ref={triggerRef}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
        onPress={openPicker}
        style={s.input}
      >
        <Text style={value ? s.value : s.placeholder}>
          {value || placeholder || (mode === 'date' ? '탭해서 날짜 선택' : '탭해서 시간 선택')}
        </Text>
      </Pressable>

      {Platform.OS === 'android' && open && picker}

      {Platform.OS === 'ios' && (
        <Modal
          visible={open}
          transparent
          animationType="fade"
          onRequestClose={closePicker}
          onShow={() => focus.focusPicker(doneRef)}
        >
          <View style={s.modal}>
            <Pressable accessible={false} style={s.backdrop} onPress={closePicker} />
            <View accessibilityViewIsModal style={s.sheet}>
              {picker}
              <Pressable ref={doneRef} accessibilityRole="button" accessibilityLabel="선택 완료" style={s.done} onPress={closePicker}>
                <Text style={s.doneText}>완료</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
};

const s = StyleSheet.create({
  label: { fontSize: 13, color: tokens.inkSecondary, marginBottom: 6 },
  input: {
    backgroundColor: tokens.surface, borderWidth: 1, borderColor: tokens.border,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, minHeight: 44,
    justifyContent: 'center',
  },
  value: { fontSize: 15, color: tokens.ink },
  placeholder: { fontSize: 15, color: tokens.muted },
  modal: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: tokens.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16,
    padding: 16, paddingBottom: 32,
  },
  done: {
    backgroundColor: tokens.primary, borderRadius: 12, paddingVertical: 12,
    alignItems: 'center', marginTop: 8,
  },
  doneText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
