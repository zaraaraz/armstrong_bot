import { Global, Module } from '@nestjs/common';
import { EncryptionService } from './services/encryption.service';
import { SecretService } from './services/secret.service';
import { RateLimitService } from './services/rate-limit.service';
import { CooldownService } from './services/cooldown.service';
import { SanitizerService } from './services/sanitizer.service';
import { ApiKeyService } from './services/api-key.service';
import { SecurityConfigService } from './services/security-config.service';
import { EnvSecretProvider } from './vault/env-secret.provider';
import { SECRET_PROVIDER } from './interfaces/security.interfaces';
import { ApiKeyRepository } from './repositories/api-key.repository';
import { PrismaApiKeyRepository } from './repositories/api-key.prisma.repository';
import { RateLimitGuard } from './guards/rate-limit.guard';
import { ApiKeyGuard } from './guards/api-key.guard';
import { SanitizationInterceptor } from './interceptors/sanitization.interceptor';
import { AuditInterceptor } from './interceptors/audit.interceptor';
import { ApiKeyController } from './api/api-key.controller';
import { SecurityConfigController } from './api/security-config.controller';

/**
 * Cross-cutting security layer (`@shared/security`). Modules consume these
 * guards, interceptors and services — they never re-implement rate limiting,
 * encryption or validation. Global so the guards/services are injectable
 * anywhere without re-importing.
 */
@Global()
@Module({
  controllers: [ApiKeyController, SecurityConfigController],
  providers: [
    EncryptionService,
    SecretService,
    RateLimitService,
    CooldownService,
    SanitizerService,
    ApiKeyService,
    SecurityConfigService,
    { provide: SECRET_PROVIDER, useClass: EnvSecretProvider },
    { provide: ApiKeyRepository, useClass: PrismaApiKeyRepository },
    RateLimitGuard,
    ApiKeyGuard,
    SanitizationInterceptor,
    AuditInterceptor,
  ],
  exports: [
    EncryptionService,
    SecretService,
    RateLimitService,
    CooldownService,
    SanitizerService,
    ApiKeyService,
    SecurityConfigService,
    RateLimitGuard,
    ApiKeyGuard,
    SanitizationInterceptor,
    AuditInterceptor,
  ],
})
export class SecurityModule {}
