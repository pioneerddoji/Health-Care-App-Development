// 샘플 데이터 — 아이 2명 + 최근 14일 기록.
// 날짜를 '오늘' 기준 상대값으로 생성해 언제 실행해도 대시보드/레포트가 채워진다.
import type {
  Child, DailyRecord, GrowthMeasurement, Medication, Vaccination, Checkup,
  Profile, RecordInput,
} from '../types';
import { DEFAULT_CATEGORY_BY_TYPE } from '../constants/categories';
import { daysAgo, addDays } from '../lib/date';

export const SAMPLE_GUARDIAN: Profile = {
  id: 'guardian-1',
  name: '김보호',
  relationship: '엄마',
  phone: '010-1234-5678',
};

export const SAMPLE_CHILDREN: Child[] = [
  {
    id: 'child-1',
    name: '김하은',
    nickname: '하니',
    birthDate: addDays(daysAgo(0), -365 * 3 - 40), // 만 3세 무렵
    sex: 'female',
    birthWeightG: 2980,
    birthHeightCm: 49.2,
    gestationalWeeks: 39,
    isPreterm: false,
    bloodType: 'A+',
    allergies: ['계란(난백)', '땅콩'],
    chronicConditions: ['아토피 피부염(경증)'],
    surgeries: [],
    hospitalizations: [{ name: '모세기관지염', date: daysAgo(400), hospital: '서울아이병원' }],
    primaryDoctor: '박소아 선생님',
    primaryHospital: '서울아이소아청소년과',
    guardianPhone: '010-1234-5678',
  },
  {
    id: 'child-2',
    name: '김도윤',
    nickname: '도도',
    birthDate: addDays(daysAgo(0), -365 * 9 - 100), // 만 9세 무렵
    sex: 'male',
    birthWeightG: 3350,
    birthHeightCm: 51.0,
    gestationalWeeks: 40,
    isPreterm: false,
    bloodType: 'O+',
    allergies: [],
    chronicConditions: ['알레르기 비염'],
    surgeries: [{ name: '편도선 절제술', date: daysAgo(700), hospital: '한빛이비인후과' }],
    hospitalizations: [],
    primaryDoctor: '이건강 선생님',
    primaryHospital: '한빛소아청소년과',
    guardianPhone: '010-1234-5678',
  },
];

let seq = 0;
const rid = () => `rec-${++seq}`;

const rec = (
  childId: string,
  recordDate: string,
  input: Omit<RecordInput, 'recordDate' | 'categories' | 'photoUris'> &
    Partial<Pick<RecordInput, 'categories' | 'photoUris'>>,
): DailyRecord => ({
  id: rid(),
  childId,
  authorId: SAMPLE_GUARDIAN.id,
  recordDate,
  recordTime: input.recordTime,
  type: input.type,
  categories: input.categories ?? DEFAULT_CATEGORY_BY_TYPE[input.type],
  payload: input.payload ?? {},
  memo: input.memo,
  photoUris: input.photoUris ?? [],
});

