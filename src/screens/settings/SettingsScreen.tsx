// 설정 — 보호자 공동 관리(초대/권한/해제), 동의 내역, 데이터 삭제
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, StyleSheet, Alert, View, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { useApp } from '../../context/AppContext';
import { Screen, Card, Button, Row, Muted, Section, Chip, Field, tokens } from '../../components/ui';
import { formatShort } from '../../lib/date';
import { TIER_META } from '../../constants/subscription';
import type { ChildGuardian, ShareLinkInfo } from '../../types';
import { SOCIAL_PROVIDERS, type SocialProvider } from '../../services/socialAuth';
import { deletionSubmitDisabled } from '../../services/authUxState';

const ROLE_LABEL = { owner: '소유자', editor: '편집자', viewer: '열람자' } as const;

const formatDateTime = (iso: string): string => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const linkStatus = (l: ShareLinkInfo): { label: string; expired: boolean } => {
  if (l.revokedAt) return { label: '회수됨', expired: true };
  if (new Date(l.expiresAt).getTime() <= Date.now()) return { label: '만료됨', expired: true };
  return { label: '열람 가능', expired: false };
};

export const SettingsScreen = () => {
  const {
    guardian, children, selectedChild, deleteChildAndData, signOut, mode,
    roleOf, listGuardians, inviteGuardian, updateGuardianRole, removeGuardian,
    listShareLinks, revokeShareLink,
    consentActive, revokeSensitiveConsent, grantSensitiveConsent,
    subscription, ent, deleteAccount, getAccountAuthMethods,
  } = useApp();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [guardians, setGuardians] = useState<ChildGuardian[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'editor' | 'viewer'>('editor');
  const [busy, setBusy] = useState(false);
  const [shareLinks, setShareLinks] = useState<ShareLinkInfo[]>([]);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deletePhrase, setDeletePhrase] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteMethods, setDeleteMethods] = useState<('email' | SocialProvider)[]>([]);
  const [deleteError, setDeleteError] = useState('');

  const isOwner = selectedChild ? roleOf(selectedChild.id) === 'owner' : false;
  const coGuardianCount = guardians.filter((g) => g.role !== 'owner').length;
  const atInviteLimit = coGuardianCount >= ent.maxCoGuardians;

  const refreshGuardians = useCallback(async () => {
    if (!selectedChild) { setGuardians([]); return; }
    try {
      setGuardians(await listGuardians(selectedChild.id));
    } catch {
      setGuardians([]);
    }
  }, [selectedChild, listGuardians]);

  useEffect(() => { refreshGuardians(); }, [refreshGuardians]);

  const refreshShareLinks = useCallback(async () => {
    if (!selectedChild) { setShareLinks([]); return; }
    try {
      setShareLinks(await listShareLinks(selectedChild.id));
    } catch {
      setShareLinks([]);
    }
  }, [selectedChild, listShareLinks]);

  useEffect(() => { refreshShareLinks(); }, [refreshShareLinks]);

  const alertError = (e: unknown) =>
    Alert.alert('실패', e instanceof Error ? e.message : String(e));

  const confirmRevokeLink = (link: ShareLinkInfo) => {
    Alert.alert('공유 링크 회수', '이 링크로는 더 이상 레포트를 열람할 수 없게 됩니다.', [
      { text: '취소', style: 'cancel' },
      {
        text: '회수', style: 'destructive',
        onPress: () => {
          revokeShareLink(link.id).then(refreshShareLinks).catch(alertError);
        },
      },
    ]);
  };

  const invite = async () => {
    if (!selectedChild || !inviteEmail.trim()) return;
    setBusy(true);
    try {
      await inviteGuardian(selectedChild.id, inviteEmail.trim(), inviteRole);
      setInviteEmail('');
      await refreshGuardians();
      Alert.alert('완료', `${ROLE_LABEL[inviteRole]} 권한으로 초대했습니다.`);
    } catch (e) { alertError(e); } finally { setBusy(false); }
  };

  const toggleRole = async (g: ChildGuardian) => {
    if (!selectedChild) return;
    const next = g.role === 'editor' ? 'viewer' : 'editor';
    try {
      await updateGuardianRole(selectedChild.id, g.guardianId, next);
      await refreshGuardians();
    } catch (e) { alertError(e); }
  };

  const confirmRemove = (g: ChildGuardian) => {
    if (!selectedChild) return;
    Alert.alert('보호자 해제', `${g.name}님의 접근 권한을 해제할까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '해제', style: 'destructive',
        onPress: () => {
          removeGuardian(selectedChild.id, g.guardianId)
            .then(refreshGuardians)
            .catch(alertError);
        },
      },
    ]);
  };

  const confirmDelete = () => {
    if (!selectedChild) return;
    Alert.alert(
      '데이터 전체 삭제',
      `${selectedChild.name}의 프로필과 모든 기록(건강 기록, 성장, 접종, 레포트)이 영구 삭제됩니다. 되돌릴 수 없습니다.`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '영구 삭제', style: 'destructive',
          onPress: () => {
            deleteChildAndData(selectedChild.id).catch((e) =>
              Alert.alert('삭제 실패', e instanceof Error ? e.message : String(e)));
          },
        },
      ],
    );
  };

  const openAccountDeletion = async () => {
    setDeleteAccountOpen(true); setDeleteError('');
    try { setDeleteMethods(await getAccountAuthMethods()); }
    catch (e) { setDeleteError(e instanceof Error ? e.message : String(e)); }
  };

  const removeAccount = async (socialProvider?: SocialProvider) => {
    if (deletePhrase !== '탈퇴합니다') return;
    if (deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError('');
    try {
      const result = await deleteAccount({ password: deletePassword || undefined, socialProvider });
      if (result.status === 'deleted') {
        Alert.alert('탈퇴 완료', '계정과 이 계정의 대상자 데이터 삭제가 완료되었습니다.');
      } else {
        setDeleteError(`일부 삭제 단계가 완료되지 않았습니다 (${result.failed.map((f) => `${f.step}: ${f.message}`).join(', ')}). 세션은 유지했습니다. 안전하게 다시 시도해 주세요.`);
      }
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
    } finally { setDeleteBusy(false); }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Section title="계정">
          <Card>
            <Text style={styles.name}>{guardian?.name ?? '보호자'}</Text>
            <Muted>{guardian?.relationship} · {guardian?.phone ?? ''}</Muted>
            <Muted>{mode === 'supabase' ? '☁️ Supabase 연동 모드' : '📱 데모 모드 (기기 내 임시 저장)'}</Muted>
          </Card>
        </Section>

        <Section title="플랜">
          <Card>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={styles.body}>
                {TIER_META[subscription.tier].emoji} {TIER_META[subscription.tier].label} 플랜
              </Text>
              <Text style={styles.role}>{TIER_META[subscription.tier].priceLabel}</Text>
            </Row>
            <Muted>{TIER_META[subscription.tier].tagline}</Muted>
            <Button label="플랜 관리 · 비교" variant="ghost" onPress={() => nav.navigate('Paywall')} />
          </Card>
        </Section>

        <Section title={`보호자 공동 관리${selectedChild ? ` — ${selectedChild.name}` : ''}`}>
          <Card>
            {guardians.map((g) => (
              <Row key={g.guardianId} style={{ justifyContent: 'space-between', marginBottom: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.body}>
                    {g.name}{g.isMe ? ' (나)' : ''}
                    {g.relationship ? <Text style={{ color: tokens.muted }}> · {g.relationship}</Text> : null}
                  </Text>
                </View>
                <Text style={styles.role}>{ROLE_LABEL[g.role]}</Text>
                {isOwner && !g.isMe && (
                  <Row>
                    <Pressable onPress={() => toggleRole(g)} style={styles.linkBtn}>
                      <Text style={styles.link}>
                        {g.role === 'editor' ? '열람자로' : '편집자로'}
                      </Text>
                    </Pressable>
                    <Pressable onPress={() => confirmRemove(g)} style={styles.linkBtn}>
                      <Text style={[styles.link, { color: tokens.danger }]}>해제</Text>
                    </Pressable>
                  </Row>
                )}
              </Row>
            ))}
            {guardians.length === 0 && <Muted>보호자 정보를 불러올 수 없습니다</Muted>}

            {isOwner && atInviteLimit ? (
              <>
                <View style={styles.divider} />
                <Muted>
                  {ent.maxCoGuardians === 0
                    ? '공동 보호자 초대는 스탠다드 플랜부터 가능해요.'
                    : `현재 플랜의 공동 보호자 한도(대상자당 ${ent.maxCoGuardians}명)에 도달했어요.`}
                </Muted>
                <Button label="플랜 업그레이드 🔒" variant="ghost" onPress={() => nav.navigate('Paywall')} />
              </>
            ) : isOwner ? (
              <>
                <View style={styles.divider} />
                <Field label="가입된 보호자 이메일로 초대" value={inviteEmail}
                  onChangeText={setInviteEmail} autoCapitalize="none"
                  keyboardType="email-address" placeholder="dad@example.com" />
                <Row style={{ marginBottom: 4 }}>
                  <Chip label="편집자 (기록 가능)" selected={inviteRole === 'editor'}
                    onPress={() => setInviteRole('editor')} />
                  <Chip label="열람자 (읽기 전용)" selected={inviteRole === 'viewer'}
                    onPress={() => setInviteRole('viewer')} />
                </Row>
                <Button label={busy ? '초대 중…' : '+ 보호자 초대'} variant="ghost"
                  onPress={invite} disabled={busy || !inviteEmail.trim() || !selectedChild} />
                {mode === 'mock' && <Muted>데모 모드: 초대는 이 기기 안에서만 시뮬레이션됩니다.</Muted>}
              </>
            ) : (
              <Muted>보호자 초대와 권한 변경은 소유자만 할 수 있습니다.</Muted>
            )}
          </Card>
        </Section>

        <Section title={`공유 링크${selectedChild ? ` — ${selectedChild.name}` : ''}`}>
          <Card>
            <Muted>레포트 탭에서 만든 링크가 여기 모두 모입니다. 만료되거나 회수하면 즉시 열람이 차단됩니다.</Muted>
            <View style={{ height: 8 }} />
            {shareLinks.length === 0 && <Muted>아직 만든 공유 링크가 없습니다.</Muted>}
            {shareLinks.map((l) => {
              const status = linkStatus(l);
              return (
                <View key={l.id} style={styles.linkRow}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Text style={styles.body}>
                      {formatShort(l.periodStart)} ~ {formatShort(l.periodEnd)} 레포트
                    </Text>
                    <Text style={[styles.link, status.expired && { color: tokens.muted }]}>
                      {status.label}
                    </Text>
                  </Row>
                  <Muted>
                    {l.revokedAt ? '회수됨' : `만료 ${formatDateTime(l.expiresAt)}`}
                  </Muted>
                  {!status.expired && (
                    <Pressable onPress={() => confirmRevokeLink(l)}>
                      <Text style={[styles.link, { color: tokens.danger, marginTop: 4 }]}>지금 회수</Text>
                    </Pressable>
                  )}
                </View>
              );
            })}
          </Card>
        </Section>

        <Section title={`동의 내역${selectedChild ? ` — ${selectedChild.name}` : ''}`}>
          <Card>
            <Text style={styles.body}>✓ 법정대리인 확인 및 동의 (가입 시)</Text>
            {selectedChild && consentActive(selectedChild.id) ? (
              <>
                <Text style={styles.body}>✓ 건강정보(민감정보) 수집·이용 동의</Text>
                <Muted>철회하면 {selectedChild.name}의 새 기록 입력이 즉시 중단됩니다. 기존 기록 열람은 유지됩니다.</Muted>
                <Button label="건강정보 동의 철회" variant="ghost"
                  onPress={() =>
                    Alert.alert('동의 철회', `${selectedChild.name}의 건강정보 수집·이용 동의를 철회할까요? 새 기록을 입력할 수 없게 됩니다.`, [
                      { text: '취소', style: 'cancel' },
                      {
                        text: '철회', style: 'destructive',
                        onPress: () => { revokeSensitiveConsent(selectedChild.id).catch(alertError); },
                      },
                    ])} />
              </>
            ) : selectedChild ? (
              <>
                <Text style={[styles.body, { color: tokens.danger }]}>✕ 건강정보 동의 철회됨 — 새 기록 입력 불가</Text>
                <Button label="건강정보 재동의"
                  onPress={() => { grantSensitiveConsent(selectedChild.id).catch(alertError); }} />
              </>
            ) : null}
          </Card>
        </Section>

        <Section title="데이터 관리">
          <Card>
            <Text style={styles.body}>
              선택된 대상자: {selectedChild?.name ?? '없음'} (등록 대상자 {children.length}명)
            </Text>
            {isOwner ? (
              <Button label="선택된 대상자 데이터 전체 삭제" variant="danger"
                onPress={confirmDelete} disabled={!selectedChild} />
            ) : (
              <Muted>데이터 삭제는 소유자만 할 수 있습니다.</Muted>
            )}
          </Card>
        </Section>

        <Section title="계정 탈퇴">
          <Card>
            <Text style={[styles.body, { color: tokens.danger }]}>계정과 모든 대상자·건강 기록·사진·레포트가 영구 삭제됩니다.</Text>
            <Muted>삭제 전 이메일 계정은 현재 비밀번호, 소셜 전용 계정은 해당 공급자로 재인증합니다. 일부 단계가 실패하면 세션을 유지하고 재시도할 수 있습니다.</Muted>
            {!deleteAccountOpen ? (
              <Button label="계정 탈퇴 진행" variant="danger" onPress={openAccountDeletion} />
            ) : (
              <>
                <Field label="확인 문구" value={deletePhrase} onChangeText={setDeletePhrase}
                  placeholder="탈퇴합니다" autoCapitalize="none" />
                {deleteMethods.includes('email') && <Field label="계정 삭제 재인증용 현재 비밀번호"
                  value={deletePassword} onChangeText={setDeletePassword} secureTextEntry editable={!deleteBusy} />}
                {deleteError ? <Text accessible accessibilityRole="alert" accessibilityLiveRegion="assertive"
                  style={styles.deleteError}>{deleteError}</Text> : null}
                <Button label={deleteBusy ? '삭제 요청 중…' : '계정과 데이터 영구 삭제'} variant="danger"
                  onPress={() => removeAccount()}
                  disabled={deletionSubmitDisabled({ busy: deleteBusy, phrase: deletePhrase,
                    methodReady: deleteMethods.includes('email') && !!deletePassword })} />
                {deleteMethods.filter((m): m is SocialProvider => m !== 'email').map((provider) =>
                  <Button key={provider} label={`${SOCIAL_PROVIDERS[provider].short}로 재인증 후 영구 삭제`}
                    variant="danger" onPress={() => removeAccount(provider)}
                    disabled={deletionSubmitDisabled({ busy: deleteBusy, phrase: deletePhrase, methodReady: true })} />)}
                <Button label="취소" variant="ghost" onPress={() => {
                  setDeleteAccountOpen(false); setDeletePhrase(''); setDeletePassword(''); setDeleteError('');
                }} disabled={deleteBusy} />
              </>
            )}
          </Card>
        </Section>

        <Button label="개인정보처리방침" variant="ghost" onPress={() => nav.navigate('PrivacyPolicy')} />
        <Button label="로그아웃" variant="ghost" onPress={() => { signOut().catch(() => {}); }} />
        <View style={{ height: 40 }} />
      </ScrollView>
    </Screen>
  );
};

const styles = StyleSheet.create({
  name: { fontSize: 16, fontWeight: '700', color: tokens.ink },
  body: { fontSize: 14, color: tokens.ink, marginBottom: 4 },
  role: { fontSize: 12, color: tokens.primary, fontWeight: '600', marginRight: 8 },
  link: { fontSize: 12, color: tokens.primary },
  linkBtn: { paddingHorizontal: 6, paddingVertical: 4 },
  divider: {
    height: StyleSheet.hairlineWidth, backgroundColor: tokens.border,
    marginVertical: 12,
  },
  linkRow: {
    paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: tokens.border,
  },
  deleteError: { color: tokens.danger, fontSize: 13, marginVertical: 8 },
});
