/** BullMQ queue name owned exclusively by the Scheduler module. */
export const SCHEDULER_QUEUE = 'scheduler.jobs';

/** DI token carrying the resolved Redis connection options for the worker/queue. */
export const SCHEDULER_REDIS_CONNECTION = Symbol('SCHEDULER_REDIS_CONNECTION');

export interface SchedulerRedisConnection {
  host: string;
  port: number;
}
