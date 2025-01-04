import { Controller, Get, Query, Res } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Response } from 'express';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('login')
  redirectToMercadoLibre(@Res() res: Response) {
    const authUrl = this.authService.getAuthUrl();
    return res.redirect(authUrl);
  }

  @Get('callback')
  async handleCallback(@Query('code') code: string) {
    if (!code) {
      throw new Error('Authorization code not found');
    }

    const tokenResponse = await this.authService.exchangeCodeForToken(code);
    return tokenResponse;
  }
}
