// 기록 상세 팝업 — 기록 카드를 탭하면 항목별 내용을 정리해 보여준다.
// 사진을 탭하면 PhotoViewer(좌우 슬라이드 뷰어)를 연다.
import React, { useState } from 'react';
import { Modal, View, Text, Pressable, Image, ScrollView, StyleSheet } from 'react-native';
import { tokens, Muted, Button, Row } from './ui';
import { PhotoViewer } from './PhotoViewer';
import { recordTypeDef } from '../constants/recordTypes';
import { categoryLabel } from '../constants/categories';
import { formatKorean, weekday } from '../lib/date';
import type { DailyRecord } from '../types';

// 유형별 payload를 "라벨 · 값" 행으로 정리 (값이 없는 행은 숨김)
const detailRows = (r: DailyRecord): Array<[string, string]> => {
  const p = r.payload;
  const rows: Array<[string, string | undefined | null]> = [];
  switch (r.type) {
    case 'condition':
      rows.push(['컨디션', p.level ? `${p.level} / 5` : undefined], ['기분', p.mood]);
      break;
    case 'symptom':
      rows.push(
        ['증상', p.symptom],
        ['체온', p.temperatureC ? `${p.temperatureC}℃` : undefined],
        ['부위', p.bodyPart],
        ['심한 정도', p.severity ? `${p.severity} / 5` : undefined],
      );
      break;
    case 'meal':
      rows.push(
        ['구분', p.mealType],
        ['섭취량', p.amount],
        ['먹은 것', p.items?.length ? p.items.join(', ') : undefined],
        ['수분', p.waterMl ? `${p.waterMl}ml` : undefined],
      );
      break;
    case 'sleep':
      rows.push(
        ['잠든 시각', p.sleepStart],
        ['깬 시각', p.sleepEnd],
        ['밤중 깸', p.nightWakings != null ? `${p.nightWakings}회` : undefined],
        ['수면 질', p.quality ? `${p.quality} / 5` : undefined],
      );
      break;
    case 'excretion':
      rows.push(
        ['종류', p.kind],
        ['횟수', p.count != null ? `${p.count}회` : undefined],
        ['형태', p.stoolForm],
        ['색', p.color],
      );
      break;
    case 'medication_dose':
      rows.push(
        ['약 이름', p.medicationName],
        ['복용 시각', p.givenAt],
        ['용량 메모', p.doseText],
      );
      break;
    case 'activity':
      rows.push(
        ['활동', p.activity],
        ['시간', p.durationMin ? `${p.durationMin}분` : undefined],
        ['강도', p.intensity],
      );
      break;
    case 'incident':
      rows.push(['무슨 일', p.what], ['정도', p.incidentSeverity], ['조치', p.action]);
      break;
    case 'media_use':
      rows.push(
        ['시간', p.durationMin ? `${p.durationMin}분` : undefined],
        ['내용', p.content],
      );
      break;
    case 'school':
      rows.push(
        ['등원/등교', p.attended === false ? '결석' : '출석'],
        ['내용', p.content],
      );
      break;
    case 'behavior':
      rows.push(['내용', p.content]);
      break;
    default:
      rows.push(['내용', p.note]);
  }
  return rows.filter((x): x is [string, string] => !!x[1]);
};

export const RecordDetailModal = ({
  record, onClose,
}: {
  record: DailyRecord;
  onClose: () => void;
}) => {
  const [photoIndex, setPhotoIndex] = useState<number | null>(null);
  const def = recordTypeDef(record.type);
  const rows = detailRows(record);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Row style={{ justifyContent: 'space-between', marginBottom: 4 }}>
            <Text style={styles.title}>{def.emoji} {def.label}</Text>
            {record.recordTime ? <Text style={styles.time}>{record.recordTime}</Text> : null}
          </Row>
          <Muted>{formatKorean(record.recordDate)} ({weekday(record.recordDate)})</Muted>
          <View style={{ height: 12 }} />

          <ScrollView style={{ maxHeight: 380 }}>
            {rows.map(([label, value]) => (
              <View key={label} style={styles.row}>
                <Text style={styles.rowLabel}>{label}</Text>
                <Text style={styles.rowValue}>{value}</Text>
              </View>
            ))}
            {record.memo ? (
              <View style={styles.row}>
                <Text style={styles.rowLabel}>메모</Text>
                <Text style={styles.rowValue}>{record.memo}</Text>
              </View>
            ) : null}
            {record.categories.length > 0 && (
              <Text style={styles.tags}>
                {record.categories.map((c) => `#${categoryLabel(c)}`).join(' ')}
              </Text>
            )}
            {record.photoUris.length > 0 && (
              <Row style={{ flexWrap: 'wrap', marginTop: 10 }}>
                {record.photoUris.map((uri, i) => (
                  <Pressable key={uri} onPress={() => setPhotoIndex(i)}>
                    <Image source={{ uri }} style={styles.photo} />
                  </Pressable>
                ))}
              </Row>
            )}
          </ScrollView>

          <Button label="닫기" variant="ghost" onPress={onClose} />
        </Pressable>
      </Pressable>

      {photoIndex != null && (
        <PhotoViewer
          uris={record.photoUris}
          initialIndex={photoIndex}
          onClose={() => setPhotoIndex(null)}
        />
      )}
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center', padding: 24,
  },
  sheet: {
    backgroundColor: tokens.surface, borderRadius: tokens.radius, padding: 20,
  },
  title: { fontSize: 17, fontWeight: '800', color: tokens.ink },
  time: { fontSize: 13, color: tokens.muted, fontWeight: '600' },
  row: {
    flexDirection: 'row', paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: tokens.border,
  },
  rowLabel: { width: 84, fontSize: 13, color: tokens.muted, flexShrink: 0 },
  rowValue: { flex: 1, fontSize: 14, color: tokens.ink, lineHeight: 20 },
  tags: { fontSize: 12, color: tokens.primary, marginTop: 10 },
  photo: {
    width: 64, height: 64, borderRadius: 8, marginRight: 8, marginBottom: 8,
    backgroundColor: tokens.border,
  },
});
