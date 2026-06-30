/**
 * The well-known job kinds the Scheduler dispatches. Consumers may also register
 * handlers under arbitrary string kinds (e.g. plugin-defined), so the public
 * contract accepts `JobKind | string`.
 */
export enum JobKind {
  Reminder = 'reminder',
  GiveawayEnd = 'giveaway.end',
  Backup = 'backup',
  Cleanup = 'cleanup',
  Maintenance = 'maintenance',
  Custom = 'custom',
}

/** Built-in kinds the Scheduler owns internally (not registered by consumers). */
export const INTERNAL_JOB_KINDS: ReadonlySet<string> = new Set([
  JobKind.Cleanup,
  JobKind.Maintenance,
]);
