// 홈 — 다자녀 카드 목록 + 선택된 아이의 오늘 요약
import React from 'react';
import { ScrollView, Text, Pressable, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useApp } from '../../context/AppContext';
import { Screen, Card, Button, Row, Muted, Disclaimer, tokens } from '../../components/ui';
import { koreanAge, today } from '../../lib/date';
import type { RootStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export const ChildListScreen = () => {
  const nav = useNavigation<Nav>();
  const { children, records, selectedChildId, selectChild, guardian, roleOf, ent } = useApp();
  const ROLE_BADGE = { owner: '', editor: ' · 편집자', viewer: ' · 열람 전용 🔒' } as const;
  const ownedCount = children.filter((c) => roleOf(c.id) === 'owner').length;
  const atChildLimit = ownedCount >= ent.maxChildren;

  const todaySummary = (childId: string) => {
    const t = records.filter((r) => r.childId === childId && r.recordDate === today());
    const lastTemp = t.filter((r) => r.payload.temperatureC != null).pop();
    const sleep = t.find((r) => r.type === 'sleep');
    const meals = t.filter((r) => r.type === 'meal').length;
    const parts: string[] = [];
    if (lastTemp) parts.push(`체온 ${lastTemp.payload.temperatureC}℃`);
    if (sleep?.payload.sleepStart) parts.push(`수면 ${sleep.payload.sleepStart}~${sleep.payload.sleepEnd}`);
    parts.push(`식사 ${meals}회 기록`);
    return parts.join(' · ');
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Row style={{ justifyContent: 'space-between', marginBottom: 16 }}>
          <View>
            <Text style={styles.hello}>안녕하세요, {guardian?.name ?? '보호자'}님 👋</Text>
            <Muted>오늘도 아이의 하루를 기록해요</Muted>
          </View>
          <Pressable onPress={() => nav.navigate('Settings')}>
            <Text style={{ fontSize: 22 }}>⚙️</Text>
          </Pressable>
        </Row>

        {children.length === 0 && (
          <Card style={{ alignItems: 'center', paddingVertical: 32 }}>
            <Text style={{ fontSize: 40, marginBottom: 8 }}>🧸</Text>
            <Text style={styles.emptyTitle}>아직 등록된 아이가 없어요</Text>
            <Muted>아래 버튼으로 첫 아이를 등록하고 기록을 시작해 보세요</Muted>
          </Card>
        )}
        {children.map((child) => {
          const selected = child.id === selectedChildId;
          return (
            <Pressable
              key={child.id}
              onPress={() => selectChild(child.id)}
              onLongPress={() => nav.navigate('ChildProfile', { childId: child.id })}
            >
              <Card style={selected ? styles.selectedCard : undefined}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Row>
                    <Text style={{ fontSize: 30, marginRight: 12 }}>
                      {child.sex === 'female' ? '👧' : '👦'}
                    </Text>
                    <View>
                      <Text style={styles.name}>
                        {child.name}
                        {child.nickname ? <Text style={styles.nick}> ({child.nickname})</Text> : null}
                      </Text>
                      <Muted>{koreanAge(child.birthDate)}{ROLE_BADGE[roleOf(child.id)]}{selected ? ' · 선택됨' : ''}</Muted>
                    </View>
                  </Row>
                  <Pressable onPress={() => nav.navigate('ChildProfile', { childId: child.id })}>
                    <Text style={{ color: tokens.primary, fontSize: 13 }}>프로필 ›</Text>
                  </Pressable>
                </Row>
                <Text style={styles.summary}>{todaySummary(child.id)}</Text>
                {child.allergies.length > 0 && (
                  <Text style={styles.allergy}>⚠ 알레르기: {child.allergies.join(', ')}</Text>
                )}
              </Card>
            </Pressable>
          );
        })}

        {atChildLimit ? (
          <Button label="+ 아이 추가하기 (플랜 업그레이드 필요) 🔒" variant="ghost"
            onPress={() => nav.navigate('Paywall')} />
        ) : (
          <Button label="+ 아이 추가하기" variant="ghost" onPress={() => nav.navigate('ChildForm', {})} />
        )}
        <Disclaimer />
      </ScrollView>
    </Screen>
  );
};

const styles = StyleSheet.create({
  hello: { fontSize: 19, fontWeight: '800', color: tokens.ink },
  name: { fontSize: 16, fontWeight: '700', color: tokens.ink },
  nick: { fontSize: 13, fontWeight: '400', color: tokens.muted },
  summary: { fontSize: 12, color: tokens.inkSecondary, marginTop: 10 },
  allergy: { fontSize: 12, color: tokens.danger, marginTop: 4 },
  selectedCard: { borderColor: tokens.primary, borderWidth: 1.5 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: tokens.ink, marginBottom: 4 },
});
