import { CronExpressionParser } from 'cron-parser';

/** Whether `expr` is a parseable cron expression in the given timezone. */
export function isValidCron(expr: string, timezone = 'UTC'): boolean {
  try {
    CronExpressionParser.parse(expr, { tz: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Next fire time strictly after `from` for a cron expression, or null if the
 * expression never fires again (cron-parser throws past its bounds).
 */
export function nextCronRun(
  expr: string,
  timezone: string,
  from: Date,
): Date | null {
  try {
    const interval = CronExpressionParser.parse(expr, {
      tz: timezone,
      currentDate: from,
    });
    return interval.next().toDate();
  } catch {
    return null;
  }
}
