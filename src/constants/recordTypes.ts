import type { RecordType } from '../types';

export interface RecordTypeDef {
  type: RecordType;
  label: string;
  emoji: string;
  /** 연령 전제가 있는 유형 — 아이 대상자에게만 노출 (docs/08 규칙 3) */
  childOnly?: boolean;
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
  { type: 'school',          label: '학교/기관', emoji: '🎒', childOnly: true },
  { type: 'note',            label: '메모',      emoji: '📝' },
];

/** 대상자 유형에 맞는 기록 유형 목록.
 *  ⚠️ 표시용 필터일 뿐 — 이미 저장된 기록은 유형과 무관하게 계속 보여야 하므로
 *  조회 경로(recordTypeDef)에는 적용하지 않는다. */
export const recordTypesFor = (showChildFeatures: boolean): RecordTypeDef[] =>
  showChildFeatures ? RECORD_TYPES : RECORD_TYPES.filter((t) => !t.childOnly);

export const recordTypeDef = (type: RecordType): RecordTypeDef =>
  RECORD_TYPES.find((t) => t.type === type) ?? RECORD_TYPES[11];
