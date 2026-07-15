// 월간 캘린더 — 날짜별 기록 유무(·) / 증상(⚠) 뱃지
import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useApp } from '../../context/AppContext';
import { Screen, Row, Muted, tokens } from '../../components/ui';
import { toISODate, today } from '../../lib/date';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

export const CalendarScreen = () => {
  const { selectedChild, records } = useApp();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-based
  const [selected, setSelected] = useState(today());

  const move = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  };

  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = [
    ...Array<null>(first.getDay()).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => toISODate(new Date(year, month, i + 1))),
  ];

  const childRecords = records.filter((r) => r.childId === selectedChild?.id);
  const dayInfo = (iso: string) => {
    const day = childRecords.filter((r) => r.recordDate === iso);
    return { has: day.length > 0, symptom: day.some((r) => r.type === 'symptom') };
  };
  const selectedRecords = childRecords.filter((r) => r.recordDate === selected);

  return (
    <Screen>
      <Row style={styles.header}>
        <Pressable onPress={() => move(-1)} style={{ padding: 8 }}>
          <Text style={styles.arrow}>‹</Text>
        </Pressable>
        <Text style={styles.month}>{year}년 {month + 1}월</Text>
        <Pressable onPress={() => move(1)} style={{ padding: 8 }}>
          <Text style={styles.arrow}>›</Text>
        </Pressable>
      </Row>
      <Row style={{ paddingHorizontal: 12 }}>
        {WEEK.map((w) => (
          <Text key={w} style={styles.weekday}>{w}</Text>
        ))}
      </Row>
      <View style={styles.grid}>
        {cells.map((iso, i) => {
          if (!iso) return <View key={`e${i}`} style={styles.cell} />;
          const info = dayInfo(iso);
          const isSelected = iso === selected;
          return (
            <Pressable key={iso} style={[styles.cell, isSelected && styles.cellSelected]}
              onPress={() => setSelected(iso)}>
              <Text style={[styles.dayNum, iso === today() && { color: tokens.primary, fontWeight: '800' }]}>
                {Number(iso.slice(8))}
              </Text>
              <Text style={styles.badge}>
                {info.symptom ? '⚠' : info.has ? '·' : ' '}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Text style={styles.selTitle}>{selected} 기록 {selectedRecords.length}건</Text>
        {selectedRecords.length === 0
          ? <Muted>기록이 없습니다</Muted>
          : selectedRecords.map((r) => (
            <Text key={r.id} style={styles.selLine}>
              {r.recordTime ?? '--:--'} · {r.type === 'symptom'
                ? `⚠ ${r.payload.symptom}${r.payload.temperatureC ? ` ${r.payload.temperatureC}℃` : ''}`
                : r.type}
            </Text>
          ))}
      </ScrollView>
    </Screen>
  );
};

const styles = StyleSheet.create({
  header: { justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  arrow: { fontSize: 24, color: tokens.primary },
  month: { fontSize: 17, fontWeight: '800', color: tokens.ink },
  weekday: { flex: 1, textAlign: 'center', fontSize: 11, color: tokens.muted, paddingVertical: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12 },
  cell: {
    width: `${100 / 7}%`, aspectRatio: 0.85, alignItems: 'center',
    justifyContent: 'center', borderRadius: 10,
  },
  cellSelected: { backgroundColor: tokens.primarySoft },
  dayNum: { fontSize: 13, color: tokens.ink },
  badge: { fontSize: 10, height: 14, color: tokens.primary },
  selTitle: { fontSize: 14, fontWeight: '700', color: tokens.ink, marginBottom: 8 },
  selLine: { fontSize: 13, color: tokens.inkSecondary, marginBottom: 4 },
});
