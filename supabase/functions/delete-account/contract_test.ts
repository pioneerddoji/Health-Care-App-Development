import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { ACCOUNT_DELETION_CONTRACT_VERSION, accountDeletionResponse } from './contract.ts';

Deno.test('account deletion responses are versioned and preserve completed/partial/processing states', () => {
  assertEquals(accountDeletionResponse({ job_id: 'job-1', status: 'completed' }), {
    contract_version: ACCOUNT_DELETION_CONTRACT_VERSION, job_id: 'job-1', status: 'completed',
  });
  assertEquals(accountDeletionResponse({ job_id: 'job-2', status: 'partial', phase: 'delete_storage', retryable: true }), {
    contract_version: ACCOUNT_DELETION_CONTRACT_VERSION, job_id: 'job-2', status: 'partial', phase: 'delete_storage', retryable: true,
  });
  assertEquals(accountDeletionResponse({ job_id: 'job-3', status: 'processing', retryable: true }), {
    contract_version: ACCOUNT_DELETION_CONTRACT_VERSION, job_id: 'job-3', status: 'processing', retryable: true,
  });
});
