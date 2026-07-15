// 길게 눌러 항목을 들어 올려(플로팅) 손가락으로 위/아래로 끌어 순서를 바꾸는 리스트.
// 아이패드 홈 화면 앱 이동과 같은 UX: 잡은 항목이 떠오르고, 지나치는 항목이 밀려난다.
// 항목 높이가 서로 달라도 동작하며, 화면 가장자리로 끌면 자동 스크롤된다.
//
// 구현 원칙: 모든 이동은 Animated.Value에 대한 직접 setValue로만 구동한다
// (Animated.spring/timing 미사용). 드래그 중 60fps 틱 루프 하나가 자동 스크롤,
// 드래그 카드 위치, 밀려나는 카드의 수동 lerp를 전부 처리한다 — 실기기에서
// 드래그 카드(setValue)는 움직이는데 spring 구동 카드만 안 움직이는 문제가
// 있었기 때문에, 검증된 단일 경로로 통일했다.
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated, PanResponder, ScrollView, View, Vibration, StyleSheet,
  type PanResponderInstance, type ViewStyle,
} from 'react-native';

const LONG_PRESS_MS = 350;   // 이 시간 이상 누르면 드래그 시작
const MOVE_CANCEL_PX = 8;    // 드래그 시작 전 이만큼 움직이면 스크롤로 간주(롱프레스 취소)
const EDGE_ZONE_PX = 80;     // 가장자리 자동 스크롤 영역
const EDGE_SCROLL_STEP = 12; // 자동 스크롤 속도(px per tick)
const LERP = 0.25;           // 밀려나는 카드의 프레임당 접근 비율(지수 감쇠)

