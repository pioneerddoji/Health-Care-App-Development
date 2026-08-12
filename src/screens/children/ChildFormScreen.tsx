// 대상자 등록/수정 — 유형(아이/성인) → 기본 정보(달력 픽커) → 건강 정보 → 주치의.
// 연령 전제 항목(출생 체중 등)은 아이 유형에서만 노출하고, 동의 문구는 만 나이·본인
// 여부에 따라 갈린다 (lib/recipient.ts의 consentPlanFor가 단일 원천).
import React, { useState } from 'react';
import { ScrollView, Text, View, Alert, Pressable } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useApp } from '../../context/AppContext';
import { KeyboardScreen, Field, Button, Chip, Row, Section, Card, Muted, tokens } from '../../components/ui';
import { DateField } from '../../components/DateField';
import { consentPlanFor } from '../../lib/recipient';
import type { RootStackParamList } from '../../navigation/types';
import type { ChildInput, RecipientType } from '../../types';

// 쉼표 구분 입력 → 배열
const toList = (s: string): string[] =>
  s.split(',').map((x) => x.trim()).filter(Boolean);

export const ChildFormScreen = () => {
  const nav = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'ChildForm'>>();
  const { children, createChild, updateChild } = useApp();
  const editing = children.find((c) => c.id === route.params?.childId);

  const [recipientType, setRecipientType] =
    useState<RecipientType>(editing?.recipientType ?? 'child');
  const [isSelf, setIsSelf] = useState(editing?.isSelf ?? false);
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
  const [consented, setConsented] = useState(false);
  const [busy, setBusy] = useState(false);

  const isChild = recipientType === 'child';
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(birthDate);
  // 동의 문구는 만 나이로 갈린다 — 생년월일이 있어야 판정 가능
  const plan = validDate ? consentPlanFor({ birthDate, recipientType, isSelf }) : null;
  // 수정 시에는 등록 때 받은 동의가 유지된다 (동의 철회는 설정 → 동의 내역에서)
  const needsConsent = !editing;

  const save = async () => {
    const input: ChildInput = {
      name, nickname: nickname || undefined, birthDate, sex,
      recipientType,
      isSelf: recipientType === 'adult' ? isSelf : false,
      // 출생 정보는 아이 유형에서만 의미가 있다
      birthWeightG: isChild && birthWeight ? Number(birthWeight) : undefined,
      isPreterm: isChild ? (editing?.isPreterm ?? false) : false,
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

  return (
    <KeyboardScreen>
      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        <Section title="누구의 기록인가요?">
          <Row style={{ marginBottom: 8 }}>
            <Chip label="🧸 아이" selected={isChild}
              onPress={() => setRecipientType('child')} />
            <Chip label="🧑 성인 가족" selected={!isChild}
              onPress={() => setRecipientType('adult')} />
          </Row>
          {/* Chip이 선택 상태를 이미 시각적으로 표시하므로 ☐/☑ 표기를 겹치지 않는다
              — 아래 동의 체크박스와 혼동되지 않게 하기 위함 */}
          {!isChild && (
            <Row style={{ marginBottom: 8 }}>
              <Chip label="본인(나)의 기록" selected={isSelf} onPress={() => setIsSelf(!isSelf)} />
              <Chip label="다른 성인 가족" selected={!isSelf} onPress={() => setIsSelf(false)} />
            </Row>
          )}
          <Muted>
            {isChild
              ? '성장·예방접종 등 소아 항목이 함께 표시됩니다.'
              : '소아 전용 항목(출생 정보·학교 기록)은 표시되지 않습니다.'}
          </Muted>
        </Section>

        <Section title="기본 정보">
          <Field label="이름 *" value={name} onChangeText={setName}
            placeholder={isChild ? '김하은' : '김보호'} />
          <Field label="별명" value={nickname} onChangeText={setNickname}
            placeholder={isChild ? '하니' : '아버지'} />
          <DateField label="생년월일 *" mode="date" value={birthDate}
            onChange={setBirthDate} maximumDate={new Date()} />
          <Text style={{ fontSize: 13, color: tokens.inkSecondary, marginBottom: 6 }}>성별 *</Text>
          <Row style={{ marginBottom: 12 }}>
            <Chip label={isChild ? '여아' : '여성'} selected={sex === 'female'}
              onPress={() => setSex('female')} />
            <Chip label={isChild ? '남아' : '남성'} selected={sex === 'male'}
              onPress={() => setSex('male')} />
          </Row>
          {isChild && (
            <Field label="출생 체중 (g, 선택)" value={birthWeight} onChangeText={setBirthWeight}
              keyboardType="number-pad" placeholder="3200" />
          )}
        </Section>

        <Section title="건강 정보 (필요 시 추가 작성)">
          <Field label="알레르기 (쉼표로 구분)" value={allergies} onChangeText={setAllergies}
            placeholder="계란(난백), 땅콩" />
          <Field label="만성질환 (쉼표로 구분)" value={chronic} onChangeText={setChronic}
            placeholder={isChild ? '아토피 피부염' : '고혈압'} />
          <Field label="기타" value={otherNotes} onChangeText={setOtherNotes} multiline
            placeholder="그 외 참고할 건강 정보를 자유롭게 적어주세요 (수술/입원 이력 등)" />
        </Section>

        <Section title={isChild ? '주치의 / 병원 (필요 시 추가 작성)' : '단골 병원 (필요 시 추가 작성)'}>
          <Field label="주치의" value={doctor} onChangeText={setDoctor}
            placeholder={isChild ? '박소아 선생님' : '이내과 선생님'} />
          <Field label="병원" value={hospital} onChangeText={setHospital}
            placeholder={isChild ? '○○소아청소년과' : '○○내과'} />
        </Section>

        {/* 동의 — 만 나이·본인 여부에 따라 문구가 갈린다 */}
        {needsConsent && plan && (
          <Card>
            <Text style={{ fontSize: 14, fontWeight: '700', color: tokens.ink, marginBottom: 6 }}>
              건강정보 수집 동의
            </Text>
            <Muted>{plan.notice}</Muted>
            <View style={{ height: 8 }} />
            <Pressable onPress={() => setConsented(!consented)}>
              <Text style={{ fontSize: 14, color: tokens.ink, lineHeight: 21 }}>
                {consented ? '☑' : '☐'} {plan.confirmLabel}
              </Text>
            </Pressable>
          </Card>
        )}

        <Button
          label={busy ? '저장 중…' : editing ? '수정 저장' : '대상자 등록'}
          onPress={save}
          disabled={busy || !name || !validDate || (needsConsent && !consented)} />
        <View style={{ height: 60 }} />
      </ScrollView>
    </KeyboardScreen>
  );
};
