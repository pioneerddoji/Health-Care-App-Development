// 개인정보처리방침 — 스토어 심사 대비 초안. 실제 배포 전 법률 검토 필요.
// 웹 게시본(스토어 등록용 URL)은 docs/privacy_policy.md 를 기반으로 제작한다.
import React from 'react';
import { ScrollView, Text, StyleSheet, View } from 'react-native';
import { Screen, Muted, tokens } from '../../components/ui';

const SECTIONS: { title: string; body: string }[] = [
  {
    title: '1. 수집하는 개인정보와 수집 목적',
    body: '이용자 계정 정보(이메일, 이름, 대상자와의 관계, 연락처)와 대상자의 인적사항(이름, 별명, 생년월일, 성별, 아이 대상자는 출생정보 포함), 그리고 이용자가 직접 입력하는 건강 기록(증상, 체온, 식사, 수면, 배변, 복용약, 알레르기, 예방접종 등)을 수집합니다. 수집 목적은 ① 건강 기록의 저장·조회 ② 기간별 그래프 시각화 ③ 병원 제출용 레포트 생성 ④ 보호자 간 공동 관리 ⑤ 접종·검진 예정일 알림으로 한정됩니다.',
  },
  {
    title: '2. 민감정보의 처리',
    body: '건강 기록은 개인정보 보호법 제23조의 민감정보에 해당하며, 이는 대상자가 아이든 성인이든 동일합니다. 서비스는 민감정보 수집·이용에 대한 별도 동의를 받으며, 동의를 철회하면 새 기록 입력이 즉시 중단됩니다(설정 → 동의 내역). 얼굴 사진은 수집하지 않으며, 기록에 첨부하는 사진은 얼굴이 나오지 않도록 안내합니다.',
  },
  {
    title: '3. 대상자 유형별 동의 근거',
    body: '회원가입은 성인 본인만 할 수 있습니다. 대상자를 등록할 때마다 해당 대상자에 대한 동의 기록이 별도로 저장되며, 필요한 동의는 만 나이와 본인 여부에 따라 다릅니다. ① 만 14세 미만 아동: 법정대리인 동의(개인정보 보호법 제22조의2) ② 만 14세 이상 미성년자: 법정대리인 동의 + 본인 고지 ③ 성인 본인: 본인 동의 ④ 성인 가족(본인 아님): 해당 성인 본인의 사전 동의를 받아야 하며, 등록 시 그 사실을 확인받습니다.',
  },
  {
    title: '4. 보관, 위탁 및 국외 이전',
    body: '데이터는 Supabase(클라우드 데이터베이스·스토리지)에 암호화 전송(TLS) 방식으로 저장됩니다. 프로젝트 리전에 따라 국외 서버에 보관될 수 있으며, 이 경우 이전되는 국가·항목·보관 기간을 본 방침에 고지합니다. (배포 시 리전 확정 후 구체화)',
  },
  {
    title: '5. 제3자 제공',
    body: '이용자가 직접 생성한 공유 링크를 통해서만 레포트가 외부(의료진 등)에 전달됩니다. 공유 링크는 만료 시간이 있으며 언제든 회수할 수 있습니다. 그 외 어떤 개인정보도 제3자에게 제공하지 않습니다.',
  },
  {
    title: '6. 파기',
    body: '이용자가 대상자 데이터 전체 삭제를 실행하면 해당 대상자의 모든 기록, 사진, 레포트 파일이 즉시 삭제됩니다. 계정 탈퇴 시 계정 정보와 모든 대상자 데이터가 삭제됩니다.',
  },
  {
    title: '7. 정보주체의 권리',
    body: '정보주체(성인 대상자 본인, 또는 미성년 대상자의 법정대리인)는 언제든 개인정보의 열람, 정정, 삭제, 처리 정지(동의 철회)를 요구할 수 있습니다. 계정 이용자는 앱 내 설정 화면에서 직접 실행할 수 있으며, 성인 대상자가 본인의 기록에 대해 권리 행사를 요청하면 지체 없이 이에 따라야 합니다.',
  },
  {
    title: '8. 의료행위 아님 고지',
    body: '이 앱의 기록·그래프·레포트는 이용자의 관찰 기록이며 의학적 진단·소견·처방이 아닙니다. 앱은 진단명 추정, 약 용량 계산·추천, 병원 방문 필요성 판단을 수행하지 않습니다.',
  },
];

export const PrivacyPolicyScreen = () => (
  <Screen>
    <ScrollView contentContainerStyle={{ padding: 20 }}>
      <Text style={styles.title}>개인정보처리방침</Text>
      <Muted>시행일: 2026-07-10 (v0.1 초안 — 정식 배포 전 법률 검토 예정)</Muted>
      <View style={{ height: 12 }} />
      {SECTIONS.map((s) => (
        <View key={s.title} style={{ marginBottom: 18 }}>
          <Text style={styles.sectionTitle}>{s.title}</Text>
          <Text style={styles.body}>{s.body}</Text>
        </View>
      ))}
      <Muted>문의: privacy@carenote.example (배포 시 실제 연락처로 교체)</Muted>
      <View style={{ height: 40 }} />
    </ScrollView>
  </Screen>
);

const styles = StyleSheet.create({
  title: { fontSize: 20, fontWeight: '800', color: tokens.ink, marginBottom: 4 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: tokens.ink, marginBottom: 4 },
  body: { fontSize: 13, color: tokens.inkSecondary, lineHeight: 20 },
});
