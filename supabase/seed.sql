-- 샘플 시드 데이터 (개발용) — schema.sql 적용 후 실행
-- 주의: auth.users에 보호자 계정이 먼저 있어야 한다.
--   Supabase Studio > Authentication에서 dev@example.com 생성 후
--   아래 :guardian_id 를 해당 uuid로 치환하거나, psql -v guardian_id=... 로 실행.

-- 보호자 프로필
insert into profiles (id, name, phone, relationship)
values (:'guardian_id', '김보호', '010-1234-5678', '엄마');

-- 구독 (시드는 아이 2명을 등록하므로 free 한도(1명)를 넘는다 — standard 이상 필요)
insert into subscriptions (user_id, tier) values (:'guardian_id', 'standard');

-- 아이 2명
insert into children (id, name, nickname, birth_date, sex, birth_weight_g, birth_height_cm,
                      gestational_weeks, is_preterm, blood_type, allergies, chronic_conditions,
                      hospitalizations, primary_doctor, primary_hospital, guardian_phone)
values
  ('11111111-1111-1111-1111-111111111111', '김하은', '하니',
   current_date - interval '3 years 40 days', 'female', 2980, 49.2, 39, false, 'A+',
   array['계란(난백)','땅콩'], array['아토피 피부염(경증)'],
   '[{"name":"모세기관지염","hospital":"서울아이병원"}]'::jsonb,
   '박소아 선생님', '서울아이소아청소년과', '010-1234-5678'),
  ('22222222-2222-2222-2222-222222222222', '김도윤', '도도',
   current_date - interval '9 years 100 days', 'male', 3350, 51.0, 40, false, 'O+',
   '{}', array['알레르기 비염'], '[]'::jsonb,
   '이건강 선생님', '한빛소아청소년과', '010-1234-5678');

insert into guardian_child (guardian_id, child_id, role) values
  (:'guardian_id', '11111111-1111-1111-1111-111111111111', 'owner'),
  (:'guardian_id', '22222222-2222-2222-2222-222222222222', 'owner');

-- 동의 (법정대리인 + 민감정보) — 없으면 RLS가 기록 INSERT를 차단한다
insert into consents (child_id, guardian_id, type) values
  ('11111111-1111-1111-1111-111111111111', :'guardian_id', 'guardian_legal'),
  ('11111111-1111-1111-1111-111111111111', :'guardian_id', 'sensitive_health'),
  ('22222222-2222-2222-2222-222222222222', :'guardian_id', 'guardian_legal'),
  ('22222222-2222-2222-2222-222222222222', :'guardian_id', 'sensitive_health');

-- 하은: 발열 에피소드 3일치 예시 기록
insert into daily_records (child_id, author_id, record_date, record_time, type, categories, payload, memo) values
  ('11111111-1111-1111-1111-111111111111', :'guardian_id', current_date - 3, '08:00', 'symptom',
   array['infection_symptom'], '{"symptom":"발열","temperatureC":38.6,"severity":4}', null),
  ('11111111-1111-1111-1111-111111111111', :'guardian_id', current_date - 3, '14:00', 'symptom',
   array['infection_symptom'], '{"symptom":"발열","temperatureC":39.1,"severity":4}', '몸이 뜨겁고 칭얼거림'),
  ('11111111-1111-1111-1111-111111111111', :'guardian_id', current_date - 3, '14:30', 'medication_dose',
   array['treatment_management'], '{"medicationName":"해열제(병원 처방)","givenAt":"14:30","doseText":"처방 용량대로"}', null),
  ('11111111-1111-1111-1111-111111111111', :'guardian_id', current_date - 3, '21:00', 'sleep',
   array['sleep'], '{"sleepStart":"20:30","sleepEnd":"07:20","nightWakings":3,"quality":2}', null),
  ('11111111-1111-1111-1111-111111111111', :'guardian_id', current_date - 2, '09:00', 'symptom',
   array['infection_symptom'], '{"symptom":"발열","temperatureC":38.0,"severity":3}', null),
  ('11111111-1111-1111-1111-111111111111', :'guardian_id', current_date - 2, '12:30', 'meal',
   array['nutrition'], '{"mealType":"점심","amount":"절반","items":["죽","바나나"],"waterMl":150}', null),
  ('11111111-1111-1111-1111-111111111111', :'guardian_id', current_date - 1, '09:00', 'symptom',
   array['infection_symptom'], '{"symptom":"발열","temperatureC":37.6,"severity":2}', '열이 내려가는 중'),
  ('11111111-1111-1111-1111-111111111111', :'guardian_id', current_date - 1, '10:00', 'excretion',
   array['digestion_excretion'], '{"kind":"대변","count":1,"stoolForm":"묽음","color":"노란색"}', null),
  ('11111111-1111-1111-1111-111111111111', :'guardian_id', current_date, '09:00', 'condition',
   array['emotion_behavior'], '{"level":4,"mood":"좋음"}', '컨디션 회복');

