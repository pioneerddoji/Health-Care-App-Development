// 보호자 간 전달 보드 — 기록 확인과 진료 후 안내의 담당/기한/완료만 관리한다.
import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useApp } from '../../context/AppContext';
import { Button, Card, Chip, Field, Muted, Screen, Section, tokens } from '../../components/ui';
import type { ChildGuardian, DailyRecord } from '../../types';
import { today } from '../../lib/date';

export const CareHandoffScreen = () => {
  const { selectedChild, records, careTasks, canEdit, listGuardians, acknowledgeRecord, createCareTask, completeCareTask } = useApp();
  const [guardians, setGuardians] = useState<ChildGuardian[]>([]);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [assigneeId, setAssigneeId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!selectedChild) return;
    listGuardians(selectedChild.id).then(setGuardians).catch(() => setGuardians([]));
  }, [selectedChild, listGuardians]);

  if (!selectedChild) return <Screen style={styles.empty}><Muted>홈에서 대상자를 먼저 선택해 주세요</Muted></Screen>;
  const editable = canEdit(selectedChild.id);
  const latest = records.filter((r) => r.childId === selectedChild.id)
    .sort((a, b) => `${b.recordDate}${b.recordTime ?? ''}`.localeCompare(`${a.recordDate}${a.recordTime ?? ''}`))[0] as DailyRecord | undefined;
  const tasks = careTasks.filter((task) => task.childId === selectedChild.id);
  const guardianName = (id?: string) => guardians.find((g) => g.guardianId === id)?.name ?? '담당 미지정';

  const submit = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await createCareTask({ childId: selectedChild.id, title, note, assigneeId, dueDate: dueDate || undefined });
      setTitle(''); setNote(''); setDueDate(''); setAssigneeId(undefined);
    } catch (error) { Alert.alert('저장 실패', error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  return <Screen><ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.title}>공동 확인 · 진료 후 안내</Text>
    <Muted>보호자 간 전달 상태를 정리합니다. 의학적 판단이나 처방을 제공하지 않습니다.</Muted>

    <Section title="최근 기록 확인">
      <Card>
        {latest ? <>
          <Text style={styles.body}>{latest.recordDate} {latest.recordTime ?? ''} · {latest.type}</Text>
          <Muted>기록을 확인하면 공동 보호자에게 전달 상태가 남습니다.</Muted>
          <Button label="이 기록 확인함" variant="ghost" onPress={() => acknowledgeRecord(latest.id).catch((e) => Alert.alert('확인 실패', String(e)))} />
        </> : <Muted>아직 확인할 기록이 없습니다.</Muted>}
      </Card>
    </Section>

    <Section title="진료 후 안내 추가">
      <Card>
        {!editable ? <Muted>열람 전용 권한에서는 안내를 추가하거나 완료할 수 없습니다.</Muted> : <>
          <Field label="전달할 안내" value={title} onChangeText={setTitle} placeholder="예: 다음 방문 전 기록을 함께 확인" accessibilityLabel="진료 후 전달할 안내" />
          <Field label="세부 메모 (선택)" value={note} onChangeText={setNote} multiline placeholder="진료실에서 들은 내용을 보호자끼리 확인해 보세요." />
          <Field label="기한 (YYYY-MM-DD, 선택)" value={dueDate} onChangeText={setDueDate} placeholder={today()} />
          <Text style={styles.label}>담당 보호자</Text><View style={styles.chips}>
            {guardians.map((g) => <Chip key={g.guardianId} label={g.isMe ? `${g.name} (나)` : g.name} selected={assigneeId === g.guardianId} onPress={() => setAssigneeId(g.guardianId)} />)}
          </View>
          <Button label={busy ? '저장 중…' : '안내 저장 · 알림 예약'} onPress={submit} disabled={busy || !title.trim()} />
        </>}
      </Card>
    </Section>

    <Section title={`진료 후 안내 ${tasks.length}건`}>
      {tasks.length === 0 ? <Card><Muted>아직 등록된 안내가 없습니다.</Muted></Card> : tasks.map((task) => <Card key={task.id}>
        <Text style={styles.body}>{task.completedAt ? '✓ 완료' : '○ 진행 중'} · {task.title}</Text>
        {task.note ? <Muted>{task.note}</Muted> : null}
        <Muted>담당: {guardianName(task.assigneeId)}{task.dueDate ? ` · 기한 ${task.dueDate}` : ''}</Muted>
        {!task.completedAt && editable ? <Button label="완료로 표시" variant="ghost" onPress={() => completeCareTask(task.id).catch((e) => Alert.alert('완료 처리 실패', String(e)))} /> : null}
      </Card>)}
    </Section>
  </ScrollView></Screen>;
};
const styles = StyleSheet.create({ content: { padding: 16 }, empty: { justifyContent: 'center', alignItems: 'center' }, title: { fontSize: 19, fontWeight: '800', color: tokens.ink, marginBottom: 4 }, body: { fontSize: 14, color: tokens.ink, fontWeight: '600', marginBottom: 5 }, label: { fontSize: 13, color: tokens.inkSecondary, marginBottom: 6 }, chips: { flexDirection: 'row', flexWrap: 'wrap' } });