export const DragReorderList = ({
  items, onReorder, header, footer, contentContainerStyle,
}: {
  items: { key: string; node: React.ReactNode }[];
  onReorder: (keys: string[]) => void;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  contentContainerStyle?: ViewStyle;
}) => {
  const [dragKey, setDragKey] = useState<string | null>(null);

  // 제스처/레이아웃 상태는 전부 ref — PanResponder 콜백이 stale state를 잡지 않도록
  const orderRef = useRef<string[]>([]);
  orderRef.current = items.map((i) => i.key);
  const layouts = useRef<Record<string, { y: number; h: number }>>({});
  const draggingRef = useRef<string | null>(null);
  const dragAnim = useRef(new Animated.Value(0)).current;
  const shiftAnims = useRef<Record<string, Animated.Value>>({});
  const shiftTargets = useRef<Record<string, number>>({}); // 카드별 목표 오프셋
  const shiftCur = useRef<Record<string, number>>({});     // 카드별 현재 오프셋(lerp 중간값)
  const itemGap = useRef(0);                               // 카드 사이 여백(마진) 실측값
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastDy = useRef(0);
  const lastMoveY = useRef(0);       // 창 좌표(자동 스크롤 판정용)
  const scrollY = useRef(0);
  const scrollAtGrant = useRef(0);
  const contentH = useRef(0);
  const viewportH = useRef(0);
  const viewportTop = useRef(0);     // 창 기준 리스트 상단 y
  const rootRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);
  const respondersRef = useRef<Record<string, PanResponderInstance>>({});

  const shiftOf = (key: string): Animated.Value => {
    if (!shiftAnims.current[key]) shiftAnims.current[key] = new Animated.Value(0);
    return shiftAnims.current[key];
  };

  const cancelLongPress = () => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  };

  // 드래그 카드 위치 갱신 + 각 카드의 목표 오프셋 계산 (이동 자체는 tick의 lerp가 수행)
  const applyDrag = () => {
    const key = draggingRef.current;
    if (!key || !layouts.current[key]) return;
    const dy = lastDy.current + (scrollY.current - scrollAtGrant.current);
    dragAnim.setValue(dy);
    const L = layouts.current;
    // 밀려나는 거리 = 드래그 카드 높이 + 카드 간 여백 → 이웃이 정확히 그 자리를 메운다
    const amount = L[key].h + itemGap.current;
    const dragCenter = L[key].y + L[key].h / 2 + dy;
    const dragIdx = orderRef.current.indexOf(key);
    orderRef.current.forEach((k, i) => {
      if (k === key || !L[k]) return;
      const center = L[k].y + L[k].h / 2;
      let target = 0;
      if (i > dragIdx && dragCenter > center) target = -amount; // 아래 항목을 위로
      if (i < dragIdx && dragCenter < center) target = amount;  // 위 항목을 아래로
      shiftTargets.current[k] = target;
    });
  };

  // 드래그 중 60fps 루프: 자동 스크롤 → 드래그 위치/목표 재계산 → 밀려남 lerp
  const tick = () => {
    if (!draggingRef.current) return;
    // ① 가장자리 자동 스크롤 — 손가락이 위/아래 끝에 머무는 동안 목록을 굴린다
    const y = lastMoveY.current;
    let dir = 0;
    if (y < viewportTop.current + EDGE_ZONE_PX) dir = -1;
    else if (y > viewportTop.current + viewportH.current - EDGE_ZONE_PX) dir = 1;
    if (dir) {
      const max = Math.max(0, contentH.current - viewportH.current);
      const next = Math.min(max, Math.max(0, scrollY.current + dir * EDGE_SCROLL_STEP));
      if (next !== scrollY.current) {
        scrollY.current = next;
        scrollRef.current?.scrollTo({ y: next, animated: false });
      }
    }
    // ② 드래그 카드 위치와 목표 오프셋 갱신
    applyDrag();
    // ③ 밀려나는 카드: 목표를 향해 수동 lerp (setValue 직접 구동)
    for (const k of orderRef.current) {
      if (k === draggingRef.current) continue;
      const target = shiftTargets.current[k] ?? 0;
      const cur = shiftCur.current[k] ?? 0;
      if (cur === target) continue;
      const next = Math.abs(target - cur) < 0.5 ? target : cur + (target - cur) * LERP;
      shiftCur.current[k] = next;
      shiftOf(k).setValue(next);
    }
  };

  const activate = (key: string) => {
    longPressTimer.current = null;
    draggingRef.current = key;
    scrollAtGrant.current = scrollY.current;
    lastDy.current = 0;
    shiftTargets.current = {};
    shiftCur.current = {};
    // 카드 간 여백 실측 (이웃한 두 항목의 레이아웃 차이)
    const o = orderRef.current;
    const L = layouts.current;
    itemGap.current = 0;
    for (let i = 0; i + 1 < o.length; i++) {
      const a = L[o[i]]; const b = L[o[i + 1]];
      if (a && b) { itemGap.current = Math.max(0, b.y - (a.y + a.h)); break; }
    }
    try { Vibration.vibrate(30); } catch { /* 웹 등 미지원 환경 */ }
    setDragKey(key);
    tickTimer.current = setInterval(tick, 16);
  };

  const endDrag = () => {
    cancelLongPress();
    if (tickTimer.current) { clearInterval(tickTimer.current); tickTimer.current = null; }
    const key = draggingRef.current;
    if (!key) return;
    draggingRef.current = null;
    // 최종 위치 = 원래 자리 ± 밀려난 항목 수
    const cur = orderRef.current;
    const dragIdx = cur.indexOf(key);
    let newIdx = dragIdx;
    cur.forEach((k, i) => {
      const t = shiftTargets.current[k] ?? 0;
      if (i > dragIdx && t < 0) newIdx += 1;
      if (i < dragIdx && t > 0) newIdx -= 1;
    });
    // 오프셋 값 초기화 후 새 순서로 커밋
    dragAnim.setValue(0);
    Object.values(shiftAnims.current).forEach((v) => v.setValue(0));
    shiftTargets.current = {};
    shiftCur.current = {};
    setDragKey(null);
    if (newIdx !== dragIdx) {
      const next = cur.filter((k) => k !== key);
      next.splice(newIdx, 0, key);
      onReorder(next);
    }
  };

  // 언마운트 시 타이머 정리
  useEffect(() => () => {
    cancelLongPress();
    if (tickTimer.current) clearInterval(tickTimer.current);
  }, []);

  const responderFor = (key: string): PanResponderInstance => {
    if (!respondersRef.current[key]) {
      respondersRef.current[key] = PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: (_e, g) => {
          lastDy.current = 0;
          lastMoveY.current = g.y0;
          longPressTimer.current = setTimeout(() => activate(key), LONG_PRESS_MS);
        },
        onPanResponderMove: (_e, g) => {
          lastDy.current = g.dy;
          lastMoveY.current = g.moveY;
          if (draggingRef.current === key) applyDrag();
          else if (Math.abs(g.dy) > MOVE_CANCEL_PX || Math.abs(g.dx) > MOVE_CANCEL_PX) cancelLongPress();
        },
        // 드래그 전에는 스크롤이 제스처를 가져갈 수 있게, 드래그 중에는 거부
        onPanResponderTerminationRequest: () => draggingRef.current !== key,
        onShouldBlockNativeResponder: () => draggingRef.current === key,
        onPanResponderTerminate: () => endDrag(),
        onPanResponderRelease: () => endDrag(),
      });
    }
    return respondersRef.current[key];
  };

  return (
    <View
      ref={rootRef}
      style={{ flex: 1 }}
      onLayout={() => rootRef.current?.measureInWindow((_x, y, _w, h) => {
        viewportTop.current = y;
        viewportH.current = h;
      })}
    >
      <ScrollView
        ref={scrollRef}
        scrollEnabled={dragKey == null}
        scrollEventThrottle={16}
        onScroll={(e) => { scrollY.current = e.nativeEvent.contentOffset.y; }}
        onContentSizeChange={(_w, h) => { contentH.current = h; }}
        contentContainerStyle={contentContainerStyle}
      >
        {header}
        {items.map(({ key, node }) => {
          const isDrag = key === dragKey;
          return (
            <Animated.View
              key={key}
              onLayout={(e) => {
                layouts.current[key] = { y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height };
              }}
              {...responderFor(key).panHandlers}
              style={[
                // 드래그 중 카드만 scale을 함께 적용. 밀려나는 카드는 애니메이션
                // translateY만 담는다.
                isDrag
                  ? { transform: [{ translateY: dragAnim }, { scale: 1.03 }] }
                  : { transform: [{ translateY: shiftOf(key) }] },
                isDrag && styles.floating,
              ]}
            >
              {node}
            </Animated.View>
          );
        })}
        {footer}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  floating: {
    userSelect: 'none', // 웹: 드래그 중 텍스트 선택 방지
    zIndex: 100,
    elevation: 10,
    opacity: 0.97,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
  },
});
