import { Injectable } from '@nestjs/common';

/** Process-local health signals surfaced by `GET /scheduler/health`. */
@Injectable()
export class SchedulerHealthState {
  private lastReconcileAt: Date | null = null;
  private workerUp = false;

  markReconciled(at: Date): void {
    this.lastReconcileAt = at;
  }

  markWorkerUp(up: boolean): void {
    this.workerUp = up;
  }

  snapshot(): { lastReconcileAt: Date | null; workerUp: boolean } {
    return { lastReconcileAt: this.lastReconcileAt, workerUp: this.workerUp };
  }
}
