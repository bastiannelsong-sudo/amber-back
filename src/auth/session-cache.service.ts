import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Session } from './entities/session.entity';
import { HttpService } from '@nestjs/axios';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { lastValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';


@Injectable()
export class SessionCacheService {
  private clientId: string;
  private clientSecret: string;

  constructor(
    private readonly httpService: HttpService,
    private configService: ConfigService,
    @InjectRepository(Session) private readonly sessionRepository: Repository<Session>,
  ) {
    this.clientId = this.configService.get<string>('CLIENT_ID');
    this.clientSecret = this.configService.get<string>('CLIENT_SECRET');
  }

  public sessionCache = new Map<number, Session>();

  public saveSession(userId: number, sessionData: Session) {
    this.sessionCache.set(userId, sessionData);
  }

 public getSession(userId: number): Session | null {
    return this.sessionCache.get(userId) || null;
  }

  deleteSession(userId: number) {
    this.sessionCache.delete(userId);
  }

  isTokenExpired(session: Session): boolean {
    const expirationDate = new Date(session.created_at.getTime() + session.expires_in * 1000);
    const thirtyMinutesBeforeExpiration = new Date(expirationDate.getTime() - 30 * 60 * 1000);
    const currentTime = new Date();
    return currentTime > thirtyMinutesBeforeExpiration;
  }

  async validateAndRefreshToken(userId: number): Promise<void> {
    let session = this.getSession(userId);

    if (!session) {
      // Si la sesión no está en caché, intenta obtenerla de la base de datos
      session = await this.sessionRepository.findOne({ where: { user_id: userId } });
      if (!session) {
        throw new UnauthorizedException('No se encontró la sesión del usuario.');
      }

      // Guarda la sesión en caché después de obtenerla de la base de datos
      this.saveSession(+session.user_id, session);
    }

    // Verifica si el token ha expirado
    if (this.isTokenExpired(session)) {
      console.log(`El token de acceso ha expirado. Intentando refrescarlo para el usuario ${userId}...`);
      await this.refreshAccessToken(userId, session.refresh_token);
    }
  }

  private async refreshAccessToken(userId: number, refreshToken: string): Promise<void> {
    try {
      const response = await lastValueFrom(
        this.httpService.post('https://api.mercadolibre.com/oauth/token', {
          grant_type: 'refresh_token',
          client_id: this.clientId,
          client_secret: this.clientSecret,
          refresh_token: refreshToken,
        }),
      );

      const newAccessToken = response.data.access_token;
      const newRefreshToken = response.data.refresh_token;

      // Actualiza la sesión con los nuevos tokens
      await this.updateSession(userId, newAccessToken, newRefreshToken, response.data.expires_in);

      console.log(`Sesión actualizada para el usuario ${userId} con nuevos tokens.`);
    } catch (error) {
      console.error('Error al intentar refrescar el token:', error);
      throw new UnauthorizedException('No se pudo refrescar el token. Por favor, inicie sesión nuevamente.');
    }
  }

  private async updateSession(userId: number, newAccessToken: string, newRefreshToken: string, expiresIn: number): Promise<void> {
    const session = await this.sessionRepository.findOne({ where: { user_id: userId } });

    if (!session) {
      throw new UnauthorizedException('No se encontró la sesión del usuario.');
    }

    session.access_token = newAccessToken;
    session.refresh_token = newRefreshToken;
    session.created_at = new Date(); // Actualizar la fecha de creación con la fecha actual
    session.expires_in = expiresIn; // Actualizar la duración del token

    // Guarda la sesión actualizada en la base de datos y en el caché
    await this.sessionRepository.save(session);
    this.saveSession(userId, session); // Actualiza el caché también
  }
}
