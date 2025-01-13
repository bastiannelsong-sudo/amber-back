import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('login')
  redirectToMercadoLibre(@Res() res: Response) {
    const authUrl = this.authService.getAuthUrl();
    return res.redirect(authUrl);
  }

  @Get('callback')
  async handleCallback(@Query('code') code: string, @Res() res: Response) {
    try {
      // Intercambiar el código por un token de acceso
      const tokenResponse = await this.authService.exchangeCodeForToken(code);

      // Enviar el token en la respuesta
      return res.json({
        access_token: tokenResponse.access_token,
      });
    } catch (error) {
      console.error('Error en el callback:', error.message);
      return res
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .send('Error al autenticar');
    }
  }




  @Post('exchange_code')
  async exchangeCode(@Body() body: { code: string }, @Res() res: Response) {
    const { code } = body;
    try {
      const tokenResponse = await this.authService.exchangeCodeForToken(code);

      res.cookie('access_token', tokenResponse.access_token, {
        httpOnly: true, // No accesible desde JavaScript
        secure: true, // Solo en HTTPS (desactívalo en desarrollo)
        sameSite: 'strict', // Evita envío en requests entre sitios
      });

      // Envía una respuesta de éxito sin el token en el body
      return res
        .status(HttpStatus.OK)
        .send({ message: 'Token almacenado en cookie' });
    } catch (error) {
      console.error('Error al intercambiar el código:', error.message);
      return res
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .send('Error al autenticar');
    }
  }

  @Get('protected-resource')
  @UseGuards(AuthGuard('bearer')) // Usar un guard que valide el token
  getProtectedResource(@Req() req) {
    return {
      message: 'Acceso autorizado a recurso protegido',
      user: req.user, // El usuario autenticado
    };
  }
}
