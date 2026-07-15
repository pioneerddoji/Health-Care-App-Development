// 기록 집계 — 대시보드와 PDF 레포트가 공용으로 사용하는 순수 함수 모음
import type { DailyRecord, ISODate } from '../types';
import { dateRange, sleepHours } from '../lib/date';

export interface TempPoint { date: ISODate; time?: string; value: number }
export interface SleepDay { date: ISODate; totalHours: number; wakings: number }
export interface MealDay { date: ISODate; mealScore: number; waterMl: number }
export interface ExcretionDay { date: ISODate; stool: number; urine: number; loose: number }
export interface SymptomEvent { date: ISODate; time?: string; symptom: string; severity: number }

export const inPeriod = (records: DailyRecord[], from: ISODate, to: ISODate) =>
  records.filter((r) => r.recordDate >= from && r.recordDate <= to);

export const aggregateTemperature = (records: DailyRecord[]): TempPoint[] =>
  records
    .filter((r) => r.type === 'symptom' && typeof r.payload.temperatureC === 'number')
    .map((r) => ({ date: r.recordDate, time: r.recordTime, value: r.payload.temperatureC! }))
    .sort((a, b) => (a.date + (a.time ?? '')).localeCompare(b.date + (b.time ?? '')));

export const aggregateSleep = (
  records: DailyRecord[], from: ISODate, to: ISODate,
): SleepDay[] =>
  dateRange(from, to).map((date) => {
    const day = records.filter((r) => r.type === 'sleep' && r.recordDate === date);
    const totalHours = day.reduce((sum, r) => {
      const { sleepStart, sleepEnd } = r.payload;
      return sleepStart && sleepEnd ? sum + sleepHours(sleepStart, sleepEnd) : sum;
    }, 0);
    const wakings = day.reduce((s, r) => s + (r.payload.nightWakings ?? 0), 0);
    return { date, totalHours: Math.round(totalHours * 10) / 10, wakings };
  });

// 식사 점수: 전량 1, 절반 0.5, 거의 안 먹음 0.2 — "얼마나 먹었나" 상대 지표
const AMOUNT_SCORE: Record<string, number> = { '전량': 1, '절반': 0.5, '거의 안 먹음': 0.2 };

export const aggregateMeals = (
  records: DailyRecord[], from: ISODate, to: ISODate,
): MealDay[] =>
  dateRange(from, to).map((date) => {
    const day = records.filter((r) => r.type === 'meal' && r.recordDate === date);
    const mealScore = day.reduce((s, r) => s + (AMOUNT_SCORE[r.payload.amount ?? ''] ?? 0), 0);
    const waterMl = day.reduce((s, r) => s + (r.payload.waterMl ?? 0), 0);
    return { date, mealScore: Math.round(mealScore * 10) / 10, waterMl };
  });

export const aggregateExcretion = (
  records: DailyRecord[], from: ISODate, to: ISODate,
): ExcretionDay[] =>
  dateRange(from, to).map((date) => {
    const day = records.filter((r) => r.type === 'excretion' && r.recordDate === date);
    const count = (kind: string) =>
      day.filter((r) => r.payload.kind === kind).reduce((s, r) => s + (r.payload.count ?? 1), 0);
    const loose = day
      .filter((r) => r.payload.kind === '대변' && r.payload.stoolForm === '묽음')
      .reduce((s, r) => s + (r.payload.count ?? 1), 0);
    return { date, stool: count('대변'), urine: count('소변'), loose };
  });

export const symptomTimeline = (records: DailyRecord[]): SymptomEvent[] =>
  records
    .filter((r) => r.type === 'symptom' && r.payload.symptom)
    .map((r) => ({
      date: r.recordDate,
      time: r.recordTime,
      symptom: r.payload.symptom!,
      severity: r.payload.severity ?? 1,
    }))
    .sort((a, b) => (a.date + (a.time ?? '')).localeCompare(b.date + (b.time ?? '')));

/** 기간 요약 문장 재료 — 레포트 1페이지 요약에 사용 (판단·진단 없이 사실 집계만) */
export const summarizePeriod = (records: DailyRecord[], from: ISODate, to: ISODate) => {
  const period = inPeriod(records, from, to);
  const temps = aggregateTemperature(period);
  const feverDays = new Set(temps.filter((t) => t.value >= 37.5).map((t) => t.date));
  const maxTemp = temps.length ? Math.max(...temps.map((t) => t.value)) : undefined;
  const symptoms = symptomTimeline(period);
  const symptomNames = [...new Set(symptoms.map((s) => s.symptom))];
  const sleep = aggregateSleep(period, from, to).filter((s) => s.totalHours > 0);
  const avgSleep = sleep.length
    ? Math.round((sleep.reduce((s, d) => s + d.totalHours, 0) / sleep.length) * 10) / 10
    : undefined;
  const medDoses = period.filter((r) => r.type === 'medication_dose').length;
  const incidents = period.filter((r) => r.type === 'incident');
  return {
    totalRecords: period.length,
    feverDayCount: feverDays.size,
    maxTemp,
    symptomNames,
    avgSleepHours: avgSleep,
    medicationDoseCount: medDoses,
    incidents,
  };
};
