export interface HealthReport {
  readonly healthy: boolean;
  readonly checkedAt: string;
  readonly attempts: number;
  readonly failedProbes: ReadonlyArray<string>;
}

export interface HealthChecker {
  probe(
    baseUrl: string,
    maxAttempts: number,
    intervalMs: number,
  ): Promise<HealthReport>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class HttpHealthChecker implements HealthChecker {
  async probe(
    baseUrl: string,
    maxAttempts: number,
    intervalMs: number,
  ): Promise<HealthReport> {
    const failedProbes: string[] = [];
    let attempts = 0;

    for (let i = 0; i < maxAttempts; i++) {
      attempts++;
      try {
        const res = await fetch(`${baseUrl}/health`);
        if (res.ok) {
          return {
            healthy: true,
            checkedAt: new Date().toISOString(),
            attempts,
            failedProbes,
          };
        }
        failedProbes.push(`attempt ${attempts}: HTTP ${res.status}`);
      } catch (err) {
        failedProbes.push(`attempt ${attempts}: ${(err as Error).message}`);
      }

      if (i < maxAttempts - 1) {
        await sleep(intervalMs);
      }
    }

    return {
      healthy: false,
      checkedAt: new Date().toISOString(),
      attempts,
      failedProbes,
    };
  }
}
