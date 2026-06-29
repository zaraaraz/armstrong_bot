import { Global, Module } from '@nestjs/common';
import { TranslationService } from './contracts/translation-service.contract';
import { TranslationServiceImpl } from './translation.service';
import { PrismaTranslationRepository } from './repository/prisma-translation.repository';
import { TranslationLoader } from './loader/translation-loader';
import { FileBundleSource } from './loader/file-bundle.source';
import { DbBundleSource } from './loader/db-bundle.source';
import { IcuFormatter } from './formatter/icu-formatter';
import { LocaleResolver } from './resolver/locale-resolver';
import { MissingKeyReporter } from './missing/missing-key.reporter';
import { TranslationsController } from './api/translations.controller';
import { TRANSLATION_REPOSITORY } from './tokens';

@Global()
@Module({
  controllers: [TranslationsController],
  providers: [
    { provide: TRANSLATION_REPOSITORY, useClass: PrismaTranslationRepository },
    { provide: TranslationService, useClass: TranslationServiceImpl },
    TranslationLoader,
    FileBundleSource,
    DbBundleSource,
    IcuFormatter,
    LocaleResolver,
    MissingKeyReporter,
  ],
  exports: [TranslationService],
})
export class I18nModule {}
