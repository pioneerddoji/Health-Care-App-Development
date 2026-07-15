// 동의 화면 — 만 14세 미만 아동의 법정대리인 동의 + 건강정보(민감정보) 별도 동의.
// 각 항목의 "전문 보기"로 약관 전체(src/constants/terms.ts)를 확인할 수 있다.
// [선택] 소식 알림 수신 동의는 마케팅 채널 확정 후 노출 예정 (현재 숨김 — terms.ts 참조).
import React, { useState } from 'react';
import {
  ScrollView, Text, Pressable, StyleSheet, View, Modal,
} from 'react-native';
import { Screen, Card, Button, Muted, Row, tokens } from '../../components/ui';
import { TERMS_DOCS, TermsDoc } from '../../constants/terms';

export const ConsentScreen = ({ onComplete }: { onComplete: () => void }) => {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [viewing, setViewing] = useState<TermsDoc | null>(null);
  const toggle = (key: string) => setChecked((p) => ({ ...p, [key]: !p[key] }));
  const allRequired = TERMS_DOCS.filter((d) => d.required).every((d) => checked[d.key]);

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <Text style={styles.title}>이용 동의</Text>
        <Muted>필수 항목은 각각 내용 확인 후 개별 동의가 필요합니다.</Muted>
        <View style={{ height: 12 }} />

        {TERMS_DOCS.map((doc) => (
          <Card key={doc.key} style={checked[doc.key] ? styles.cardChecked : undefined}>
            <Pressable onPress={() => toggle(doc.key)}>
              <Text style={styles.itemTitle}>
                {checked[doc.key] ? '☑' : '☐'} {doc.title}
              </Text>
              <Text style={styles.itemBody}>{doc.summary}</Text>
            </Pressable>
            <Row style={{ justifyContent: 'flex-end', marginTop: 8 }}>
              <Pressable onPress={() => setViewing(doc)} style={styles.viewBtn}>
                <Text style={styles.viewBtnText}>전문 보기 ›</Text>
              </Pressable>
            </Row>
          </Card>
        ))}

        <Button label="동의하고 시작하기" onPress={onComplete} disabled={!allRequired} />
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* 약관 전문 모달 */}
      <Modal visible={!!viewing} animationType="slide" onRequestClose={() => setViewing(null)}>
        <Screen style={{ paddingTop: 24 }}>
          <ScrollView contentContainerStyle={{ padding: 24 }}>
            <Text style={styles.modalTitle}>{viewing?.title}</Text>
            <Text style={styles.modalBody}>{viewing?.body}</Text>
            <View style={{ height: 16 }} />
            <Button
              label="확인했습니다 — 동의"
              onPress={() => {
                if (viewing) setChecked((p) => ({ ...p, [viewing.key]: true }));
                setViewing(null);
              }}
            />
            <Button label="닫기" variant="ghost" onPress={() => setViewing(null)} />
            <View style={{ height: 40 }} />
          </ScrollView>
        </Screen>
      </Modal>
    </Screen>
  );
};

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '800', color: tokens.ink, marginBottom: 6 },
  itemTitle: { fontSize: 14, fontWeight: '700', color: tokens.ink, marginBottom: 6 },
  itemBody: { fontSize: 12, color: tokens.inkSecondary, lineHeight: 18 },
  cardChecked: { borderColor: tokens.primary, borderWidth: 1 },
  viewBtn: { paddingVertical: 4, paddingHorizontal: 8 },
  viewBtnText: { fontSize: 13, color: tokens.primary, fontWeight: '600' },
  modalTitle: { fontSize: 18, fontWeight: '800', color: tokens.ink, marginBottom: 12 },
  modalBody: { fontSize: 13, color: tokens.inkSecondary, lineHeight: 21 },
});
