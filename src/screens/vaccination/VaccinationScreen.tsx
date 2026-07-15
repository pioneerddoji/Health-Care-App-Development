// 예방접종 · 건강검진 — 수동 입력, 예정/완료, 이상반응, 예정일 로컬 알림
import React, { useEffect, useState } from 'react';
import { ScrollView, Text, StyleSheet, View, Alert, Linking, Platform } from 'react-native';
import { useRoute, RouteProp } from '@react-navigation/native';
import { useApp } from '../../context/AppContext';
import { Screen, Card, Button, Field, Row, Muted, Section, tokens } from '../../components/ui';
import { isNotificationDenied } from '../../services/reminders';
import { formatKorean, today } from '../../lib/date';
import type { RootStackParamList } from '../../navigation/types';

export const VaccinationScreen = () => {
  const route = useRoute<RouteProp<RootStackParamList, 'Vaccination'>>();
  const { vaccinations, checkups, addVaccination, updateVaccination, addCheckup, canEdit } = useApp();
  const childId = route.params.childId;
  const editable = canEdit(childId);

  const [name, setName] = useState('');
  const [doseNo, setDoseNo] = useState('1');
  const [dueDate, setDueDate] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [notifDenied, setNotifDenied] = useState(false);

  useEffect(() => {
    isNotificationDenied().then(setNotifDenied).catch(() => {});
  }, []);

  const myVaccs = vaccinations.filter((v) => v.childId === childId);
  const planned = myVaccs.filter((v) => !v.doneDate);
  const done = myVaccs.filter((v) => v.doneDate);
  const myCheckups = checkups.filter((c) => c.childId === childId);

  const alertError = (e: unknown) =>
    Alert.alert('저장 실패', e instanceof Error ? e.message : String(e));

  const add = async () => {
    try {
      await addVaccination({
        childId, vaccineName: name, doseNo: Number(doseNo) || 1,
        dueDate: dueDate || undefined,
      });
      setName(''); setDoseNo('1'); setDueDate(''); setShowForm(false);
    } catch (e) { alertError(e); }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {notifDenied && (
          <Card style={{ borderColor: tokens.danger, borderWidth: 1 }}>
            <Text style={styles.reaction}>🔕 알림 권한이 꺼져 있어 예정일 알림을 보낼 수 없어요.</Text>
            {Platform.OS !== 'web' && (
              <Button label="기기 설정에서 알림 켜기" variant="ghost"
                onPress={() => { Linking.openSettings().catch(() => {}); }} />
            )}
          </Card>
        )}
        <Section title="💉 예정된 접종">
          {planned.length === 0 && <Card><Muted>예정된 접종이 없습니다</Muted></Card>}
          {planned.map((v) => (
            <Card key={v.id}>
              <Row style={{ justifyContent: 'space-between' }}>
                <View>
                  <Text style={styles.name}>{v.vaccineName} {v.doseNo}차</Text>
                  <Muted>{v.dueDate ? `예정일 ${formatKorean(v.dueDate)}` : '예정일 미정'}</Muted>
                </View>
                {editable && (
                  <Button label="완료 처리" variant="ghost"
                    onPress={() => { updateVaccination(v.id, { doneDate: today() }).catch(alertError); }} />
                )}
              </Row>
            </Card>
          ))}
          {!editable ? null : showForm ? (
            <Card>
              <Field label="백신 이름 *" value={name} onChangeText={setName} placeholder="인플루엔자" />
              <Field label="차수" value={doseNo} onChangeText={setDoseNo} keyboardType="number-pad" />
              <Field label="예정일 (YYYY-MM-DD)" value={dueDate} onChangeText={setDueDate} placeholder="2026-08-01" />
              <Button label="추가" onPress={add} disabled={!name} />
            </Card>
          ) : (
            <Button label="+ 접종 일정 추가" variant="ghost" onPress={() => setShowForm(true)} />
          )}
        </Section>

        <Section title="✅ 완료된 접종">
          {done.length === 0 && <Card><Muted>완료된 접종 기록이 없습니다</Muted></Card>}
          {done.map((v) => (
            <Card key={v.id}>
              <Text style={styles.name}>{v.vaccineName} {v.doseNo}차</Text>
              <Muted>{v.doneDate ? formatKorean(v.doneDate) : ''}{v.hospital ? ` · ${v.hospital}` : ''}</Muted>
              {v.adverseReaction
                ? <Text style={styles.reaction}>이상반응: {v.adverseReaction}</Text>
                : <Muted>이상반응 기록 없음</Muted>}
            </Card>
          ))}
        </Section>

        <Section title="🩺 건강검진">
          {myCheckups.map((c) => (
            <Card key={c.id}>
              <Text style={styles.name}>{c.checkupName}</Text>
              <Muted>
                {c.doneDate ? `완료 ${formatKorean(c.doneDate)}` : c.dueDate ? `예정 ${formatKorean(c.dueDate)}` : ''}
                {c.hospital ? ` · ${c.hospital}` : ''}
              </Muted>
              {c.resultSummary ? <Text style={styles.reaction}>{c.resultSummary}</Text> : null}
            </Card>
          ))}
          {editable && (
            <Button label="+ 검진 일정 추가" variant="ghost"
              onPress={() => { addCheckup({ childId, checkupName: '건강검진', dueDate: today() }).catch(alertError); }} />
          )}
        </Section>
        <View style={{ height: 40 }} />
      </ScrollView>
    </Screen>
  );
};

const styles = StyleSheet.create({
  name: { fontSize: 15, fontWeight: '700', color: tokens.ink },
  reaction: { fontSize: 13, color: tokens.inkSecondary, marginTop: 4 },
});
