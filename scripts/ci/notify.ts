import type { DeployEnvironment } from './deploy.js';

export interface DeployStartedEvent {
  readonly type: 'ci.deploy.started';
  readonly environment: DeployEnvironment;
  readonly version: string;
  readonly gitSha: string;
  readonly traceId: string;
  readonly at: string;
}

export interface DeploySucceededEvent {
  readonly type: 'ci.deploy.succeeded';
  readonly environment: DeployEnvironment;
  readonly version: string;
  readonly durationMs: number;
  readonly traceId: string;
}

export interface DeployFailedEvent {
  readonly type: 'ci.deploy.failed';
  readonly environment: DeployEnvironment;
  readonly version: string;
  readonly failedStage: 'migrate' | 'deploy' | 'health' | 'rollback';
  readonly rolledBack: boolean;
  readonly traceId: string;
}

export type DeployEvent =
  DeployStartedEvent | DeploySucceededEvent | DeployFailedEvent;

export async function emitDeployEvent(
  ingressUrl: string,
  ingressToken: string,
  event: DeployEvent,
): Promise<void> {
  const res = await fetch(ingressUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ingressToken}`,
    },
    body: JSON.stringify(event),
  });

  if (!res.ok) {
    console.warn(
      `[notify] Ingress responded ${res.status} — event not delivered`,
    );
  }
}
