/** Adapters set this field from their upstream's documented status. */
export type TaskStatus = 'succeeded' | 'business_failed' | 'execution_failed';

export function resultExitCode(result: unknown): number {
  if (!result || typeof result !== 'object' || !('taskStatus' in result)) return 0;
  return result.taskStatus === 'business_failed' ? 2 : result.taskStatus === 'execution_failed' ? 1 : 0;
}
