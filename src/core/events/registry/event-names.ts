import type { EventName } from './event-map';

const EVENT_NAME_PATTERN = /^[a-z][a-z0-9]*\.[a-z][a-z0-9]*\.[a-z][a-z0-9]*$/;

export function isValidEventName(name: string): name is EventName {
  return EVENT_NAME_PATTERN.test(name);
}

export function assertValidEventName(name: string): asserts name is EventName {
  if (!isValidEventName(name)) {
    throw new Error(
      `Invalid event name "${name}". Must match module.entity.action`,
    );
  }
}
