import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, BadRequestException } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Habilitar validación global
  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    exceptionFactory: (errors) => {
      const messages: string[] = [];
      const extract = (errs: any[], parent = '') => {
        for (const e of errs) {
          const path = parent ? `${parent}.${e.property}` : e.property;
          if (e.constraints) {
            for (const msg of Object.values(e.constraints)) {
              messages.push(`[${path}] ${msg}`);
            }
          }
          if (e.children?.length) extract(e.children, path);
        }
      };
      extract(errors);
      console.error('Validation errors:', messages);
      return new BadRequestException(messages);
    },
  }));

  // Habilitar CORS con credenciales
  const allowedOrigins = [
    'http://localhost:5173',
    process.env.FRONTEND_URL,
  ].filter(Boolean);

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  });

  await app.listen(3000);
  console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap();
