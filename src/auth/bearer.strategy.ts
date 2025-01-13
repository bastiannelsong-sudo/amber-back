import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';

@Injectable()
export class CookieAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = request.cookies['access_token']; // Leer el token de las cookies

    if (!token) {
      throw new UnauthorizedException('No se encontró el token en las cookies');
    }

    try {
      const user = await this.authService.validateToken(token); // Validar el token
      if (!user) {
        throw new UnauthorizedException('Token inválido o expirado');
      }

      request.user = user; // Adjuntar el usuario validado al request
      return true;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      throw new UnauthorizedException('Error al validar el token');
    }
  }
}
