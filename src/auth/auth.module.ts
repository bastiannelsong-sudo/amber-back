import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { CookieAuthGuard } from './bearer.strategy';
import { AuthController } from './auth.controller';

@Module({
  imports: [PassportModule],
  providers: [AuthService, CookieAuthGuard],
  controllers: [AuthController],
})
export class AuthModule {}
