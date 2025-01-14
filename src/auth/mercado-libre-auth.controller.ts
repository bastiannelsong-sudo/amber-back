import { Controller, Get, Post, Query, Redirect } from '@nestjs/common';
import { MercadoLibreAuthService } from './mercado-libre-auth.service';

@Controller('auth')
export class MercadoLibreAuthController {
  constructor(private readonly authService: MercadoLibreAuthService
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

    const tokenData = await this.authService.exchangeCodeForToken(code);
    console.log(tokenData);

    // Redirigir al frontend con el mensaje y el tokenData en los parámetros de la URL
    const redirectUrl = `http://localhost:5173/callback?message=Successfully%20authenticated&tokenData=${encodeURIComponent(
      JSON.stringify(tokenData),
    )}`;

    // Realizar la redirección
    return { url: redirectUrl };
  }

  @Get('user-info')
  async getUserInfo(@Query('token') token: string) {
    return await this.authService.getUserInfo(token);
  }
  
}
