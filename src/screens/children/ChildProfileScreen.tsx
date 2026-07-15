// 아이 프로필 상세 + 성장(키/체중/BMI) 그래프 + 접종/검진 진입
import React from 'react';
import { ScrollView, Text, StyleSheet, View } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useApp } from '../../context/AppContext';
import { Screen, Card, Button, Row, Muted, tokens } from '../../components/ui';
import { LineChart } from '../../components/charts/Charts';
import { formatKorean, formatShort, koreanAge } from '../../lib/date';
import { PALETTE } from '../../components/charts/svg';
import type { RootStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const InfoRow = ({ label, value }: { label: string; value?: string }) =>
  value ? (
    <Row style={{ justifyContent: 'space-between', marginBottom: 6 }}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </Row>
  ) : null;

export const ChildProfileScreen = () => {
  const nav = useNavigation<Nav>();
  const route = useRoute<RouteProp<RootStackParamList, 'ChildProfile'>>();
  const { children, growth, medications, canEdit } = useApp();
  const child = children.find((c) => c.id === route.params.childId);
  if (!child) return null;
  const editable = canEdit(child.id);

  const g = growth
    .filter((m) => m.childId === child.id)
    .sort((a, b) => a.measuredOn.localeCompare(b.measuredOn));
  const meds = medications.filter((m) => m.childId === child.id && m.isActive);

  // 성장 3종은 스케일이 달라 별도 차트(단일 축 원칙)
  const growthPoints = (pick: (m: typeof g[number]) => number | undefined) =>
    g.map((m) => ({ label: formatShort(m.measuredOn), value: pick(m) ?? null }));

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Card>
          <Row>
            <Text style={{ fontSize: 40, marginRight: 14 }}>{child.sex === 'female' ? '👧' : '👦'}</Text>
            <View>
              <Text style={styles.name}>{child.name}{child.nickname ? ` (${child.nickname})` : ''}</Text>
              <Muted>{formatKorean(child.birthDate)} 출생 · {koreanAge(child.birthDate)} · {child.sex === 'female' ? '여아' : '남아'}</Muted>
            </View>
          </Row>
          <View style={{ height: 12 }} />
          <InfoRow label="출생 체중" value={child.birthWeightG ? `${child.birthWeightG}g` : undefined} />
          <InfoRow label="재태 주수" value={child.gestationalWeeks ? `${child.gestationalWeeks}주${child.isPreterm ? ' (조산)' : ''}` : undefined} />
          <InfoRow label="혈액형" value={child.bloodType} />
          <InfoRow label="주치의" value={child.primaryDoctor} />
          <InfoRow label="병원" value={child.primaryHospital} />
          <InfoRow label="보호자 연락처" value={child.guardianPhone} />
          {editable ? (
            <Button label="프로필 수정" variant="ghost"
              onPress={() => nav.navigate('ChildForm', { childId: child.id })} />
          ) : (
            <Muted>열람 전용 권한 — 프로필 수정은 편집자 이상만 가능합니다</Muted>
          )}
        </Card>

        <Card>
          <Text style={styles.cardTitle}>⚠ 알레르기</Text>
          <Text style={styles.body}>{child.allergies.length ? child.allergies.join(', ') : '등록 없음'}</Text>
          <Text style={[styles.cardTitle, { marginTop: 12 }]}>만성질환</Text>
          <Text style={styles.body}>{child.chronicConditions.length ? child.chronicConditions.join(', ') : '등록 없음'}</Text>
          {child.otherNotes ? (
            <>
              <Text style={[styles.cardTitle, { marginTop: 12 }]}>기타</Text>
              <Text style={styles.body}>{child.otherNotes}</Text>
            </>
          ) : null}
          {child.hospitalizations.length > 0 && (
            <>
              <Text style={[styles.cardTitle, { marginTop: 12 }]}>입원 이력</Text>
              {child.hospitalizations.map((h, i) => (
                <Text key={i} style={styles.body}>· {h.name}{h.date ? ` (${formatKorean(h.date)})` : ''}{h.hospital ? ` · ${h.hospital}` : ''}</Text>
              ))}
            </>
          )}
          {child.surgeries.length > 0 && (
            <>
              <Text style={[styles.cardTitle, { marginTop: 12 }]}>수술 이력</Text>
              {child.surgeries.map((h, i) => (
                <Text key={i} style={styles.body}>· {h.name}{h.date ? ` (${formatKorean(h.date)})` : ''}{h.hospital ? ` · ${h.hospital}` : ''}</Text>
              ))}
            </>
          )}
        </Card>

        <Card>
          <Text style={styles.cardTitle}>💊 복용 중인 약</Text>
          {meds.length === 0 && <Text style={styles.body}>복용 중인 약 없음</Text>}
          {meds.map((m) => (
            <Text key={m.id} style={styles.body}>
              · {m.name}{m.doseText ? ` — ${m.doseText}` : ''}{m.scheduleText ? ` (${m.scheduleText})` : ''}
            </Text>
          ))}
          <Muted>용법은 처방/기록 그대로 표시합니다. 앱은 용량을 계산하지 않습니다.</Muted>
        </Card>

        <Text style={styles.section}>성장 그래프</Text>
        <LineChart title="키 (cm)" unit="" points={growthPoints((m) => m.heightCm)} />
        <LineChart title="체중 (kg)" unit="" color={PALETTE.series[1]} points={growthPoints((m) => m.weightKg)} />
        <LineChart title="BMI" unit="" color={PALETTE.series[4]} points={growthPoints((m) => m.bmi)} />

        <Button label="💉 예방접종 · 건강검진 기록"
          onPress={() => nav.navigate('Vaccination', { childId: child.id })} />
        <View style={{ height: 40 }} />
      </ScrollView>
    </Screen>
  );
};

const styles = StyleSheet.create({
  name: { fontSize: 20, fontWeight: '800', color: tokens.ink },
  cardTitle: { fontSize: 14, fontWeight: '700', color: tokens.ink, marginBottom: 4 },
  body: { fontSize: 13, color: tokens.inkSecondary, lineHeight: 20 },
  section: { fontSize: 15, fontWeight: '700', color: tokens.ink, marginVertical: 10 },
  infoLabel: { fontSize: 13, color: tokens.muted },
  infoValue: { fontSize: 13, color: tokens.ink, fontWeight: '500' },
});
