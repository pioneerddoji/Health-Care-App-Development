// 사진 뷰어 모달 — 좌우 슬라이드(페이징) + 화살표는 끝에서 처음으로 순환 + "n / 전체" 표시
import React, { useRef, useState } from 'react';
import {
  Modal, View, Image, Pressable, Text, StyleSheet, ScrollView, useWindowDimensions,
} from 'react-native';

export const PhotoViewer = ({
  uris, initialIndex = 0, onClose,
}: {
  uris: string[];
  initialIndex?: number;
  onClose: () => void;
}) => {
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(Math.min(initialIndex, uris.length - 1));
  const scrollRef = useRef<ScrollView>(null);

  const goTo = (i: number) => {
    const next = (i + uris.length) % uris.length; // 마지막 → 처음, 처음 → 마지막 순환
    setIndex(next);
    scrollRef.current?.scrollTo({ x: next * width, animated: true });
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onLayout={() => scrollRef.current?.scrollTo({ x: index * width, animated: false })}
          onMomentumScrollEnd={(e) => {
            const i = Math.round(e.nativeEvent.contentOffset.x / width);
            if (i >= 0 && i < uris.length) setIndex(i);
          }}
        >
          {uris.map((uri) => (
            <Pressable key={uri} style={{ width, height, justifyContent: 'center' }} onPress={onClose}>
              <Image source={{ uri }} style={{ width, height: height * 0.75 }} resizeMode="contain" />
            </Pressable>
          ))}
        </ScrollView>

        {uris.length > 1 && (
          <>
            <Pressable style={[styles.arrow, { left: 6 }]} onPress={() => goTo(index - 1)} hitSlop={10}>
              <Text style={styles.arrowText}>‹</Text>
            </Pressable>
            <Pressable style={[styles.arrow, { right: 6 }]} onPress={() => goTo(index + 1)} hitSlop={10}>
              <Text style={styles.arrowText}>›</Text>
            </Pressable>
          </>
        )}

        <View style={styles.indicator} pointerEvents="none">
          <Text style={styles.indicatorText}>{index + 1} / {uris.length}</Text>
        </View>

        <Pressable style={styles.close} onPress={onClose} hitSlop={10}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)' },
  arrow: {
    position: 'absolute', top: '46%', width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center',
  },
  arrowText: { color: '#ffffff', fontSize: 28, lineHeight: 32, marginTop: -2 },
  indicator: {
    position: 'absolute', bottom: 36, alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 5,
  },
  indicatorText: { color: '#ffffff', fontSize: 12, fontWeight: '600' },
  close: {
    position: 'absolute', top: 48, right: 20, width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center',
  },
  closeText: { color: '#ffffff', fontSize: 16 },
});
