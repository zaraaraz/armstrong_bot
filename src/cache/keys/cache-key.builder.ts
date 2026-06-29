import { Injectable } from '@nestjs/common';
import { CacheNamespace } from './cache-namespace.enum';

export interface ICacheKeyBuilder {
  forGuild(
    guildId: string,
    namespace: CacheNamespace,
    ...parts: readonly string[]
  ): string;
  forGlobal(namespace: CacheNamespace, ...parts: readonly string[]): string;
  guildNamespacePrefix(guildId: string, namespace: CacheNamespace): string;
}

@Injectable()
export class CacheKeyBuilder implements ICacheKeyBuilder {
  forGuild(
    guildId: string,
    namespace: CacheNamespace,
    ...parts: readonly string[]
  ): string {
    this.assertNonEmpty({ guildId, namespace });
    const suffix = parts.length > 0 ? `:${parts.join(':')}` : '';
    return `guild:${guildId}:${namespace}${suffix}`;
  }

  forGlobal(namespace: CacheNamespace, ...parts: readonly string[]): string {
    this.assertNonEmpty({ namespace });
    const suffix = parts.length > 0 ? `:${parts.join(':')}` : '';
    return `global:${namespace}${suffix}`;
  }

  guildNamespacePrefix(guildId: string, namespace: CacheNamespace): string {
    this.assertNonEmpty({ guildId, namespace });
    return `guild:${guildId}:${namespace}:`;
  }

  private assertNonEmpty(values: Record<string, string>): void {
    for (const [name, value] of Object.entries(values)) {
      if (!value || value.trim() === '') {
        throw new Error(`CacheKeyBuilder: "${name}" must not be empty`);
      }
    }
  }
}
