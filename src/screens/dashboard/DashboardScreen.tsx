// 대시보드 — 기간 선택(7/14/30일, 플랜별 게이팅) + 그래프 5종 (성장은 프로필에서)
// 그래프 카드를 길게 누르면 카드가 떠오르고, 누른 채 위/아래로 끌어 순서를 바꾼다
// (아이패드 홈 화면 방식). 순서는 기기에 저장된다.
import React, { useEffect, useMemo, useState } from 'react';
import { Text, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useApp } from '../../context/AppContext';
import { Screen, Chip, Row, Button, Muted, Disclaimer, tokens } from '../../components/ui';
import { ChildSwitcher } from '../../components/ChildSwitcher';
import { DragReorderList } from '../../components/DragReorderList';
import { LineChart, BarChart, GroupedBarChart, SymptomTimeline } from '../../components/charts/Charts';
import { PALETTE } from '../../components/charts/svg';
import {
  inPeriod, aggregateTemperature, aggregateSleep, aggregateMeals,
  aggregateExcretion, symptomTimeline,
} from '../../services/records';
import { daysAgo, today, dateRange, formatShort } from '../../lib/date';
import { demoStorage } from '../../lib/demoStorage';
import type { RootStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;
const PERIODS = [7, 14, 30];

const SECTION_KEYS = ['temp', 'sleep', 'meal', 'water', 'excretion', 'timeline'] as const;
type SectionKey = (typeof SECTION_KEYS)[number];
const ORDER_KEY = 'kidcare.dashboard.order.v1';

export const DashboardScreen = () => {
  const nav = useNavigation<Nav>();
  const { selectedChild, records, ent } = useApp();
  const [days, setDays] = useState(ent.dashboardPeriods.includes(14) ? 14 : ent.dashboardPeriods[0]);
  const [order, setOrder] = useState<SectionKey[]>([...SECTION_KEYS]);
  const from = daysAgo(days - 1);
  const to = today();

  useEffect(() => {
    demoStorage.getItem(ORDER_KEY).then((v) => {
      if (!v) return;
      try {
        const saved = (JSON.parse(v) as SectionKey[]).filter((k) => SECTION_KEYS.includes(k));
        // 앱 업데이트로 새 그래프가 추가돼도 목록에서 빠지지 않게 합친다
        setOrder([...saved, ...SECTION_KEYS.filter((k) => !saved.includes(k))]);
      } catch { /* 손상된 저장값은 기본 순서 유지 */ }
    });
  }, []);

  const applyOrder = (keys: string[]) => {
    const next = keys as SectionKey[];
    setOrder(next);
    demoStorage.setItem(ORDER_KEY, JSON.stringify(next));
  };

  const data = useMemo(() => {
    if (!selectedChild) return null;
    const period = inPeriod(records.filter((r) => r.childId === selectedChild.id), from, to);
    const range = dateRange(from, to);
    const events = symptomTimeline(period);
    const symptomNames = [...new Set(events.map((e) => e.symptom))];
    return {
      temps: aggregateTemperature(period),
      sleep: aggregateSleep(period, from, to),
      meals: aggregateMeals(period, from, to),
      excretion: aggregateExcretion(period, from, to),
      range,
      timelineRows: symptomNames.map((symptom) => ({
        symptom,
        cells: range.map((d) => {
          const hits = events.filter((e) => e.date === d && e.symptom === symptom);
          return hits.length ? Math.max(...hits.map((h) => h.severity)) : null;
        }),
      })),
    };
  }, [selectedChild, records, from, to]);

  if (!selectedChild || !data) {
    return (
      <Screen style={{ justifyContent: 'center', alignItems: 'center' }}>
        <Muted>홈에서 아이를 먼저 선택해 주세요</Muted>
      </Screen>
    );
  }

  const shortRange = data.range.map(formatShort);

  const sections: Record<SectionKey, React.ReactNode> = {
    temp: (
      <LineChart
        title="체온 (℃) — 붉은 점선: 37.5℃"
        unit="℃"
        points={data.temps.map((t) => ({ label: formatShort(t.date), value: t.value }))}
        refLine={{ value: 37.5, label: '37.5℃' }}
      />
    ),
    sleep: (
      <BarChart
        title="수면 시간 (시간/일) — 막대 위 숫자: 밤중 깸"
        unit="h"
        bars={data.sleep.map((s) => ({
          label: formatShort(s.date), value: s.totalHours,
          annotation: s.wakings > 0 ? `${s.wakings}` : undefined,
        }))}
      />
    ),
    meal: (
      <BarChart
        title="식사 섭취량 점수 (전량=1 · 절반=0.5)"
        bars={data.meals.map((m) => ({ label: formatShort(m.date), value: m.mealScore }))}
        color={PALETTE.series[1]}
      />
    ),
    water: (
      <BarChart
        title="수분 섭취 (ml/일)"
        unit=""
        bars={data.meals.map((m) => ({ label: formatShort(m.date), value: m.waterMl }))}
      />
    ),
    excretion: (
      <GroupedBarChart
        title="배변 횟수 (회/일)"
        labels={shortRange}
        series={[
          { name: '대변', color: PALETTE.series[0], values: data.excretion.map((e) => e.stool) },
          { name: '소변', color: PALETTE.series[1], values: data.excretion.map((e) => e.urine) },
        ]}
      />
    ),
    timeline: (
      <SymptomTimeline
        title="증상 타임라인 (점 크기 = 심한 정도)"
        dates={shortRange}
        rows={data.timelineRows}
      />
    ),
  };

  return (
    <Screen>
      <ChildSwitcher />
      <DragReorderList
        contentContainerStyle={{ padding: 16 }}
        header={
          <>
            <Row style={{ justifyContent: 'space-between', marginBottom: 12 }}>
              <Text style={styles.title}>{selectedChild.name}의 최근 {days}일</Text>
              <Row>
                {PERIODS.map((p) => {
                  const locked = !ent.dashboardPeriods.includes(p);
                  return (
                    <Chip key={p} label={locked ? `${p}일 🔒` : `${p}일`} selected={days === p}
                      onPress={() => (locked ? nav.navigate('Paywall') : setDays(p))} />
                  );
                })}
              </Row>
            </Row>
            <Button label="🗓 월간 캘린더 보기" variant="ghost" onPress={() => nav.navigate('Calendar')} />
            <View style={{ marginBottom: 8 }}>
              <Muted>그래프를 길게 누르면 떠오른 카드를 끌어서 순서를 바꿀 수 있어요.</Muted>
            </View>
          </>
        }
        items={order.map((key) => ({ key, node: sections[key] }))}
        onReorder={applyOrder}
        footer={<Disclaimer />}
      />
    </Screen>
  );
};

const styles = StyleSheet.create({
  title: { fontSize: 16, fontWeight: '800', color: tokens.ink },
});
