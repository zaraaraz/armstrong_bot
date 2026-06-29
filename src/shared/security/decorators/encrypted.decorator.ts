import 'reflect-metadata';

export const ENCRYPTED_FIELDS_KEY = 'ghost:security:encrypted-fields';

/**
 * Marks a class property as an encrypted-at-rest field. A Prisma client
 * extension (or repository helper) reads {@link getEncryptedFields} to encrypt
 * on write and decrypt on read via the EncryptionService.
 *
 * @example
 *   class FiveMServer { @Encrypted() rconPassword!: string; }
 */
export function Encrypted(): PropertyDecorator {
  return (target, propertyKey) => {
    const ctor = target.constructor;
    const existing =
      (Reflect.getMetadata(ENCRYPTED_FIELDS_KEY, ctor) as string[]) ?? [];
    if (!existing.includes(propertyKey.toString())) {
      existing.push(propertyKey.toString());
    }
    Reflect.defineMetadata(ENCRYPTED_FIELDS_KEY, existing, ctor);
  };
}

/** Returns the property names on `target`'s class marked with {@link Encrypted}. */
export function getEncryptedFields(target: object): readonly string[] {
  return (
    (Reflect.getMetadata(
      ENCRYPTED_FIELDS_KEY,
      target.constructor,
    ) as string[]) ?? []
  );
}
