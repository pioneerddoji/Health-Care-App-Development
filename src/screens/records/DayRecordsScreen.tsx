// 기록 탭 — 날짜 이동 + 해당일 기록을 유형(카테고리)별로 묶고, 그룹 안에서 시간순 정렬
import React, { useState } from 'react';
import { ScrollView, Text, Pressable, StyleSheet, View, Alert, Image } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useApp } from '../../context/AppContext';
import { Screen, Card, Button, Row, Muted, tokens } from '../../components/ui';
import { ChildSwitcher } from '../../components/ChildSwitcher';
import { RecordDetailModal } from '../../components/RecordDetailModal';
import { PhotoViewer } from '../../components/PhotoViewer';
import { RECORD_TYPES } from '../../constants/recordTypes';
import { categoryLabel } from '../../constants/categories';
import { addDays, formatKorean, today, weekday } from '../../lib/date';
import type { RootStackParamList } from '../../navigation/types';
import type { DailyRecord } from '../../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const recordLine = (r: DailyRecord): string => {
  const p = r.payload;
  switch (r.type) {
    case 'condition': return `컨디션 ${p.level ?? '-'}/5 ${p.mood ?? ''}`;
    case 'meal': return `${p.mealType ?? ''} ${p.amount ?? ''}${p.waterMl ? ` · 수분 ${p.waterMl}ml` : ''}`;
    case 'sleep': return `${p.sleepStart ?? ''}~${p.sleepEnd ?? ''} · 밤중 깸 ${p.nightWakings ?? 0}회`;
    case 'excretion': return `${p.kind ?? ''} ${p.count ?? 1}회${p.stoolForm ? ` (${p.stoolForm})` : ''}`;
    case 'activity': return `${p.activity ?? ''} ${p.durationMin ?? 0}분`;
    case 'symptom': return `${p.symptom ?? ''}${p.temperatureC ? ` ${p.temperatureC}℃` : ''}`;
    case 'medication_dose': return `${p.medicationName ?? ''} ${p.givenAt ?? ''}`;
    case 'incident': return `${p.what ?? ''} (${p.incidentSeverity ?? ''})`;
    case 'media_use': return `${p.durationMin ?? 0}분 ${p.content ?? ''}`;
    case 'school': return p.attended === false ? '결석' : '등원/등교';
    default: return p.note ?? r.memo ?? '';
  }
};

