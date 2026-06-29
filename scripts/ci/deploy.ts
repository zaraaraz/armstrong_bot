import { execSync } from 'child_process';
import { loadCiConfig } from './ci-config.js';
import { HttpHealthChecker, type HealthReport } from './health-check.js';
import { rollback } from './rollback.js';
import { emitDeployEvent } from './notify.js';
import { randomUUID } from 'crypto';

export type DeployEnvironment = 'staging' | 'production';

export interface StageResult {
  readonly stage: 'migrate' | 'deploy' | 'health' | 'rollback';
  readonly success: boolean;
  readonly durationMs: number;
  readonly message: string;
}

export interface DeployContext {
  readonly environment: DeployEnvironment;
  readonly imageTag: string;
  readonly previousImageTag: string | null;
  readonly gitSha: string;
  readonly releaseVersion: string;
  readonly traceId: string;
}

export abstract class DeployOrchestrator {
  abstract migrate(ctx: DeployContext): Promise<StageResult>;
  abstract deploy(ctx: DeployContext): Promise<StageResult>;
  abstract verifyHealth(ctx: DeployContext): Promise<HealthReport>;
  abstract rollback(ctx: DeployContext): Promise<StageResult>;
  abstract run(ctx: DeployContext): Promise<ReadonlyArray<StageResult>>;
}

class DefaultDeployOrchestrator extends DeployOrchestrator {
  private readonly cfg = loadCiConfig(process.env);
  private readonly checker = new HttpHealthChecker();

  migrate(ctx: DeployContext): Promise<StageResult> {
    void ctx;
    const t = Date.now();
    try {
      execSync('npx prisma migrate deploy', { stdio: 'inherit' });
      return Promise.resolve({
        stage: 'migrate',
        success: true,
        durationMs: Date.now() - t,
        message: 'Migrations applied',
      });
    } catch (err) {
      return Promise.resolve({
        stage: 'migrate',
        success: false,
        durationMs: Date.now() - t,
        message: (err as Error).message,
      });
    }
  }

  deploy(ctx: DeployContext): Promise<StageResult> {
    const t = Date.now();
    try {
      execSync(
        `ssh ${this.cfg.DEPLOY_HOST} "docker pull ${ctx.imageTag} && docker service update --image ${ctx.imageTag} armstrong_bot"`,
        { stdio: 'inherit' },
      );
      return Promise.resolve({
        stage: 'deploy',
        success: true,
        durationMs: Date.now() - t,
        message: `Deployed ${ctx.imageTag}`,
      });
    } catch (err) {
      return Promise.resolve({
        stage: 'deploy',
        success: false,
        durationMs: Date.now() - t,
        message: (err as Error).message,
      });
    }
  }

  verifyHealth(ctx: DeployContext): Promise<HealthReport> {
    void ctx;
    return this.checker.probe(
      this.cfg.HEALTH_URL,
      this.cfg.HEALTH_MAX_ATTEMPTS,
      this.cfg.HEALTH_INTERVAL_MS,
    );
  }

  rollback(ctx: DeployContext): Promise<StageResult> {
    return Promise.resolve(
      rollback(ctx.previousImageTag, this.cfg.DEPLOY_HOST, Date.now()),
    );
  }

  async run(ctx: DeployContext): Promise<ReadonlyArray<StageResult>> {
    const results: StageResult[] = [];

    await emitDeployEvent(
      this.cfg.NOTIFY_INGRESS_URL,
      this.cfg.NOTIFY_INGRESS_TOKEN,
      {
        type: 'ci.deploy.started',
        environment: ctx.environment,
        version: ctx.releaseVersion,
        gitSha: ctx.gitSha,
        traceId: ctx.traceId,
        at: new Date().toISOString(),
      },
    );

    const migrateResult = await this.migrate(ctx);
    results.push(migrateResult);
    if (!migrateResult.success) {
      await emitDeployEvent(
        this.cfg.NOTIFY_INGRESS_URL,
        this.cfg.NOTIFY_INGRESS_TOKEN,
        {
          type: 'ci.deploy.failed',
          environment: ctx.environment,
          version: ctx.releaseVersion,
          failedStage: 'migrate',
          rolledBack: false,
          traceId: ctx.traceId,
        },
      );
      return results;
    }

    const deployResult = await this.deploy(ctx);
    results.push(deployResult);
    if (!deployResult.success) {
      const rb = await this.rollback(ctx);
      results.push(rb);
      await emitDeployEvent(
        this.cfg.NOTIFY_INGRESS_URL,
        this.cfg.NOTIFY_INGRESS_TOKEN,
        {
          type: 'ci.deploy.failed',
          environment: ctx.environment,
          version: ctx.releaseVersion,
          failedStage: 'deploy',
          rolledBack: rb.success,
          traceId: ctx.traceId,
        },
      );
      return results;
    }

    const health = await this.verifyHealth(ctx);
    results.push({
      stage: 'health',
      success: health.healthy,
      durationMs: 0,
      message: health.healthy
        ? 'Health check passed'
        : `Failed probes: ${health.failedProbes.join('; ')}`,
    });

    if (!health.healthy) {
      const rb = await this.rollback(ctx);
      results.push(rb);
      await emitDeployEvent(
        this.cfg.NOTIFY_INGRESS_URL,
        this.cfg.NOTIFY_INGRESS_TOKEN,
        {
          type: 'ci.deploy.failed',
          environment: ctx.environment,
          version: ctx.releaseVersion,
          failedStage: 'health',
          rolledBack: rb.success,
          traceId: ctx.traceId,
        },
      );
      return results;
    }

    const totalMs = results.reduce((sum, r) => sum + r.durationMs, 0);
    await emitDeployEvent(
      this.cfg.NOTIFY_INGRESS_URL,
      this.cfg.NOTIFY_INGRESS_TOKEN,
      {
        type: 'ci.deploy.succeeded',
        environment: ctx.environment,
        version: ctx.releaseVersion,
        durationMs: totalMs,
        traceId: ctx.traceId,
      },
    );

    return results;
  }
}

// Entry point when run directly via `npx tsx scripts/ci/deploy.ts`
const cfg = loadCiConfig(process.env);
const ctx: DeployContext = {
  environment: cfg.DEPLOY_ENVIRONMENT,
  imageTag: `${cfg.IMAGE_REGISTRY}:${cfg.IMAGE_TAG}`,
  previousImageTag: cfg.PREVIOUS_IMAGE_TAG
    ? `${cfg.IMAGE_REGISTRY}:${cfg.PREVIOUS_IMAGE_TAG}`
    : null,
  gitSha: process.env.GITHUB_SHA ?? 'unknown',
  releaseVersion: cfg.IMAGE_TAG,
  traceId: randomUUID(),
};

const orchestrator = new DefaultDeployOrchestrator();
void orchestrator.run(ctx).then((results) => {
  console.log(JSON.stringify(results, null, 2));
  const failed = results.some((r) => !r.success && r.stage !== 'rollback');
  process.exit(failed ? 1 : 0);
});
