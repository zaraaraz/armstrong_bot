import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger';

/**
 * Builds the OpenAPI 3.x document for the API surface. Declares the three auth
 * schemes (session cookie, bearer JWT, `x-api-key`) and the uniform error
 * responses. The document is also used to generate the dashboard's typed client.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Ghost Bot API')
    .setDescription(
      'Versioned REST + realtime + webhook surface for Ghost Bot. ' +
        'Every success is a SuccessEnvelope/PaginatedEnvelope; every error is an ErrorEnvelope.',
    )
    .setVersion('v1')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'jwt',
    )
    .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'api-key')
    .addCookieAuth('gb_session', { type: 'apiKey', in: 'cookie' }, 'session')
    .addTag('auth')
    .addTag('api-keys')
    .addTag('webhooks')
    .addTag('health')
    .build();

  return SwaggerModule.createDocument(app, config);
}

/** Mounts Swagger UI + the raw JSON document. */
export function setupSwagger(
  app: INestApplication,
  document: OpenAPIObject,
  path = 'api/docs',
): void {
  SwaggerModule.setup(path, app, document, {
    jsonDocumentUrl: `${path}/json`,
  });
}
