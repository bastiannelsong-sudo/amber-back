import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Habilitar CORS con credenciales
  app.enableCors({
    origin: 'http://localhost:5173', // URL del frontend
    credentials: true, // Permitir envío de cookies
  });

  await app.listen(3000);
  console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap();
