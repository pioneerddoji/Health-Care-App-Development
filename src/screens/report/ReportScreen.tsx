// 병원 제출용 레포트 — 기간 선택 + 의사에게 질문 → PDF 생성/공유 + 만료형 링크 발행
import React, { useState } from 'react';
import { ScrollView, Text, StyleSheet, View, Alert, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { useApp } from '../../context/AppContext';
import {
  Screen, Card, Chip, Row, Button, Field, Muted, Disclaimer, tokens,
} from '../../components/ui';
import { ChildSwitcher } from '../../components/ChildSwitcher';
import { generateReportPdf, shareReportPdf } from '../../services/reportPdf';
import { summarizePeriod, inPeriod } from '../../services/records';
import { daysAgo, today, formatKorean } from '../../lib/date';
import type { ShareLinkInfo } from '../../types';

const PERIODS = [
  { label: '최근 7일', days: 7 },
  { label: '최근 14일', days: 14 },
  { label: '최근 30일', days: 30 },
];

const EXPIRY_OPTIONS = [
  { label: '24시간', hours: 24 },
  { label: '72시간', hours: 72 },
  { label: '7일', hours: 24 * 7 },
];

const formatExpiry = (iso: string): string => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export const ReportScreen = () => {
  const {
    selectedChild, records, growth, medications, vaccinations, guardian,
    publishReport, createShareLink, listShareLinks, mode, ent,
  } = useApp();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [days, setDays] = useState(ent.reportPeriods.includes(14) ? 14 : ent.reportPeriods[0]);
  const [questions, setQuestions] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [expiryHours, setExpiryHours] = useState(
    ent.shareExpiryHours.includes(72) ? 72 : ent.shareExpiryHours[0]);
  const [busyLink, setBusyLink] = useState(false);
  const [lastLink, setLastLink] = useState<ShareLinkInfo | null>(null);

  if (!selectedChild) {
    return (
      <Screen style={{ justifyContent: 'center', alignItems: 'center' }}>
        <Muted>홈에서 대상자를 먼저 선택해 주세요</Muted>
      </Screen>
    );
  }

  const from = daysAgo(days - 1);
  const to = today();
  const childRecords = records.filter((r) => r.childId === selectedChild.id);
  const summary = summarizePeriod(inPeriod(childRecords, from, to), from, to);

  const addQuestion = () => {
    if (draft.trim()) {
      setQuestions((q) => [...q, draft.trim()]);
      setDraft('');
    }
  };

  const buildPdf = () => generateReportPdf({
    child: selectedChild,
    records: childRecords,
    growth: growth.filter((g) => g.childId === selectedChild.id),
    medications,
    vaccinations,
    periodStart: from,
    periodEnd: to,
    questionsForDoctor: questions,
    guardianName: guardian?.name ?? '보호자',
  });

  const generate = async () => {
    setBusy(true);
    try {
      const { uri } = await buildPdf();
      await shareReportPdf(uri);
    } catch (e) {
      Alert.alert('레포트 생성 실패', String(e));
    } finally {
      setBusy(false);
    }
  };

  const generateShareLink = async () => {
    setBusyLink(true);
    setLastLink(null);
    try {
      // 티어별 활성 링크 수 한도
      if (ent.maxActiveShareLinks !== Infinity) {
        const links = await listShareLinks(selectedChild.id);
        const active = links.filter(
          (l) => !l.revokedAt && new Date(l.expiresAt).getTime() > Date.now()).length;
        if (active >= ent.maxActiveShareLinks) {
          throw new Error(`현재 플랜에서는 활성 공유 링크를 ${ent.maxActiveShareLinks}개까지 둘 수 있어요. 설정에서 기존 링크를 회수하거나 플랜을 업그레이드해 주세요.`);
        }
      }
      // 데모 모드는 업로드가 없으므로 PDF 생성을 건너뛴다 (웹 프리뷰에서도 동작)
      const uri = mode === 'mock' ? 'demo://report.pdf' : (await buildPdf()).uri;
      const report = await publishReport({
        childId: selectedChild.id,
        localPdfUri: uri,
        periodStart: from,
        periodEnd: to,
        questionsForDoctor: questions,
      });
      const link = await createShareLink(report.id, expiryHours);
      setLastLink(link);
    } catch (e) {
      Alert.alert('공유 링크 생성 실패', String(e));
    } finally {
      setBusyLink(false);
    }
  };

  const copyLink = async (url: string) => {
    await Clipboard.setStringAsync(url);
    Alert.alert('복사됨', '공유 링크가 클립보드에 복사되었습니다.');
  };

  const shareLink = (url: string, expiresAt: string) => {
    Share.share({
      message: `${selectedChild?.name}의 건강 기록 레포트입니다 (${formatExpiry(expiresAt)}까지 열람 가능)\n${url}`,
    });
  };

  return (
    <Screen>
      <ChildSwitcher />
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Text style={styles.title}>병원 제출용 레포트 📄</Text>
        <Muted>{selectedChild.name} · {formatKorean(from)} ~ {formatKorean(to)}</Muted>
        <View style={{ height: 12 }} />

        <Row style={{ marginBottom: 12 }}>
          {PERIODS.map((p) => {
            const locked = !ent.reportPeriods.includes(p.days);
            return (
              <Chip key={p.days} label={locked ? `${p.label} 🔒` : p.label}
                selected={days === p.days}
                onPress={() => (locked ? nav.navigate('Paywall') : setDays(p.days))} />
            );
          })}
        </Row>

        <Card>
          <Text style={styles.cardTitle}>포함될 내용 미리보기</Text>
          <Text style={styles.line}>· 총 기록 {summary.totalRecords}건</Text>
          <Text style={styles.line}>· 발열(37.5℃↑) 기록일 {summary.feverDayCount}일
            {summary.maxTemp != null ? ` (최고 ${summary.maxTemp}℃)` : ''}</Text>
          <Text style={styles.line}>· 증상: {summary.symptomNames.length ? summary.symptomNames.join(', ') : '없음'}</Text>
          <Text style={styles.line}>· 평균 수면 {summary.avgSleepHours != null ? `${summary.avgSleepHours}시간` : '기록 없음'} · 약 복용 {summary.medicationDoseCount}회</Text>
          <Text style={styles.line}>· 알레르기 {selectedChild.allergies.length}건 · 체온/수면/식사/배변 그래프, 상세 기록, 복용약 포함</Text>
        </Card>

        <Card>
          <Text style={styles.cardTitle}>의사 선생님께 묻고 싶은 질문</Text>
          {questions.map((q, i) => (
            <Row key={i} style={{ justifyContent: 'space-between', marginBottom: 6 }}>
              <Text style={[styles.line, { flex: 1 }]}>{i + 1}. {q}</Text>
              <Text style={{ color: tokens.danger }}
                onPress={() => setQuestions((qs) => qs.filter((_, j) => j !== i))}> 삭제</Text>
            </Row>
          ))}
          <Field label="" value={draft} onChangeText={setDraft}
            placeholder="예: 열이 떨어진 뒤에도 기침이 계속되는데 괜찮을까요?" />
          <Button label="+ 질문 추가" variant="ghost" onPress={addQuestion} />
        </Card>

        <Button label={busy ? '생성 중…' : 'PDF 레포트 생성 · 바로 공유'} onPress={generate} disabled={busy} />

        <Card>
          <Text style={styles.cardTitle}>🔗 만료형 공유 링크 만들기</Text>
          <Muted>병원 방문 전, 링크 하나로 전달하고 기간이 지나면 자동으로 닫힙니다. 설정에서 언제든 회수할 수 있습니다.</Muted>
          <View style={{ height: 8 }} />
          <Row style={{ marginBottom: 8 }}>
            {EXPIRY_OPTIONS.map((o) => {
              const locked = !ent.shareExpiryHours.includes(o.hours);
              return (
                <Chip key={o.hours} label={locked ? `${o.label} 🔒` : o.label}
                  selected={expiryHours === o.hours}
                  onPress={() => (locked ? nav.navigate('Paywall') : setExpiryHours(o.hours))} />
              );
            })}
          </Row>
          <Button label={busyLink ? '링크 만드는 중…' : '공유 링크 만들기'} variant="ghost"
            onPress={generateShareLink} disabled={busyLink} />

          {lastLink && (
            <View style={styles.linkBox}>
              <Text style={styles.linkText} numberOfLines={1}>{lastLink.url}</Text>
              <Muted>{formatExpiry(lastLink.expiresAt)}까지 열람 가능</Muted>
              <Row style={{ marginTop: 8 }}>
                <View style={{ flex: 1 }}>
                  <Button label="복사" variant="ghost" onPress={() => copyLink(lastLink.url)} />
                </View>
                <View style={{ width: 8 }} />
                <View style={{ flex: 1 }}>
                  <Button label="공유" variant="ghost" onPress={() => shareLink(lastLink.url, lastLink.expiresAt)} />
                </View>
              </Row>
            </View>
          )}
          {mode === 'mock' && <Muted>데모 모드: 실제로 열리지 않는 예시 링크입니다.</Muted>}
        </Card>

        <Disclaimer />
      </ScrollView>
    </Screen>
  );
};

const styles = StyleSheet.create({
  title: { fontSize: 19, fontWeight: '800', color: tokens.ink },
  cardTitle: { fontSize: 14, fontWeight: '700', color: tokens.ink, marginBottom: 8 },
  line: { fontSize: 13, color: tokens.inkSecondary, lineHeight: 20 },
  linkBox: {
    marginTop: 12, padding: 12, borderRadius: 10, backgroundColor: tokens.primarySoft,
  },
  linkText: { fontSize: 13, color: tokens.primary, fontWeight: '600', marginBottom: 4 },
});
