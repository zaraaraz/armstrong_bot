import type { SlashCommandBuilder } from 'discord.js';
import type { ZodTypeAny, infer as ZInfer } from 'zod';

export interface PluginCommandHandler {
  (
    interaction: import('discord.js').ChatInputCommandInteraction,
  ): Promise<void>;
}

export interface PluginCommandRegistration {
  readonly builder: SlashCommandBuilder;
  readonly requires?: string;
  readonly handler: PluginCommandHandler;
}

export interface ScopedCache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
}

export interface ScopedLogger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface PluginApi {
  registerCommand(reg: PluginCommandRegistration): void;
  on<TPayload>(
    event: string,
    handler: (payload: TPayload) => Promise<void> | void,
  ): void;
  emit<TPayload>(event: string, payload: TPayload): Promise<void>;
  getService<T>(token: string): T;
  readonly cache: ScopedCache;
  readonly logger: ScopedLogger;
  t(key: string, vars?: Record<string, string | number>): string;
  can(memberId: string, claim: string): Promise<boolean>;
  config<S extends ZodTypeAny>(schema: S): ZInfer<S>;
}
