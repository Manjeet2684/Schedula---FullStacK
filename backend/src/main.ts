import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Global API prefix
  app.setGlobalPrefix('api/v1');

  // CORS — only allow origins listed in CORS_ORIGINS; no wildcard fallback
  const corsOrigins = process.env['CORS_ORIGINS'];
  if (!corsOrigins) {
    throw new Error('CORS_ORIGINS environment variable is required');
  }
  const allowedOrigins = corsOrigins.split(',').map((o) => o.trim());
  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  // Graceful shutdown
  app.enableShutdownHooks();

  const port = parseInt(process.env['PORT'] ?? '4000', 10);
  await app.listen(port);
  console.log(`Schedula API listening on http://localhost:${port}/api/v1`);
}

bootstrap();
