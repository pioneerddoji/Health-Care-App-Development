import type { ISODate } from '../types';

export const toISODate = (d: Date): ISODate => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export const today = (): ISODate => toISODate(new Date());

export const addDays = (iso: ISODate, days: number): ISODate => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toISODate(d);
};

export const daysAgo = (days: number): ISODate => addDays(today(), -days);

/** from ≤ date ≤ to 의 날짜 배열 */
export const dateRange = (from: ISODate, to: ISODate): ISODate[] => {
  const out: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};

export const formatKorean = (iso: ISODate): string => {
  const [y, m, d] = iso.split('-');
  return `${y}년 ${Number(m)}월 ${Number(d)}일`;
};

export const formatShort = (iso: ISODate): string => {
  const [, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}`;
};

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
export const weekday = (iso: ISODate): string =>
  WEEKDAYS[new Date(`${iso}T00:00:00`).getDay()];

/** 만 나이 표기: 24개월 미만 "n개월", 이후 "만 n세" */
export const koreanAge = (birthDate: ISODate, on: ISODate = today()): string => {
  const b = new Date(`${birthDate}T00:00:00`);
  const t = new Date(`${on}T00:00:00`);
  let months = (t.getFullYear() - b.getFullYear()) * 12 + (t.getMonth() - b.getMonth());
  if (t.getDate() < b.getDate()) months -= 1;
  if (months < 24) return `${months}개월`;
  return `만 ${Math.floor(months / 12)}세`;
};

/** "HH:MM"→분. 수면시간 계산용(자정 넘김 처리) */
export const sleepHours = (start: string, end: string): number => {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60;
  return Math.round((mins / 60) * 10) / 10;
};