-- 도윤: 비염 관리 예시
insert into daily_records (child_id, author_id, record_date, record_time, type, categories, payload) values
  ('22222222-2222-2222-2222-222222222222', :'guardian_id', current_date, '07:30', 'symptom',
   array['respiratory_allergy'], '{"symptom":"재채기/콧물","severity":2}'),
  ('22222222-2222-2222-2222-222222222222', :'guardian_id', current_date, '08:00', 'medication_dose',
   array['treatment_management'], '{"medicationName":"비염약(병원 처방)","givenAt":"08:00","doseText":"1일 1회 아침"}'),
  ('22222222-2222-2222-2222-222222222222', :'guardian_id', current_date, '17:00', 'activity',
   array['physical_activity'], '{"activity":"축구교실","durationMin":60,"intensity":"높음"}');

-- 성장 측정
insert into growth_measurements (child_id, measured_on, height_cm, weight_kg) values
  ('11111111-1111-1111-1111-111111111111', current_date - 360, 88.1, 12.1),
  ('11111111-1111-1111-1111-111111111111', current_date - 180, 92.3, 13.4),
  ('11111111-1111-1111-1111-111111111111', current_date - 7,   95.6, 14.5),
  ('22222222-2222-2222-2222-222222222222', current_date - 360, 128.5, 27.0),
  ('22222222-2222-2222-2222-222222222222', current_date - 14,  134.6, 30.8);

-- 복용약
insert into medications (child_id, name, dose_text, schedule_text, start_date, prescriber, is_active) values
  ('11111111-1111-1111-1111-111111111111', '아토피 보습 연고(처방)', '1일 2회 도포', '아침/저녁 목욕 후',
   current_date - 120, '서울아이소아청소년과', true),
  ('22222222-2222-2222-2222-222222222222', '비염약(병원 처방)', '1일 1회 아침', '아침 식후',
   current_date - 60, '한빛소아청소년과', true);

-- 예방접종 / 검진
insert into vaccinations (child_id, vaccine_name, dose_no, due_date, done_date, hospital, adverse_reaction) values
  ('11111111-1111-1111-1111-111111111111', 'MMR', 1, null, current_date - 800, '서울아이소아청소년과', null),
  ('11111111-1111-1111-1111-111111111111', '일본뇌염(불활성화)', 2, null, current_date - 200, '서울아이소아청소년과', '접종 부위 미열, 하루 뒤 호전'),
  ('11111111-1111-1111-1111-111111111111', '인플루엔자', 1, current_date + 30, null, null, null),
  ('22222222-2222-2222-2222-222222222222', '인플루엔자', 1, current_date + 30, null, null, null);

insert into checkups (child_id, checkup_name, due_date, done_date, hospital, result_summary) values
  ('11111111-1111-1111-1111-111111111111', '영유아 건강검진 7차', current_date + 60, null, null, null),
  ('22222222-2222-2222-2222-222222222222', '학생 건강검진(초3)', null, current_date - 90, '한빛소아청소년과', '정상, 시력 좌 0.8 재검 권고');
