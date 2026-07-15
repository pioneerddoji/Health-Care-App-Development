// 아이 등록/수정 — 기본 정보(달력 픽커), 건강 정보(필요 시 추가 작성), 주치의
import React, { useState } from 'react';
import { ScrollView, Text, View, Alert } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useApp } from '../../context/AppContext';
import { KeyboardScreen, Field, Button, Chip, Row, Section, tokens } from '../../components/ui';
import { DateField } from '../../components/DateField';
import type { RootStackParamList } from '../../navigation/types';
import type { ChildInput } from '../../types';

// 쉼표 구분 입력 → 배열
const toList = (s: string): string[] =>
  s.split(',').map((x) => x.trim()).filter(Boolean);

export const ChildFormScreen = () => {
  const nav = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'ChildForm'>>();
  const { children, createChild, updateChild } = useApp();
  const editing = children.find((c) => c.id === route.params?.childId);

  const [name, setName] = useState(editing?.name ?? '');
  const [nickname, setNickname] = useState(editing?.nickname ?? '');
  const [birthDate, setBirthDate] = useState(editing?.birthDate ?? '');
  const [sex, setSex] = useState<'male' | 'female'>(editing?.sex ?? 'female');
  const [birthWeight, setBirthWeight] = useState(editing?.birthWeightG?.toString() ?? '');
  const [allergies, setAllergies] = useState(editing?.allergies.join(', ') ?? '');
  const [chronic, setChronic] = useState(editing?.chronicConditions.join(', ') ?? '');
  const [otherNotes, setOtherNotes] = useState(editing?.otherNotes ?? '');
  const [doctor, setDoctor] = useState(editing?.primaryDoctor ?? '');
  const [hospital, setHospital] = useState(editing?.primaryHospital ?? '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const input: ChildInput = {
      name, nickname: nickname || undefined, birthDate, sex,
      birthWeightG: birthWeight ? Number(birthWeight) : undefined,
      isPreterm: editing?.isPreterm ?? false,
      allergies: toList(allergies),
      chronicConditions: toList(chronic),
      otherNotes: otherNotes.trim() || undefined,
      surgeries: editing?.surgeries ?? [],
      hospitalizations: editing?.hospitalizations ?? [],
      primaryDoctor: doctor || undefined,
      primaryHospital: hospital || undefined,
    };
    setBusy(true);
    try {
      if (editing) await updateChild(editing.id, input);
      else await createChild(input);
      nav.goBack();
    } catch (e) {
      Alert.alert('저장 실패', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(birthDate);

  return (
    <KeyboardScreen>
      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        <Section title="기본 정보">
          <Field label="이름 *" value={name} onChangeText={setName} placeholder="김하은" />
          <Field label="별명" value={nickname} onChangeText={setNickname} placeholder="하니" />
          <DateField label="생년월일 *" mode="date" value={birthDate}
            onChange={setBirthDate} maximumDate={new Date()} />
          <Text style={{ fontSize: 13, color: tokens.inkSecondary, marginBottom: 6 }}>성별 *</Text>
          <Row style={{ marginBottom: 12 }}>
            <Chip label="여아" selected={sex === 'female'} onPress={() => setSex('female')} />
            <Chip label="남아" selected={sex === 'male'} onPress={() => setSex('male')} />
          </Row>
          <Field label="출생 체중 (g, 선택)" value={birthWeight} onChangeText={setBirthWeight}
            keyboardType="number-pad" placeholder="3200" />
        </Section>

        <Section title="건강 정보 (필요 시 추가 작성)">
          <Field label="알레르기 (쉼표로 구분)" value={allergies} onChangeText={setAllergies}
            placeholder="계란(난백), 땅콩" />
          <Field label="만성질환 (쉼표로 구분)" value={chronic} onChangeText={setChronic}
            placeholder="아토피 피부염" />
          <Field label="기타" value={otherNotes} onChangeText={setOtherNotes} multiline
            placeholder="그 외 참고할 건강 정보를 자유롭게 적어주세요 (수술/입원 이력 등)" />
        </Section>

        <Section title="주치의 / 병원 (필요 시 추가 작성)">
          <Field label="주치의" value={doctor} onChangeText={setDoctor} placeholder="박소아 선생님" />
          <Field label="병원" value={hospital} onChangeText={setHospital} placeholder="○○소아청소년과" />
        </Section>

        <Button label={busy ? '저장 중…' : editing ? '수정 저장' : '아이 등록'} onPress={save}
          disabled={busy || !name || !validDate} />
        <View style={{ height: 60 }} />
      </ScrollView>
    </KeyboardScreen>
  );
};
