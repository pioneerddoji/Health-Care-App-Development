/** UPDATE가 실제로 한 행을 반환한 경우에만 서버 완료를 로컬에 반영한다. */
export const assertCareTaskCompletionResult = (result: {
  data: { id: string } | null;
  error: { message: string } | null;
}): void => {
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new Error('진료 후 안내 완료 결과를 확인할 수 없습니다');
};
