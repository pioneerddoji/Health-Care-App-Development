import type { CategorySlug, RecordType } from '../types';

export interface CategoryDef {
  slug: CategorySlug;
  label: string;
  emoji: string;
}

// 건강관리 영역 14종
export const CATEGORIES: CategoryDef[] = [
  { slug: 'growth',               label: '성장',        emoji: '📏' },
  { slug: 'development',          label: '발달',        emoji: '🧩' },
  { slug: 'nutrition',            label: '영양',        emoji: '🍚' },
  { slug: 'sleep',                label: '수면',        emoji: '😴' },
  { slug: 'physical_activity',    label: '신체활동',    emoji: '⚽' },
  { slug: 'infection_symptom',    label: '감염/증상',   emoji: '🤒' },
  { slug: 'respiratory_allergy',  label: '호흡/알레르기', emoji: '🌬️' },
  { slug: 'digestion_excretion',  label: '소화/배변',   emoji: '🚽' },
  { slug: 'oral_sensory',         label: '구강/시청각', emoji: '🦷' },
  { slug: 'emotion_behavior',     label: '정서/행동',   emoji: '💛' },
  { slug: 'safety_injury',        label: '안전/손상',   emoji: '🩹' },
  { slug: 'preventive_care',      label: '예방관리',    emoji: '💉' },
  { slug: 'adolescent_health',    label: '청소년 건강', emoji: '🎒' },
  { slug: 'treatment_management', label: '치료관리',    emoji: '🏥' },
];

export const categoryLabel = (slug: CategorySlug): string =>
  CATEGORIES.find((c) => c.slug === slug)?.label ?? slug;

// 기록 유형 → 기본 영역 태그 자동 제안 (보호자가 수정 가능)
export const DEFAULT_CATEGORY_BY_TYPE: Record<RecordType, CategorySlug[]> = {
  condition:       ['emotion_behavior'],
  behavior:        ['emotion_behavior', 'development'],
  meal:            ['nutrition'],
  sleep:           ['sleep'],
  excretion:       ['digestion_excretion'],
  activity:        ['physical_activity'],
  symptom:         ['infection_symptom'],
  medication_dose: ['treatment_management'],
  incident:        ['safety_injury'],
  media_use:       ['development', 'emotion_behavior'],
  school:          ['adolescent_health'],
  note:            [],
};
