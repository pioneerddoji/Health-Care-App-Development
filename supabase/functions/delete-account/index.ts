// Edge Function: 재인증된 사용자의 계정을 Storage → 관계형 데이터 → Auth 순서로 파기한다.
//
// 배포: supabase functions deploy delete-account
// 이 함수는 JWT 검증을 켠 상태로 배포한다. service role key는 서버 내부에서만 사용하며
// 응답/로그/감사 detail에 건강정보·경로·토큰을 기록하지 않는다.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { accountDeletionResponse } from './contract.ts';
import { removePrefix } from './storage.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RECORD_BUCKET = 'record-files';
const REPORT_BUCKET = 'reports';

const responseHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'content-type': 'application/json; charset=utf-8',
};
const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });

const unique = <T>(values: T[]) => [...new Set(values)];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: responseHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const authorization = req.headers.get('authorization');
  if (!authorization) return json({ error: 'unauthorized' }, 401);

  // getUser validates the supplied access token; do not trust a decoded JWT alone.
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await caller.auth.getUser();
  if (userError || !userData.user) return json({ error: 'unauthorized' }, 401);

  let dryRun = false;
  try {
    const body = await req.json() as { confirmation?: unknown; dry_run?: unknown };
    if (body.confirmation !== 'delete-my-account') return json({ error: 'confirmation_required' }, 400);
    dryRun = body?.dry_run === true;
  } catch {
    return json({ error: 'confirmation_required' }, 400);
  }

  // The SQL RPC enforces `sub` and the 10-minute `reauthenticated_at` custom JWT claim.
  // The Auth custom-access-token hook must set this claim only after a fresh password/OAuth reauth.
  const { data: requested, error: requestError } = await caller.rpc('request_account_deletion', { dry_run: dryRun });
  if (requestError || !requested) return json({ error: 'recent_reauthentication_required' }, 403);
  if (dryRun) return json(accountDeletionResponse(requested as Record<string, unknown>));

  const jobId = (requested as { job_id?: string }).job_id;
  if (!jobId) return json({ error: 'deletion_request_failed' }, 500);
  const { data: claimed, error: claimError } = await caller.rpc('claim_account_deletion_job', { requested_job_id: jobId });
  if (claimError || !claimed) return json(accountDeletionResponse({ job_id: jobId, status: 'processing', retryable: true }), 409);
  const leaseId = (claimed as { lease_id?: string }).lease_id;
  if (!leaseId) return json({ error: 'deletion_request_failed' }, 500);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: job, error: jobError } = await admin
    .from('account_deletion_jobs')
    .select('id, user_id, status')
    .eq('id', jobId)
    .eq('lease_id', leaseId)
    .maybeSingle();
  if (jobError || !job?.user_id || job.user_id !== userData.user.id) return json({ error: 'deletion_request_failed' }, 500);

  const renewLease = async () => {
    const { error } = await caller.rpc('renew_account_deletion_lease', {
      requested_job_id: jobId, requested_lease_id: leaseId,
    });
    if (error) throw new Error('deletion_lease_lost');
  };

  const fail = async (phase: string) => {
    await admin.from('account_deletion_jobs').update({
      status: 'partial', phase, last_error: 'retryable_server_failure', updated_at: new Date().toISOString(),
    }).eq('id', jobId).eq('lease_id', leaseId).eq('status', 'processing');
    await admin.from('account_deletion_audit').insert({ job_id: jobId, phase, outcome: 'partial' });
    return json(accountDeletionResponse({ job_id: jobId, status: 'partial', phase, retryable: true }), 503);
  };

  try {
    const uid = job.user_id;
    const { data: ownership, error: ownershipError } = await admin
      .from('guardian_child').select('child_id, role').eq('guardian_id', uid);
    if (ownershipError) throw new Error('ownership_lookup_failed');
    const ownedChildIds = (ownership ?? []).filter((row) => row.role === 'owner').map((row) => row.child_id);

    // Shared recipients survive, but this account's authored records/reports do not. This both
    // preserves co-owner data and removes foreign keys that would otherwise block Auth deletion.
    const [{ data: authoredRecords, error: authoredRecordsError }, { data: authoredReports, error: authoredReportsError },
      { data: ownedReports, error: ownedReportsError }] = await Promise.all([
      admin.from('daily_records').select('id, child_id').eq('author_id', uid),
      admin.from('reports').select('id, child_id, storage_path').eq('created_by', uid),
      ownedChildIds.length
        ? admin.from('reports').select('id, child_id, storage_path').in('child_id', ownedChildIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (authoredRecordsError || authoredReportsError || ownedReportsError) throw new Error('owned_data_lookup_failed');
    const reports = [...(authoredReports ?? []), ...(ownedReports ?? [])]
      .filter((report, index, all) => all.findIndex((candidate) => candidate.id === report.id) === index);
    const reportIds = reports.map((report) => report.id);

    // Token revocation precedes every file deletion. Existing signed URLs remain valid only for
    // their short TTL, but no new URL can be issued after this point.
    if (reportIds.length) {
      const { error } = await admin.from('share_links').update({ revoked_at: new Date().toISOString() }).in('report_id', reportIds).is('revoked_at', null);
      if (error) throw new Error('share_revoke_failed');
    }
    await admin.from('account_deletion_audit').insert({ job_id: jobId, phase: 'revoke_share_tokens', outcome: 'succeeded' });

    await renewLease();
    await admin.from('account_deletion_jobs').update({ phase: 'delete_storage', updated_at: new Date().toISOString() }).eq('id', jobId).eq('lease_id', leaseId).eq('status', 'processing');
    for (const childId of ownedChildIds) {
      await removePrefix(admin, RECORD_BUCKET, childId);
      await removePrefix(admin, REPORT_BUCKET, childId);
    }
    for (const record of authoredRecords ?? []) await removePrefix(admin, RECORD_BUCKET, `${record.child_id}/${record.id}`);
    for (const report of reports) if (report.storage_path) {
      const { error } = await admin.storage.from(REPORT_BUCKET).remove([report.storage_path]);
      if (error) throw new Error('report_storage_remove_failed');
    }
    await admin.from('account_deletion_audit').insert({ job_id: jobId, phase: 'delete_storage', outcome: 'succeeded' });

    await renewLease();
    await admin.from('account_deletion_jobs').update({ phase: 'delete_relational_data', updated_at: new Date().toISOString() }).eq('id', jobId).eq('lease_id', leaseId).eq('status', 'processing');
    // A task authored by the departing guardian cannot retain a required profile FK.
    // Tasks assigned to them are safe: assignee_id is ON DELETE SET NULL.
    const { error: authoredCareTaskError } = await admin.from('care_tasks').delete().eq('created_by', uid);
    if (authoredCareTaskError) throw new Error('authored_care_task_delete_failed');
    if (ownedChildIds.length) {
      const { error } = await admin.from('children').delete().in('id', ownedChildIds);
      if (error) throw new Error('owned_recipient_delete_failed');
    }
    if ((authoredRecords ?? []).length) {
      const { error } = await admin.from('daily_records').delete().eq('author_id', uid);
      if (error) throw new Error('authored_record_delete_failed');
    }
    if (reportIds.length) {
      const { error } = await admin.from('reports').delete().in('id', reportIds);
      if (error) throw new Error('authored_report_delete_failed');
    }
    await admin.from('account_deletion_audit').insert({ job_id: jobId, phase: 'delete_relational_data', outcome: 'succeeded' });

    await renewLease();
    await admin.from('account_deletion_jobs').update({ phase: 'delete_auth', updated_at: new Date().toISOString() }).eq('id', jobId).eq('lease_id', leaseId).eq('status', 'processing');
    const { error: deleteUserError } = await admin.auth.admin.deleteUser(uid);
    if (deleteUserError) throw new Error('auth_delete_failed');

    // Completion deliberately removes user_id. The retained audit is job-scoped and contains no
    // report path, token, health value, email, or user identifier.
    await admin.from('account_deletion_jobs').update({
      user_id: null, status: 'completed', phase: 'completed', completed_at: new Date().toISOString(),
      last_error: null, updated_at: new Date().toISOString(),
    }).eq('id', jobId).eq('lease_id', leaseId).eq('status', 'processing');
    await admin.from('account_deletion_audit').insert({ job_id: jobId, phase: 'completed', outcome: 'succeeded' });
    return json(accountDeletionResponse({ job_id: jobId, status: 'completed' }));
  } catch {
    return fail('retry_required');
  }
});
