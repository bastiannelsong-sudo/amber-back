import { HttpService } from '@nestjs/axios';
import { Injectable, HttpException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';

@Injectable()
export class MercadoLibreAuthService {
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;
  private authUrl: string;
  private tokenUrl: string;

  constructor(private configService: ConfigService, private httpService: HttpService) {
    this.clientId = this.configService.get<string>('CLIENT_ID');
    this.clientSecret = this.configService.get<string>('CLIENT_SECRET');
    this.redirectUri = this.configService.get<string>('REDIRECT_URI');
    this.authUrl = this.configService.get<string>('MERCADO_LIBRE_AUTH_URL');
    this.tokenUrl = this.configService.get<string>('MERCADO_LIBRE_TOKEN_URL');
  }

  private readonly logger = new Logger(MercadoLibreAuthService.name);
  getAuthUrl(): string {
    return `${this.authUrl}?response_type=code&client_id=${this.clientId}&redirect_uri=${this.redirectUri}`;
  }

  async exchangeCodeForToken(code: string): Promise<any> {
    try {
      const response = await lastValueFrom(
        this.httpService.post(
          this.tokenUrl,
          {
            grant_type: 'authorization_code',
            client_id: this.clientId,
            client_secret: this.clientSecret,
            code,
            redirect_uri: this.redirectUri,
          },
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
        ),
      );
      return response.data;
    } catch (error) {
      throw new HttpException('Error exchanging code for token', 500);
    }
  }

  async getUserInfo(token: string): Promise<any> {
    try {
      const response = await lastValueFrom(
        this.httpService.get('https://api.mercadolibre.com/users/me', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }),
      );
      return response.data;
    } catch (error) {
      throw new Error('Error al obtener información del usuario');
    }
  }

  handleNotification(eventData: any): void {
    // Loguear el evento recibido
    this.logger.log('Evento recibido:', JSON.stringify(eventData, null, 2));

    // Extraer información importante del evento
    const { action, resource } = eventData;
    if (action === 'payment' && resource.status === 'approved') {
      resource.order_items.forEach((item: any) => {
        const itemId = item.item_id;
        const quantity = item.quantity;
        
        // Lógica para descontar el stock
        
      });
    }
  }
}
