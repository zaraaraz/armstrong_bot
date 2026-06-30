import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { TestRunRepository } from './infrastructure/test-run.repository';
import { TestRunsController } from './api/test-runs.controller';

@Module({
  imports: [DatabaseModule],
  providers: [TestRunRepository],
  controllers: [TestRunsController],
  exports: [TestRunRepository],
})
export class TestingModule {}
