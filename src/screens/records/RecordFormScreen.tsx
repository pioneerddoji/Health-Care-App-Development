// 기록 입력 폼 — 간편함이 핵심: 자주 쓰는 유형 5개를 앞에, 나머지는 접어둔다.
// 시간은 시계 픽커(기본값 = 지금), 건강관리 영역 태그는 유형에 따라 자동 분류된다.
import React, { useState } from 'react';
import { ScrollView, Text, View, Image, Pressable, Alert, StyleSheet } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useApp } from '../../context/AppContext';
import { KeyboardScreen, Field, Button, Chip, Row, Section, Muted, tokens } from '../../components/ui';
import { DateField } from '../../components/DateField';
import { recordTypesFor } from '../../constants/recordTypes';
import { showsChildFeatures } from '../../lib/recipient';
import { categoryLabel, DEFAULT_CATEGORY_BY_TYPE } from '../../constants/categories';
import type { RootStackParamList } from '../../navigation/types';
import type { CategorySlug, RecordPayload, RecordType } from '../../types';

// 자주 쓰는 유형 — 크게 노출 (나머지는 '더보기'로 접힘)
const QUICK_TYPES: RecordType[] = ['symptom', 'meal', 'sleep', 'excretion', 'medication_dose', 'note'];

export const RecordFormScreen = () => {
  const nav = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'RecordForm'>>();
  const { selectedChild, createRecord, ent } = useApp();
  const date = route.params.date;
  // 연령 전제 유형(학교/기관)은 아이 대상자에게만 노출
  const availableTypes = recordTypesFor(!selectedChild || showsChildFeatures(selectedChild));

  const now = new Date();
  const nowHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const [type, setType] = useState<RecordType>('symptom');
  const [time, setTime] = useState(nowHHMM);
  const [memo, setMemo] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [showAllTypes, setShowAllTypes] = useState(false);
  // 건강관리 영역 태그는 유형에서 자동 분류 (수동 선택 제거 — 혼동 방지)
  const categories: CategorySlug[] = DEFAULT_CATEGORY_BY_TYPE[type];
  // 유형별 입력값 — 문자열로 받고 저장 시 payload로 변환
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  const changeType = (t: RecordType) => {
    setType(t);
    setF({});
  };

  const buildPayload = (): RecordPayload => {
    const num = (k: string) => (f[k] ? Number(f[k]) : undefined);
    switch (type) {
      case 'condition':
        return { level: (num('level') as RecordPayload['level']) ?? 3, mood: f.mood };
      case 'meal':
        return {
          mealType: (f.mealType as RecordPayload['mealType']) ?? '간식',
          amount: (f.amount as RecordPayload['amount']) ?? '전량',
          items: f.items ? f.items.split(',').map((s) => s.trim()) : undefined,
          waterMl: num('waterMl'),
        };
      case 'sleep':
        return { sleepStart: f.sleepStart, sleepEnd: f.sleepEnd, nightWakings: num('nightWakings') };
      case 'excretion':
        return {
          kind: (f.kind as RecordPayload['kind']) ?? '소변',
          count: num('count') ?? 1,
          stoolForm: f.stoolForm as RecordPayload['stoolForm'],
        };
      case 'activity':
        return { activity: f.activity, durationMin: num('durationMin'), intensity: (f.intensity as RecordPayload['intensity']) ?? '보통' };
      case 'symptom':
        return {
          symptom: f.symptom, temperatureC: num('temperatureC'),
          severity: (num('severity') as RecordPayload['severity']) ?? 2, bodyPart: f.bodyPart,
        };
      case 'medication_dose':
        return { medicationName: f.medicationName, givenAt: time || undefined, doseText: f.doseText };
      case 'incident':
        return { what: f.what, incidentSeverity: (f.incidentSeverity as RecordPayload['incidentSeverity']) ?? '경미', action: f.action };
      case 'media_use':
        return { durationMin: num('durationMin'), content: f.content };
      case 'school':
        return { attended: f.attended !== '결석', note: f.note };
      default:
        return { note: memo || f.note };
    }
  };

  const MAX_PHOTOS = ent.maxPhotosPerRecord;

  const pickPhotos = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('권한 필요', '사진을 첨부하려면 사진 보관함 접근을 허용해 주세요.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: MAX_PHOTOS - photos.length,
      quality: 0.7,
    });
    if (!res.canceled) {
      setPhotos((prev) => [...prev, ...res.assets.map((a) => a.uri)].slice(0, MAX_PHOTOS));
    }
  };

  const save = async () => {
    if (!selectedChild) return;
    setBusy(true);
    try {
      await createRecord(selectedChild.id, {
        recordDate: date,
        recordTime: time || undefined,
        type,
        categories,
        payload: buildPayload(),
        memo: memo || undefined,
        photoUris: photos,
      });
      nav.goBack();
    } catch (e) {
      Alert.alert('저장 실패', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const choice = (k: string, options: string[]) => (
    <Row style={{ flexWrap: 'wrap', marginBottom: 12 }}>
      {options.map((o) => (
        <Chip key={o} label={o} selected={f[k] === o} onPress={() => set(k)(o)} />
      ))}
    </Row>
  );

  return (
    <KeyboardScreen>
      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        <Section title="무엇을 기록할까요?">
          <Row style={{ flexWrap: 'wrap' }}>
            {availableTypes.filter((t) => QUICK_TYPES.includes(t.type)).map((t) => (
              <Chip key={t.type} label={`${t.emoji} ${t.label}`}
                selected={type === t.type} onPress={() => changeType(t.type)} />
            ))}
          </Row>
          {showAllTypes && (
            <Row style={{ flexWrap: 'wrap' }}>
              {availableTypes.filter((t) => !QUICK_TYPES.includes(t.type)).map((t) => (
                <Chip key={t.type} label={`${t.emoji} ${t.label}`}
                  selected={type === t.type} onPress={() => changeType(t.type)} />
              ))}
            </Row>
          )}
          <Text style={{ fontSize: 13, color: tokens.primary, paddingVertical: 4 }}
            onPress={() => setShowAllTypes((v) => !v)}>
            {showAllTypes ? '접기 ▲' : '다른 유형 더보기 ▼'}
          </Text>
        </Section>

        <Section title="내용">
          <DateField label="시간" mode="time" value={time} onChange={setTime} />

          {type === 'condition' && (<>
            <Text style={{ fontSize: 13, color: '#52514e', marginBottom: 6 }}>오늘 컨디션 (1 나쁨 ~ 5 최고)</Text>
            {choice('level', ['1', '2', '3', '4', '5'])}
            <Field label="기분/특이사항" value={f.mood ?? ''} onChangeText={set('mood')} placeholder="좋음 / 처짐 / 보챔" />
          </>)}

          {type === 'meal' && (<>
            {choice('mealType', ['아침', '점심', '저녁', '간식', '수유'])}
            {choice('amount', ['전량', '절반', '거의 안 먹음'])}
            <Field label="먹은 것 (쉼표 구분)" value={f.items ?? ''} onChangeText={set('items')} placeholder="밥, 국, 반찬" />
            <Field label="수분 섭취 (ml)" value={f.waterMl ?? ''} onChangeText={set('waterMl')} keyboardType="number-pad" />
          </>)}

          {type === 'sleep' && (<>
            <DateField label="잠든 시간" mode="time" value={f.sleepStart ?? ''} onChange={set('sleepStart')} placeholder="21:00" />
            <DateField label="일어난 시간" mode="time" value={f.sleepEnd ?? ''} onChange={set('sleepEnd')} placeholder="07:20" />
            <Field label="밤중 깬 횟수" value={f.nightWakings ?? ''} onChangeText={set('nightWakings')} keyboardType="number-pad" />
          </>)}

          {type === 'excretion' && (<>
            {choice('kind', ['소변', '대변'])}
            <Field label="횟수" value={f.count ?? ''} onChangeText={set('count')} keyboardType="number-pad" placeholder="1" />
            {f.kind === '대변' && choice('stoolForm', ['보통', '묽음', '딱딱'])}
          </>)}

          {type === 'activity' && (<>
            <Field label="활동" value={f.activity ?? ''} onChangeText={set('activity')} placeholder="놀이터 바깥놀이" />
            <Field label="시간 (분)" value={f.durationMin ?? ''} onChangeText={set('durationMin')} keyboardType="number-pad" />
            {choice('intensity', ['가벼움', '보통', '높음'])}
          </>)}

          {type === 'symptom' && (<>
            <Field label="증상 *" value={f.symptom ?? ''} onChangeText={set('symptom')} placeholder="발열, 기침, 콧물, 발진…" />
            <Field label="체온 (℃, 선택)" value={f.temperatureC ?? ''} onChangeText={set('temperatureC')}
              keyboardType="decimal-pad" placeholder="38.2" />
            <Field label="부위 (선택)" value={f.bodyPart ?? ''} onChangeText={set('bodyPart')} />
            <Text style={{ fontSize: 13, color: '#52514e', marginBottom: 6 }}>심한 정도 (1 가벼움 ~ 5 심함)</Text>
            {choice('severity', ['1', '2', '3', '4', '5'])}
          </>)}

          {type === 'medication_dose' && (<>
            <Field label="약 이름 *" value={f.medicationName ?? ''} onChangeText={set('medicationName')} placeholder="해열제(병원 처방)" />
            <Field label="복용량 (기록용 자유 입력)" value={f.doseText ?? ''} onChangeText={set('doseText')} placeholder="처방 용량대로" />
            <Muted>앱은 용량을 계산하거나 추천하지 않습니다. 처방·설명서를 따라 주세요.</Muted>
          </>)}

          {type === 'incident' && (<>
            <Field label="무슨 일이 있었나요 *" value={f.what ?? ''} onChangeText={set('what')} placeholder="침대에서 낙상" />
            {choice('incidentSeverity', ['경미', '보통', '심각'])}
            <Field label="조치" value={f.action ?? ''} onChangeText={set('action')} placeholder="냉찜질 10분" />
          </>)}

          {type === 'media_use' && (<>
            <Field label="시간 (분)" value={f.durationMin ?? ''} onChangeText={set('durationMin')} keyboardType="number-pad" />
            <Field label="내용" value={f.content ?? ''} onChangeText={set('content')} placeholder="동요 영상" />
          </>)}

          {type === 'school' && (<>
            {choice('attended', ['등원/등교', '결석'])}
            <Field label="특이사항" value={f.note ?? ''} onChangeText={set('note')} />
          </>)}

          <Field label="메모 (선택)" value={memo} onChangeText={setMemo} multiline placeholder="자유롭게 기록" />
        </Section>

        <Section title={`사진 첨부 (현재 플랜: 최대 ${MAX_PHOTOS}장)`}>
          <Row style={{ flexWrap: 'wrap' }}>
            {photos.map((uri) => (
              <Pressable key={uri}
                onPress={() => setPhotos((prev) => prev.filter((p) => p !== uri))}>
                <Image source={{ uri }} style={photoStyles.thumb} />
                <Text style={photoStyles.remove}>✕</Text>
              </Pressable>
            ))}
            {photos.length < MAX_PHOTOS && (
              <Pressable onPress={pickPhotos} style={photoStyles.add}>
                <Text style={{ fontSize: 22, color: tokens.muted }}>＋</Text>
              </Pressable>
            )}
          </Row>
          <Muted>증상 부위, 발진, 처방전 등을 첨부하세요 (최대 {MAX_PHOTOS}장, 탭하면 삭제)</Muted>
          <Muted>아이 얼굴이 나오지 않게, 필요한 부위만 촬영해 주세요.</Muted>
        </Section>

        {categories.length > 0 && (
          <Muted>
            🏷 자동 분류: {categories.map((c) => `#${categoryLabel(c)}`).join(' ')}
            {' '}— 건강관리 영역은 기록 유형에 따라 자동 지정됩니다.
          </Muted>
        )}
        <View style={{ height: 8 }} />

        <Button label={busy ? '저장 중…' : '기록 저장'} onPress={save}
          disabled={busy || (type === 'symptom' && !f.symptom)} />
        <View style={{ height: 60 }} />
      </ScrollView>
    </KeyboardScreen>
  );
};

const photoStyles = StyleSheet.create({
  thumb: {
    width: 72, height: 72, borderRadius: 10, marginRight: 8, marginBottom: 8,
    backgroundColor: tokens.border,
  },
  remove: {
    position: 'absolute', top: 2, right: 10, color: '#fff', fontSize: 12,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1,
    overflow: 'hidden',
  },
  add: {
    width: 72, height: 72, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed',
    borderColor: tokens.border, alignItems: 'center', justifyContent: 'center',
    backgroundColor: tokens.surface,
  },
});
