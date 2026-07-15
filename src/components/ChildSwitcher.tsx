// 아이 전환 스위처 — 기록/대시보드/레포트 탭 상단에서 다자녀 간 빠른 전환
import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useApp } from '../context/AppContext';
import { Chip, tokens } from './ui';

export const ChildSwitcher = () => {
  const { children, selectedChildId, selectChild, roleOf } = useApp();
  if (children.length <= 1) return null;

  return (
    <View style={{
      backgroundColor: tokens.surface, paddingVertical: 8, paddingLeft: 16,
      borderBottomWidth: 0.5, borderColor: tokens.border,
    }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {children.map((c) => (
          <Chip
            key={c.id}
            label={`${c.sex === 'female' ? '👧' : '👦'} ${c.nickname ?? c.name}${roleOf(c.id) === 'viewer' ? ' 🔒' : ''}`}
            selected={c.id === selectedChildId}
            onPress={() => selectChild(c.id)}
          />
        ))}
        <View style={{ width: 16 }} />
      </ScrollView>
      {children.some((c) => roleOf(c.id) === 'viewer') && (
        <Text style={{ fontSize: 10, color: tokens.muted, marginTop: 2 }}>
          🔒 열람 전용 (기록·수정 불가)
        </Text>
      )}
    </View>
  );
};
