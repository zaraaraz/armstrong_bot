import type { NotificationCategory } from '../../notifications.public';

/** All notification categories, in display order. */
export const ALL_CATEGORIES: readonly NotificationCategory[] = [
  'system',
  'moderation',
  'tickets',
  'integrations',
  'digest',
  'marketing',
] as const;

const CATEGORY_SET = new Set<string>(ALL_CATEGORIES);

export function isNotificationCategory(
  value: string,
): value is NotificationCategory {
  return CATEGORY_SET.has(value);
}
