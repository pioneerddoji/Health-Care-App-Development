import type { RecordType } from '../types';

export interface RecordTypeDef {
  type: RecordType;
  label: string;
  emoji: string;
}

// 일자별 기록 유형 12종
export const RECORD_TYPES: RecordTypeDef[] = [
  { type: 'condition',       label: '컨디션',    emoji: '🙂' },
  { type: 'symptom',         label: '증상',      emoji: '🤒' },
  { type: 'meal',            label: '식사',      emoji: '🍚' },
  { type: 'sleep',           label: '수면',      emoji: '😴' },
  { type: 'excretion',       label: '배변/배뇨', emoji: '🚽' },
  { type: 'medication_dose', label: '약 복용',   emoji: '💊' },
  { type: 'activity',        label: '운동/놀이', emoji: '⚽' },
  { type: 'behavior',        label: '행동',      emoji: '🧩' },
  { type: 'incident',        label: '사고/안전', emoji: '🩹' },
  { type: 'media_use',       label: '미디어',    emoji: '📱' },
  { type: 'school',          label: '학교/기관', emoji: '🎒' },
  { type: 'note',            label: '메모',      emoji: '📝' },
];

export const recordTypeDef = (type: RecordType): RecordTypeDef =>
  RECORD_TYPES.find((t) => t.type === type) ?? RECORD_TYPES[11];
