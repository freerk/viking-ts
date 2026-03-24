import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import basicAuth from 'express-basic-auth';
import { AppModule } from './app.module';
import { ApiKeyGuard } from './shared/api-key.guard';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  const corsOrigins = config.get<string[]>('server.corsOrigins', ['*']);
  app.enableCors({ origin: corsOrigins });

  const rootApiKey = config.get<string>('server.rootApiKey', '');
  if (rootApiKey) {
    app.useGlobalGuards(new ApiKeyGuard(config));
    logger.log('API key authentication enabled');
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const isSwaggerEnabled = process.env['SWAGGER_ENABLED'] === 'true';
  const swaggerUser = process.env['SWAGGER_USER'];
  const swaggerPassword = process.env['SWAGGER_PASSWORD'];
  const isProduction = process.env['NODE_ENV'] === 'production';

  let swaggerActive = false;

  if (isSwaggerEnabled) {
    if (isProduction) {
      if (swaggerUser && swaggerPassword) {
        app.use(
          ['/openapi', '/openapi-json'],
          basicAuth({
            challenge: true,
            users: { [swaggerUser]: swaggerPassword },
          }),
        );
        swaggerActive = true;
        logger.log('Swagger enabled with basic auth protection');
      } else {
        logger.warn(
          'Swagger disabled in production (missing SWAGGER_USER/SWAGGER_PASSWORD)',
        );
      }
    } else {
      swaggerActive = true;
    }
  }

  if (swaggerActive) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('viking-ts')
      .setDescription('TypeScript-native context database for AI agents')
      .setVersion('0.1.0')
      .addApiKey(
        { type: 'apiKey', name: 'X-API-Key', in: 'header' },
        'api-key',
      )
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('openapi', app, document);

    logger.log(
      `Swagger docs available at http://${process.env['HOST'] ?? '127.0.0.1'}:${process.env['PORT'] ?? 1934}/openapi`,
    );
  }

  const port = process.env['PORT'] ?? 1934;
  const host = process.env['HOST'] ?? '127.0.0.1';

  await app.listen(port, host);
  logger.log(`viking-ts server listening on http://${host}:${port}`);
}

void bootstrap();