// 하은(child-1): 최근 5일 발열 감기 에피소드가 있는 14일 기록
const buildChild1Records = (): DailyRecord[] => {
  const out: DailyRecord[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = daysAgo(i);
    const sick = i <= 4 && i >= 1; // 4일 전~1일 전 발열
    // 컨디션
    out.push(rec('child-1', d, {
      type: 'condition', recordTime: '09:00',
      payload: { level: sick ? 2 : 4, mood: sick ? '처짐' : '좋음' },
    }));
    // 수면 (아픈 날 밤중 깸 증가)
    out.push(rec('child-1', d, {
      type: 'sleep', recordTime: '07:30',
      payload: {
        sleepStart: sick ? '20:30' : '21:10',
        sleepEnd: '07:20',
        nightWakings: sick ? 3 : i % 3 === 0 ? 1 : 0,
        quality: sick ? 2 : 4,
      },
    }));
    // 식사 3회 + 수분
    (['아침', '점심', '저녁'] as const).forEach((mealType, mi) => {
      out.push(rec('child-1', d, {
        type: 'meal', recordTime: ['08:00', '12:30', '18:00'][mi],
        payload: {
          mealType,
          amount: sick ? (mi === 0 ? '거의 안 먹음' : '절반') : '전량',
          items: sick ? ['죽', '바나나'] : ['밥', '국', '반찬'],
          waterMl: sick ? 150 : 100,
        },
      }));
    });
    // 배변
    out.push(rec('child-1', d, {
      type: 'excretion', recordTime: '10:00',
      payload: { kind: '대변', count: 1, stoolForm: sick ? '묽음' : '보통', color: '노란색' },
    }));
    out.push(rec('child-1', d, {
      type: 'excretion', recordTime: '19:00',
      payload: { kind: '소변', count: sick ? 4 : 6 },
    }));
    // 발열 에피소드: 체온 기록 + 해열제
    if (sick) {
      const temps: Record<number, [string, number][]> = {
        4: [['13:00', 37.8], ['20:00', 38.4]],
        3: [['08:00', 38.6], ['14:00', 39.1], ['21:00', 38.2]],
        2: [['09:00', 38.0], ['15:00', 37.9]],
        1: [['09:00', 37.6]],
      };
      for (const [time, t] of temps[i] ?? []) {
        out.push(rec('child-1', d, {
          type: 'symptom', recordTime: time,
          payload: { symptom: '발열', temperatureC: t, severity: t >= 38.5 ? 4 : 3 },
          memo: t >= 39 ? '몸이 뜨겁고 칭얼거림' : undefined,
        }));
      }
      out.push(rec('child-1', d, {
        type: 'symptom', recordTime: '11:00',
        payload: { symptom: '콧물', severity: 2 },
      }));
      if (i >= 2) {
        out.push(rec('child-1', d, {
          type: 'medication_dose', recordTime: '14:30',
          payload: { medicationName: '해열제(병원 처방)', givenAt: '14:30', doseText: '처방 용량대로' },
        }));
      }
    } else {
      // 평상시 놀이
      out.push(rec('child-1', d, {
        type: 'activity', recordTime: '16:00',
        payload: { activity: '놀이터 바깥놀이', durationMin: 40, intensity: '보통' },
      }));
    }
    if (i === 4) {
      out.push(rec('child-1', d, {
        type: 'incident', recordTime: '17:30',
        payload: { what: '거실에서 미끄러져 이마 가벼운 멍', incidentSeverity: '경미', action: '냉찜질 10분' },
      }));
    }
    if (i === 3) {
      out.push(rec('child-1', d, {
        type: 'school', recordTime: '09:30',
        payload: { attended: false, note: '발열로 어린이집 결석' },
        categories: ['infection_symptom'],
      }));
    }
  }
  return out;
};

// 도윤(child-2): 비염 + 생활 기록 위주 14일
const buildChild2Records = (): DailyRecord[] => {
  const out: DailyRecord[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = daysAgo(i);
    out.push(rec('child-2', d, {
      type: 'condition', recordTime: '08:00',
      payload: { level: 4, mood: '좋음' },
    }));
    out.push(rec('child-2', d, {
      type: 'sleep', recordTime: '07:00',
      payload: { sleepStart: '22:00', sleepEnd: '07:00', nightWakings: 0, quality: 4 },
    }));
    out.push(rec('child-2', d, {
      type: 'meal', recordTime: '19:00',
      payload: { mealType: '저녁', amount: '전량', items: ['밥', '불고기'], waterMl: 300 },
    }));
    if (i % 2 === 0) {
      out.push(rec('child-2', d, {
        type: 'symptom', recordTime: '07:30',
        payload: { symptom: '재채기/콧물', severity: 2 },
        categories: ['respiratory_allergy'],
      }));
      out.push(rec('child-2', d, {
        type: 'medication_dose', recordTime: '08:00',
        payload: { medicationName: '비염약(병원 처방)', givenAt: '08:00', doseText: '처방 용량대로' },
      }));
    }
    out.push(rec('child-2', d, {
      type: 'activity', recordTime: '17:00',
      payload: { activity: '축구교실', durationMin: 60, intensity: '높음' },
    }));
    out.push(rec('child-2', d, {
      type: 'media_use', recordTime: '20:00',
      payload: { durationMin: 30, content: '학습 영상' },
    }));
  }
  return out;
};

