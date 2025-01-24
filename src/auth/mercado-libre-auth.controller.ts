import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param, ParseIntPipe,
  Post,
  Query,
  Redirect,
} from '@nestjs/common';
import { MercadoLibreAuthService } from './mercado-libre-auth.service';
import { Session } from './entities/session.entity';
import { SessionCacheService } from './session-cache.service';

@Controller('auth')
export class MercadoLibreAuthController {
  constructor(private readonly authService: MercadoLibreAuthService,
              private readonly sessionCacheService: SessionCacheService
  ) {}

  @Get('login')
  @Redirect()
  login() {
    const authUrl = this.authService.getAuthUrl();
    return { url: authUrl };
  }

  @Get('callback')
  @Redirect()
  async callback(@Query('code') code: string) {
    if (!code) {
      return { message: 'Authorization code not provided' };
    }

    const tokenData:Session = await this.authService.exchangeCodeForToken(code);

    const redirectUrl = `http://localhost:5173/callback?message=Successfully%20authenticated&userId=${tokenData.user_id}`

    return { url: redirectUrl };
  }

  @Get('user-info')
  async getUserInfo(@Query('userId',ParseIntPipe) userId: number)
  {
    return await this.authService.getUserInfo(userId);
  }

  @Delete(':userId')
  async deleteSession(@Param('userId',ParseIntPipe) userId: number): Promise<string> {
    try {
      this.sessionCacheService.deleteSession(userId);
      return `Sesión eliminada para el usuario con ID: ${userId}`;
    } catch (error) {
      throw new HttpException(
        `No se pudo eliminar la sesión para el usuario con ID: ${userId}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
  
}
