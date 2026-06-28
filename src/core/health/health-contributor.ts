export type HealthState = 'up' | 'down' | 'degraded';

export interface HealthCheckResult {
  readonly state: HealthState;
  readonly detail?: Readonly<Record<string, string | number | boolean>>;
}

export interface HealthContributor {
  readonly name: string;
  check(): Promise<HealthCheckResult>;
}
