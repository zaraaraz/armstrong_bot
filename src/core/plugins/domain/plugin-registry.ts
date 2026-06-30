import { Injectable } from '@nestjs/common';
import type { Plugin } from '../contracts/plugin.interface';
import { PluginStatus } from '../contracts/plugin.enums';

export interface LoadedPluginEntry {
  readonly plugin: Plugin;
  status: PluginStatus;
  readonly enabledGuilds: Set<string>;
  readonly registeredCommandIds: string[];
  readonly disposers: Array<() => void>;
}

@Injectable()
export class PluginRegistry {
  private readonly entries = new Map<string, LoadedPluginEntry>();

  get(name: string): LoadedPluginEntry | undefined {
    return this.entries.get(name);
  }

  set(name: string, entry: LoadedPluginEntry): void {
    this.entries.set(name, entry);
  }

  remove(name: string): void {
    this.entries.delete(name);
  }

  all(): readonly LoadedPluginEntry[] {
    return [...this.entries.values()];
  }
}
