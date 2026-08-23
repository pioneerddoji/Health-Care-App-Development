// Edge Function: hash-only 만료형 병원 공유 링크의 유일한 외부 진입점.
// 매 요청에서 DB의 회수·만료·대상자 삭제·민감정보 동의를 원자적으로 확인한 뒤에만
// 5분짜리 Storage 서명 URL을 발급한다. 원문 token/IP/User-Agent는 저장·로그하지 않는다.
// 배포: supabase functions deploy share-report --no-verify-jwt
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const REPORTS_BUCKET = 'reports';
export const DOWNLOAD_URL_TTL = 300;
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export type ShareReportAdmin = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
  storage: {
    from: (bucket: string) => {
      createSignedUrl: (path: string, ttl: number) => Promise<{
        data: { signedUrl?: string } | null;
        error: unknown;
      }>;
    };
  };
};

const securityHeaders = (headers: Record<string, string> = {}) => ({
  'cache-control': 'no-store, max-age=0',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  ...headers,
});

const invalid = () => new Response('Not found', {
  status: 404,
  headers: securityHeaders({ 'content-type': 'text/plain; charset=utf-8' }),
});

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Factory injection lets CI execute the deployed handler contract with a Supabase/storage double.
export function createShareReportHandler(createAdmin: () => ShareReportAdmin) {
  return async (req: Request): Promise<Response> => {
    // 공유 URL은 GET 전용이다. OPTIONS/CORS를 열지 않아 외부 웹앱의 교차 출처 소비를 막는다.
    if (req.method !== 'GET') return invalid();

    const token = new URL(req.url).searchParams.get('token');
    if (!token || !TOKEN_PATTERN.test(token)) return invalid();

    try {
      const admin = createAdmin();
      const { data: access, error } = await admin.rpc('consume_share_link_token', {
        p_token_hash: await sha256Hex(token),
      });
      const storagePath = (access as { storage_path?: string } | null)?.storage_path;
      // 존재·회수·만료·삭제·동의 철회·rate-limit을 하나의 최소 응답으로 합쳐 oracle을 없앤다.
      if (error || !storagePath) return invalid();

      const { data: signed, error: signError } = await admin.storage
        .from(REPORTS_BUCKET)
        .createSignedUrl(storagePath, DOWNLOAD_URL_TTL);
      if (signError || !signed?.signedUrl) return invalid();

      return new Response(null, {
        status: 302,
        headers: securityHeaders({ location: signed.signedUrl }),
      });
    } catch {
      // 서비스 내부 오류도 유효성 오류와 구별하지 않고, 민감한 token을 기록하지 않는다.
      return invalid();
    }
  };
}

if (import.meta.main) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  Deno.serve(createShareReportHandler(() => createClient(supabaseUrl, serviceRoleKey)));
}
