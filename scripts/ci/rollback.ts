import { execSync } from 'child_process';
import type { StageResult } from './deploy.js';

export function rollback(
  previousImageTag: string | null,
  deployHost: string,
  startedAt: number,
): StageResult {
  if (!previousImageTag) {
    return {
      stage: 'rollback',
      success: false,
      durationMs: Date.now() - startedAt,
      message: 'No previous image tag available for rollback',
    };
  }

  try {
    execSync(
      `ssh ${deployHost} "docker pull ${previousImageTag} && docker service update --image ${previousImageTag} armstrong_bot"`,
      { stdio: 'inherit' },
    );
    return {
      stage: 'rollback',
      success: true,
      durationMs: Date.now() - startedAt,
      message: `Rolled back to ${previousImageTag}`,
    };
  } catch (err) {
    return {
      stage: 'rollback',
      success: false,
      durationMs: Date.now() - startedAt,
      message: `Rollback failed: ${(err as Error).message}`,
    };
  }
}
