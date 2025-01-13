import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class AuthService {
  constructor(private readonly configService: ConfigService) {}

  getAuthUrl(): string {
    const appId = this.configService.get<string>('APP_ID');
    const redirectUri = this.configService.get<string>('REDIRECT_URI');
    const scopes = 'read write offline_access'; // Ajusta según sea necesario
    return `https://auth.mercadolibre.cl/authorization?response_type=code&client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}`;
  }

  async exchangeCodeForToken(code: string): Promise<any> {
    const clientId = this.configService.get<string>('APP_ID');
    const clientSecret = this.configService.get<string>('CLIENT_SECRET');
    const redirectUri = this.configService.get<string>('REDIRECT_URI');

    try {
      const response = await axios.post(
        'https://api.mercadolibre.com/oauth/token',
        new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );

      return response.data; // Asegúrate de que esto devuelva el access_token
    } catch (error) {
      throw new Error('Error al obtener el token: ' + error.message);
    }
  }

  async validateToken(token: string): Promise<any> {
    try {
      const response = await axios.get(
        'https://api.mercadolibre.com/users/me',
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      return response.data; // Devuelve los datos del usuario si el token es válido
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      return null; // Si el token es inválido, devuelve null
    }
  }
}
