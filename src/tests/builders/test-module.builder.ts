import type { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import type { ModuleMetadata } from '@nestjs/common/interfaces';
import { Test } from '@nestjs/testing';

export interface ProviderOverride<T = unknown> {
  readonly token: string | symbol | (new (...args: never[]) => T);
  readonly useValue: T;
}

export interface TestModuleOptions extends Pick<
  ModuleMetadata,
  'imports' | 'providers' | 'controllers'
> {
  readonly overrides?: readonly ProviderOverride[];
}

export interface TestHarness {
  readonly module: TestingModule;
  readonly app: INestApplication;
  get<T>(token: string | symbol | (new (...args: never[]) => T)): T;
  close(): Promise<void>;
}

export async function createTestHarness(
  options: TestModuleOptions,
): Promise<TestHarness> {
  let builder = Test.createTestingModule({
    imports: options.imports ?? [],
    providers: options.providers ?? [],
    controllers: options.controllers ?? [],
  });

  for (const override of options.overrides ?? []) {
    builder = builder
      .overrideProvider(override.token)
      .useValue(override.useValue);
  }

  const module = await builder.compile();
  const app = module.createNestApplication();
  await app.init();

  return {
    module,
    app,
    get<T>(token: string | symbol | (new (...args: never[]) => T)): T {
      return module.get<T>(token);
    },
    async close(): Promise<void> {
      await app.close();
    },
  };
}
