import { describe, it, expect } from 'vitest';
import { TestRunRepository } from './infrastructure/test-run.repository';
import { TestRunsController } from './api/test-runs.controller';
import { TestingModule } from './testing.module';

describe('TestingModule public API contract', () => {
  it('exports TestRunRepository', () => {
    const exports: unknown[] = (Reflect.getMetadata('exports', TestingModule) ??
      []) as unknown[];
    expect(exports).toContain(TestRunRepository);
  });

  it('TestRunRepository exposes list, findById, softDelete', () => {
    expect(typeof TestRunRepository.prototype.list).toBe('function');
    expect(typeof TestRunRepository.prototype.findById).toBe('function');
    expect(typeof TestRunRepository.prototype.softDelete).toBe('function');
  });

  it('TestRunsController does not import PrismaClient directly', () => {
    const source = TestRunsController.toString();
    expect(source).not.toContain('PrismaClient');
    expect(source).not.toContain('prisma.$');
  });
});
