// Edge Function: 만료형 공유 링크의 실제 진입점.
// 링크를 받은 사람(비로그인)이 이 URL을 열면 매번 서버에서 토큰 유효성(만료/회수)을
// 재검사한 뒤에만 PDF로 짧은 수명(5분)의 서명 URL을 발급한다.
// → 원본 파일에 대한 영구 서명 URL을 직접 나눠주지 않으므로, "회수" 버튼이
//   실제로 즉시 접근을 끊을 수 있다 (Storage 서명 URL 자체는 발급 후 되돌릴 수 없음).
//
// 배포:
//   supabase functions deploy share-report --no-verify-jwt
//   (--no-verify-jwt 필수 — 링크를 받는 사람은 Supabase 로그인 세션이 없음)
//
// 공유 URL 형태: {SUPABASE_URL}/functions/v1/share-report?token=<token>
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const REPORTS_BUCKET = 'reports';
const DOWNLOAD_URL_TTL = 300; // 5분 — 매 접속마다 재발급

const html = (title: string, body: string, status: number) =>
  new Response(
    `<!doctype html><html lang="ko"><head><meta charset="utf-8">
     <meta name="viewport" content="width=device-width, initial-scale=1">
     <title>${title}</title>
     <style>
       body{font-family:-apple-system,'Apple SD Gothic Neo',sans-serif;background:#f9f9f7;
            color:#0b0b0b;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px}
       .card{background:#fcfcfb;border-radius:16px;padding:32px;max-width:420px;text-align:center;
             box-shadow:0 1px 3px rgba(11,11,11,0.08)}
       h1{font-size:18px;margin:0 0 8px}
       p{font-size:14px;color:#52514e;line-height:1.6;margin:0}
     </style></head>
     <body><div class="card"><h1>${title}</h1><p>${body}</p></div></body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get('token');
  if (!token) return html('잘못된 링크', '공유 링크 형식이 올바르지 않습니다.', 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: link, error } = await admin
    .from('share_links')
    .select('id, expires_at, revoked_at, report:reports(storage_path, period_start, period_end)')
    .eq('token', token)
    .maybeSingle();

  if (error || !link) return html('링크를 찾을 수 없습니다', '주소를 다시 확인해 주세요.', 404);
  if (link.revoked_at) return html('만료된 링크', '보호자가 이 공유를 회수했습니다. 다시 요청해 주세요.', 410);
  if (new Date(link.expires_at).getTime() <= Date.now()) {
    return html('만료된 링크', '공유 기간이 지났습니다. 보호자에게 새 링크를 요청해 주세요.', 410);
  }
  const storagePath = (link.report as unknown as { storage_path: string | null })?.storage_path;
  if (!storagePath) return html('파일을 찾을 수 없습니다', '레포트 파일이 아직 준비되지 않았습니다.', 404);

  const { data: signed, error: signErr } = await admin.storage
    .from(REPORTS_BUCKET)
    .createSignedUrl(storagePath, DOWNLOAD_URL_TTL);
  if (signErr || !signed) return html('오류', '파일을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.', 500);

  return Response.redirect(signed.signedUrl, 302);
});
