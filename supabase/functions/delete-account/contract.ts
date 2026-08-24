/** The Edge response schema consumed by the mobile client. Increment on breaking changes. */
export const ACCOUNT_DELETION_CONTRACT_VERSION = 1;
export const accountDeletionResponse = <T extends Record<string, unknown>>(body: T) => ({
  contract_version: ACCOUNT_DELETION_CONTRACT_VERSION,
  ...body,
});