export const SAMPLE_RECORDS: DailyRecord[] = [
  ...buildChild1Records(),
  ...buildChild2Records(),
];

export const SAMPLE_GROWTH: GrowthMeasurement[] = [
  // 하은
  { id: 'g1', childId: 'child-1', measuredOn: daysAgo(360), heightCm: 88.1, weightKg: 12.1, bmi: 15.6 },
  { id: 'g2', childId: 'child-1', measuredOn: daysAgo(270), heightCm: 90.0, weightKg: 12.8, bmi: 15.8 },
  { id: 'g3', childId: 'child-1', measuredOn: daysAgo(180), heightCm: 92.3, weightKg: 13.4, bmi: 15.7 },
  { id: 'g4', childId: 'child-1', measuredOn: daysAgo(90),  heightCm: 94.0, weightKg: 14.0, bmi: 15.8 },
  { id: 'g5', childId: 'child-1', measuredOn: daysAgo(7),   heightCm: 95.6, weightKg: 14.5, bmi: 15.9 },
  // 도윤
  { id: 'g6', childId: 'child-2', measuredOn: daysAgo(360), heightCm: 128.5, weightKg: 27.0, bmi: 16.4 },
  { id: 'g7', childId: 'child-2', measuredOn: daysAgo(180), heightCm: 131.8, weightKg: 28.9, bmi: 16.6 },
  { id: 'g8', childId: 'child-2', measuredOn: daysAgo(14),  heightCm: 134.6, weightKg: 30.8, bmi: 17.0 },
];

export const SAMPLE_MEDICATIONS: Medication[] = [
  {
    id: 'm1', childId: 'child-1', name: '아토피 보습 연고(처방)',
    doseText: '1일 2회 도포', scheduleText: '아침/저녁 목욕 후',
    startDate: daysAgo(120), prescriber: '서울아이소아청소년과', isActive: true,
  },
  {
    id: 'm2', childId: 'child-1', name: '해열제(병원 처방)',
    doseText: '처방 용량대로', scheduleText: '발열 시',
    startDate: daysAgo(4), endDate: daysAgo(1), prescriber: '서울아이소아청소년과', isActive: false,
  },
  {
    id: 'm3', childId: 'child-2', name: '비염약(병원 처방)',
    doseText: '1일 1회 아침', scheduleText: '아침 식후',
    startDate: daysAgo(60), prescriber: '한빛소아청소년과', isActive: true,
  },
];

export const SAMPLE_VACCINATIONS: Vaccination[] = [
  { id: 'v1', childId: 'child-1', vaccineName: 'MMR', doseNo: 1, doneDate: daysAgo(800), hospital: '서울아이소아청소년과' },
  { id: 'v2', childId: 'child-1', vaccineName: '일본뇌염(불활성화)', doseNo: 2, doneDate: daysAgo(200), hospital: '서울아이소아청소년과', adverseReaction: '접종 부위 미열, 하루 뒤 호전' },
  { id: 'v3', childId: 'child-1', vaccineName: '인플루엔자', doseNo: 1, dueDate: addDays(daysAgo(0), 30) },
  { id: 'v4', childId: 'child-2', vaccineName: '인플루엔자', doseNo: 1, dueDate: addDays(daysAgo(0), 30) },
];

export const SAMPLE_CHECKUPS: Checkup[] = [
  { id: 'c1', childId: 'child-1', checkupName: '영유아 건강검진 7차', dueDate: addDays(daysAgo(0), 60) },
  { id: 'c2', childId: 'child-2', checkupName: '학생 건강검진(초3)', doneDate: daysAgo(90), hospital: '한빛소아청소년과', resultSummary: '정상, 시력 좌 0.8 재검 권고' },
];