export const DayRecordsScreen = () => {
  const nav = useNavigation<Nav>();
  const { selectedChild, records, deleteRecord, canEdit, consentActive } = useApp();
  const [date, setDate] = useState(today());
  const [detail, setDetail] = useState<DailyRecord | null>(null);
  const [viewer, setViewer] = useState<{ uris: string[]; index: number } | null>(null);
  const editable = selectedChild ? canEdit(selectedChild.id) : false;
  const consented = selectedChild ? consentActive(selectedChild.id) : true;

  if (!selectedChild) {
    return (
      <Screen style={{ justifyContent: 'center', alignItems: 'center' }}>
        <Muted>홈에서 대상자를 먼저 선택해 주세요</Muted>
      </Screen>
    );
  }

  const dayRecords = records
    .filter((r) => r.childId === selectedChild.id && r.recordDate === date)
    .sort((a, b) => (a.recordTime ?? '').localeCompare(b.recordTime ?? ''));

  // 카테고리(기록 유형)별 그룹 — RECORD_TYPES 순서 유지, 그룹 내 시간순
  const groups = RECORD_TYPES
    .map((def) => ({ def, items: dayRecords.filter((r) => r.type === def.type) }))
    .filter((g) => g.items.length > 0);

  return (
    <Screen>
      <ChildSwitcher />
      <View style={styles.dateBar}>
        <Pressable onPress={() => setDate(addDays(date, -1))} style={styles.arrow}>
          <Text style={styles.arrowText}>‹</Text>
        </Pressable>
        <Pressable onPress={() => nav.navigate('Calendar')}>
          <Text style={styles.dateText}>{formatKorean(date)} ({weekday(date)})</Text>
        </Pressable>
        <Pressable
          onPress={() => setDate(addDays(date, 1))}
          style={styles.arrow}
          disabled={date >= today()}
        >
          <Text style={[styles.arrowText, date >= today() && { opacity: 0.3 }]}>›</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Muted>{selectedChild.name}의 기록 {dayRecords.length}건</Muted>
        <View style={{ height: 8 }} />
        {groups.map(({ def, items }) => (
          <View key={def.type} style={{ marginBottom: 14 }}>
            <Row style={{ marginBottom: 6 }}>
              <Text style={styles.groupTitle}>{def.emoji} {def.label}</Text>
              <Text style={styles.groupCount}>{items.length}건</Text>
            </Row>
            {items.map((r) => (
              <Pressable
                key={r.id}
                onPress={() => setDetail(r)}
                onLongPress={() =>
                  editable && Alert.alert('기록 삭제', '이 기록을 삭제할까요?', [
                    { text: '취소', style: 'cancel' },
                    {
                      text: '삭제', style: 'destructive',
                      onPress: () => {
                        deleteRecord(r.id).catch((e) =>
                          Alert.alert('삭제 실패', e instanceof Error ? e.message : String(e)));
                      },
                    },
                  ])
                }
              >
                <Card style={{ paddingVertical: 12, marginBottom: 8 }}>
                  <View style={styles.recordRow}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Text style={styles.recordBody}>{recordLine(r)}</Text>
                      {r.memo ? <Muted>메모: {r.memo}</Muted> : null}
                      {r.categories.length > 0 && (
                        <Text style={styles.tags}>{r.categories.map((c) => `#${categoryLabel(c)}`).join(' ')}</Text>
                      )}
                      {r.photoUris.length > 0 && (
                        <Row style={{ marginTop: 6, flexWrap: 'wrap' }}>
                          {r.photoUris.map((uri, i) => (
                            <Pressable key={uri} onPress={() => setViewer({ uris: r.photoUris, index: i })}>
                              <Image source={{ uri }} style={styles.photo} />
                            </Pressable>
                          ))}
                        </Row>
                      )}
                    </View>
                    <Text style={styles.time}>{r.recordTime ?? ''}</Text>
                  </View>
                </Card>
              </Pressable>
            ))}
          </View>
        ))}
        {dayRecords.length === 0 && (
          <Card><Muted>이 날의 기록이 없습니다{editable ? '. 아래 버튼으로 추가해 보세요.' : '.'}</Muted></Card>
        )}
        {!consented ? (
          <Muted>건강정보 수집 동의가 철회된 상태입니다 — 설정 → 동의 내역에서 재동의하면 다시 기록할 수 있어요.</Muted>
        ) : editable ? (
          <Button label="+ 기록 추가" onPress={() => nav.navigate('RecordForm', { date })} />
        ) : (
          <Muted>열람 전용 권한입니다 — 기록 추가/삭제는 편집자 이상만 가능합니다.</Muted>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>

      {detail && <RecordDetailModal record={detail} onClose={() => setDetail(null)} />}
      {viewer && (
        <PhotoViewer uris={viewer.uris} initialIndex={viewer.index} onClose={() => setViewer(null)} />
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  dateBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: tokens.surface,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: tokens.border,
  },
  arrow: { padding: 8 },
  arrowText: { fontSize: 24, color: tokens.primary },
  dateText: { fontSize: 16, fontWeight: '700', color: tokens.ink },
  groupTitle: { fontSize: 15, fontWeight: '800', color: tokens.ink },
  groupCount: { fontSize: 12, color: tokens.muted, marginLeft: 8 },
  recordRow: { flexDirection: 'row', alignItems: 'flex-start' },
  time: { fontSize: 12, color: tokens.muted, width: 42, textAlign: 'right', flexShrink: 0 },
  recordBody: { fontSize: 13, color: tokens.inkSecondary, marginTop: 2, flexShrink: 1 },
  tags: { fontSize: 11, color: tokens.primary, marginTop: 4 },
  photo: {
    width: 56, height: 56, borderRadius: 8, marginRight: 6,
    backgroundColor: tokens.border,
  },
});
