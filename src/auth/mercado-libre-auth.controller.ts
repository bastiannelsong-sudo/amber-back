import { Body, Controller, Get, Post, Query, Redirect, Res } from '@nestjs/common';
import { MercadoLibreAuthService } from './mercado-libre-auth.service';
import { Response } from 'express';
import { NotificationService } from 'src/notification/notification.service';

@Controller('auth')
export class MercadoLibreAuthController {
  constructor(private readonly authService: MercadoLibreAuthService,
    private readonly notificacionService: NotificationService
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

  @Post('notifications')
  async handleNotification(@Body() eventData: any, @Res() res: Response): Promise<any> {
    try {
    // Llamar al servicio para manejar la notificación
    this.notificacionService.handleNotification(eventData);
  
   // Responder con éxito y código de estado 200
   return res.status(200).json({ message: 'Evento recibido con éxito' });
} catch (error) {
  console.error('Error al manejar la notificación:', error);
  return res.status(500).json({ message: 'Error al manejar la notificación' });
}
  }
}
