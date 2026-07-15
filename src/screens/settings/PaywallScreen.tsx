// 플랜 관리(페이월) — 3티어 비교 + 전환.
// 동작 모드는 billing.ts의 resolvePaywallMode()가 결정한다:
//   demo   데모 체험 — 즉시 전환 (mock 기본)
//   hidden 전환 버튼 숨김 — 결제 연동 전 운영 빌드 (supabase 기본, Play 정책 대응)
//   live   실결제 — purchaseWithStore() 경유, 티어는 서버(subscriptions)에서 다시 읽음
import React, { useState } from 'react';
import { ScrollView, Text, StyleSheet, View, Alert, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useApp } from '../../context/AppContext';
import { Screen, Card, Chip, Row, Button, Muted, tokens } from '../../components/ui';
import {
  ALWAYS_FREE, EARLY_BIRD_NOTE, YEARLY_NOTE, ENTITLEMENTS, FEATURE_ROWS,
  PRICING, TIER_META, TIER_ORDER, won,
} from '../../constants/subscription';
import { resolvePaywallMode, purchaseWithStore, restorePurchases } from '../../services/billing';
import type { SubscriptionTier, BillingPeriod } from '../../types';

export const PaywallScreen = () => {
  const nav = useNavigation();
  const { subscription, setSubscriptionTier, loadAll, mode } = useApp();
  const [busy, setBusy] = useState(false);
  const [period, setPeriod] = useState<BillingPeriod>('monthly');
  const paywall = resolvePaywallMode(mode);

  const choose = async (tier: SubscriptionTier) => {
    if (tier === subscription.tier) return;
    setBusy(true);
    try {
      if (paywall === 'live') {
        if (tier === 'free') {
          // 스토어 구독은 앱에서 직접 해지할 수 없다 (정책)
          Alert.alert('구독 해지 안내',
            '플레이스토어/앱스토어의 구독 관리에서 해지할 수 있어요. 만료일까지는 현재 플랜이 유지되고, 이후 무료 플랜으로 전환됩니다. 기록된 데이터는 사라지지 않아요.');
          return;
        }
        await purchaseWithStore(tier, period);
        await loadAll(); // 티어는 서버(subscriptions)가 진실 — 다시 읽는다
      } else {
        await setSubscriptionTier(tier); // demo: 즉시 전환
      }
      Alert.alert('플랜 변경', `${TIER_META[tier].label} 플랜으로 전환했어요.`,
        [{ text: '확인', onPress: () => nav.goBack() }]);
      if (mode === 'mock') nav.goBack(); // 웹 프리뷰(Alert 미지원) 대비
    } catch (e) {
      Alert.alert('안내', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    setBusy(true);
    try {
      await restorePurchases();
      await loadAll();
      Alert.alert('복원 완료', '구매 내역을 확인해 플랜을 복원했어요.');
    } catch (e) {
      Alert.alert('안내', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Text style={styles.title}>플랜 관리</Text>
        <Muted>핵심 기능(기록·그래프·레포트·알림)은 어떤 플랜에서도 제한하지 않아요.</Muted>
        <View style={{ height: 12 }} />
        <View style={styles.earlyBird}>
          <Text style={styles.earlyBirdText}>{EARLY_BIRD_NOTE}</Text>
        </View>

        <Row style={{ marginBottom: 8 }}>
          <Chip label="월간 결제" selected={period === 'monthly'}
            onPress={() => setPeriod('monthly')} />
          <Chip label="연간 결제 (2개월 무료)" selected={period === 'yearly'}
            onPress={() => setPeriod('yearly')} />
        </Row>
        {period === 'yearly' && (
          <View style={{ marginBottom: 8 }}><Muted>{YEARLY_NOTE}</Muted></View>
        )}

        {TIER_ORDER.map((tier) => {
          const meta = TIER_META[tier];
          const ent = ENTITLEMENTS[tier];
          const current = tier === subscription.tier;
          const price = tier === 'free' ? null : PRICING[tier][period];
          const unit = period === 'monthly' ? '월' : '연';
          return (
            <Pressable key={tier} onPress={() => paywall !== 'hidden' && !busy && choose(tier)}>
              <Card style={current ? styles.currentCard : undefined}>
                <View style={styles.headRow}>
                  <Text style={styles.tierName}>{meta.emoji} {meta.label}</Text>
                  <View style={styles.priceRow}>
                    {price && (
                      <Text style={styles.listPrice}>{unit} {won(price.list)}</Text>
                    )}
                    <Text style={styles.price}>
                      {price ? `${unit} ${won(price.early)}` : meta.priceLabel}
                    </Text>
                  </View>
                </View>
                {price && period === 'yearly' && (
                  <Text style={styles.perMonth}>월 {won(Math.round(price.early / 12))} 꼴 · 12개월</Text>
                )}
                <Muted>{meta.tagline}</Muted>
                <View style={{ height: 8 }} />
                {FEATURE_ROWS.map((row) => (
                  <View key={row.label} style={styles.featureRow}>
                    <Text style={styles.featureLabel}>{row.label}</Text>
                    <Text style={styles.featureValue}>{row.value(ent)}</Text>
                  </View>
                ))}
                {current ? (
                  <Text style={styles.currentBadge}>✓ 현재 플랜</Text>
                ) : paywall !== 'hidden' ? (
                  <Button label={busy ? '처리 중…' : `${meta.label}로 전환`}
                    variant={tier === 'free' ? 'ghost' : 'primary'}
                    onPress={() => choose(tier)} disabled={busy} />
                ) : null}
              </Card>
            </Pressable>
          );
        })}

        {paywall === 'hidden' && (
          <Card>
            <Muted>
              유료 플랜 결제는 곧 제공될 예정이에요. 지금은 모든 기능을 무료 플랜 기준으로
              이용하실 수 있습니다. 지금 가입해 두시면 위의 얼리버드 할인가가 적용돼요.
            </Muted>
          </Card>
        )}

        {paywall === 'live' && (
          <Button label="구매 복원" variant="ghost" onPress={restore} disabled={busy} />
        )}

        <Card>
          <Text style={styles.alwaysTitle}>모든 플랜에서 무제한</Text>
          {ALWAYS_FREE.map((f) => (
            <Text key={f} style={styles.alwaysItem}>✓ {f}</Text>
          ))}
        </Card>

        <Muted>
          {paywall === 'demo'
            ? '데모 모드: 전환이 즉시 시뮬레이션됩니다. 실 서비스에서는 앱스토어/플레이스토어 결제로 처리됩니다.'
            : '결제/해지는 앱스토어·플레이스토어 구독 관리에서 처리됩니다.'}
          {' '}구독과 무관하게 이미 기록된 데이터는 절대 잠기거나 삭제되지 않습니다.
        </Muted>
        <View style={{ height: 40 }} />
      </ScrollView>
    </Screen>
  );
};

const styles = StyleSheet.create({
  title: { fontSize: 20, fontWeight: '800', color: tokens.ink, marginBottom: 4 },
  currentCard: { borderColor: tokens.primary, borderWidth: 1.5 },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tierName: { fontSize: 17, fontWeight: '800', color: tokens.ink },
  priceRow: { flexDirection: 'row', alignItems: 'center' },
  listPrice: {
    fontSize: 13, color: tokens.muted, textDecorationLine: 'line-through', marginRight: 8,
  },
  price: { fontSize: 15, fontWeight: '700', color: tokens.primary },
  perMonth: { fontSize: 12, color: tokens.muted, textAlign: 'right', marginTop: 2 },
  earlyBird: {
    backgroundColor: tokens.primarySoft, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12,
  },
  earlyBirdText: { fontSize: 13, color: tokens.primary, lineHeight: 19 },
  featureRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  featureLabel: { fontSize: 13, color: tokens.muted },
  featureValue: { fontSize: 13, color: tokens.ink, fontWeight: '600' },
  currentBadge: { marginTop: 8, fontSize: 13, fontWeight: '700', color: tokens.primary, textAlign: 'center' },
  alwaysTitle: { fontSize: 14, fontWeight: '700', color: tokens.ink, marginBottom: 6 },
  alwaysItem: { fontSize: 13, color: tokens.inkSecondary, lineHeight: 22 },
});
