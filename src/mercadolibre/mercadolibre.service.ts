import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { InjectRepository } from '@nestjs/typeorm';
import { Session } from '../auth/entities/session.entity';
import { Repository } from 'typeorm';

@Injectable()
export class MercadoLibreService {
  private readonly BASE_URL = 'https://api.mercadolibre.com/orders/search';
  private refreshAttemptCount: number = 0;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly apiUrl: string;

  constructor(
    @InjectRepository(Session)
    private readonly sessionRepository: Repository<Session>,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService
  ) {
    this.clientId = this.configService.get<string>('CLIENT_ID');
    this.clientSecret = this.configService.get<string>('CLIENT_SECRET');
    this.apiUrl = this.configService.get<string>('MERCADO_LIBRE_API_URL');
  }

  async getOrdersByDate(date: string, sellerId: number): Promise<any[]> {
    let session: Session | null = null;
    try {
      // Buscar la sesión del usuario
      session = await this.sessionRepository.findOne({
        where: { user_id: sellerId }, // Asumiendo que sellerId es el user_id
      });

      if (!session) {
        console.log('No se encontró sesión activa para el usuario:', sellerId);
        throw new Error('No se encontró sesión activa');
      }

      const accessToken = session.access_token;
      console.log('Intentando acceder con el token:', accessToken);

      const fromDate = `${date}T00:00:00.000-04:00`;
      const toDate = `${date}T23:59:59.999-04:00`;
      const url = `${this.BASE_URL}?seller=${sellerId}&order.date_created.from=${fromDate}&order.date_created.to=${toDate}`;

      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        })
      );

      return response.data;
    } catch (error) {
      if (error.response?.status === 401) {
        console.log('401: El token ha expirado. Intentando hacer refresh...');
        return this.handleTokenRefreshForOrders(session, date, sellerId);
      } else {
        console.error('Error en la solicitud:', error.message);
        throw new Error('No se pudieron obtener las órdenes');
      }
    }
  }

  private async handleTokenRefreshForOrders(
    session: Session,
    date: string,
    sellerId: number
  ): Promise<any[]> {
    if (this.refreshAttemptCount >= 1) {
      console.log('Se ha intentado refrescar el token anteriormente. No se intentará más.');
      throw new Error('Máximo de intentos de refresco alcanzado');
    }

    const refreshToken = session.refresh_token;
    try {
      this.refreshAttemptCount++;

      console.log('Intentando refrescar el token...');
      const newTokens = await this.refreshAccessToken(refreshToken);

      await this.sessionRepository.update(session.id, {
        access_token: newTokens.access_token,
        expires_in: newTokens.expires_in,
        refresh_token: newTokens.refresh_token,
        updated_at: new Date(), // Establecer manualmente la fecha de actualización
      });

      this.refreshAttemptCount = 0;
      return this.getOrdersByDate(date, sellerId); // Intentar nuevamente con el nuevo token
    } catch (refreshError) {
      console.error('No se pudo refrescar el token:', refreshError.message);
      throw new Error('Error al refrescar el token');
    }
  }

  private async refreshAccessToken(refreshToken: string): Promise<any> {
    try {
      console.log('Realizando solicitud para refrescar el token...' + refreshToken);
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.apiUrl}/oauth/token`,
          new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: this.clientId,
            client_secret: this.clientSecret,
            refresh_token: refreshToken,
          }).toString(),
        ),
      );

      return response.data;
    } catch (error) {
      console.error('Error al obtener nuevo access_token:', error.message);
      throw error;
    }
  }
}
