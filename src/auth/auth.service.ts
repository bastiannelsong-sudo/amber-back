import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class AuthService {
  constructor(private readonly configService: ConfigService) {}

  getAuthUrl(): string {
    const appId = this.configService.get<string>('APP_ID');
    const redirectUri = this.configService.get<string>('REDIRECT_URI');
    const scopes = 'read write offline'; // Ajusta según sea necesario
    return `https://auth.mercadolibre.cl/authorization?response_type=code&client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}`;
  }

  async exchangeCodeForToken(code: string): Promise<any> {
    const clientId = this.configService.get<string>('APP_ID');
    const clientSecret = this.configService.get<string>('CLIENT_SECRET');
    const redirectUri = this.configService.get<string>('REDIRECT_URI');


    try {
      const response = await axios.post(
        'https://api.mercadolibre.com/oauth/token',
        null,
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          params: {
            grant_type: 'authorization_code',
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
          },
        },
      );

      return response.data;
    } catch (error) {
      console.error('Error al intercambiar el código por un token:');
      if (axios.isAxiosError(error)) {
        console.error('Status:', error.response?.status);
        console.error('Headers:', error.response?.headers);
        console.error('Data:', error.response?.data);
      }
      throw new HttpException(
        {
          status: error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
          message: error.response?.data || 'Error desconocido',
        },
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
