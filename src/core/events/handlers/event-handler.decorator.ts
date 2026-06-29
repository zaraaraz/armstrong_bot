import type { EventName } from '../registry/event-map';

export function OnEvent<K extends EventName>(
  name: K,
  options?: { readonly handlerId?: string; readonly durable?: boolean },
): MethodDecorator {
  return Reflect.metadata('ghost:on-event', { name, options });
}
