// Supabase 클라이언트. env가 비어 있으면 null을 반환하고
// 앱은 인메모리(mock) 모드로 동작한다 — services 계층에서 분기.
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { sessionStorage } from './secureSessionStorage';

const url =
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
  (Constants.expoConfig?.extra?.supabaseUrl as string | undefined);
const anonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  (Constants.expoConfig?.extra?.supabaseAnonKey as string | undefined);

/** 공유 링크 URL 조립용 (Edge Function 엔드포인트) */
export const supabaseUrl = url ?? null;

export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: {
          // 네이티브: SecureStore 키 기반 암호화 저장 / 웹: AsyncStorage 폴백
          storage: sessionStorage,
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
        },
      })
    : null;

export const isMockMode = supabase === null;
