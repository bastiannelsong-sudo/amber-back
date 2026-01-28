import { HttpService } from '@nestjs/axios';
import { HttpException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import { Session } from './entities/session.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SessionCacheService } from './session-cache.service';

@Injectable()
export class MercadoLibreAuthService {
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;
  private authUrl: string;
  private tokenUrl: string;

  constructor(
    private configService: ConfigService,
    private httpService: HttpService,
    @InjectRepository(Session)
    private sessionRepository: Repository<Session>,
    private readonly sessionCacheService: SessionCacheService
  ) {
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
      const params = new URLSearchParams();
      params.append('grant_type', 'authorization_code');
      params.append('client_id', this.clientId);
      params.append('client_secret', this.clientSecret);
      params.append('code', code);
      params.append('redirect_uri', this.redirectUri);

      this.logger.log(`Exchanging code for token with redirect_uri: ${this.redirectUri}`);

      const response = await lastValueFrom(
        this.httpService.post(
          this.tokenUrl,
          params.toString(),
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
        ),
      );

      await this.saveToken(response.data);

      return response.data;
    } catch (error) {
      this.logger.error('Error exchanging code for token:', error.response?.data || error.message);
      throw new HttpException(
        error.response?.data?.message || 'Error exchanging code for token',
        error.response?.status || 500,
      );
    }
  }

  async saveToken(tokenData: any): Promise<Session> {

    let session:Session = await this.sessionRepository.findOne({ where: { user_id: tokenData.user_id } });

    if (session) {
      // Si la sesión ya existe, actualizar los campos relevantes
      session.access_token = tokenData.access_token;
      session.expires_in = tokenData.expires_in;
      session.refresh_token = tokenData.refresh_token;
      session.scope = tokenData.scope;
      session.token_type = tokenData.token_type;
      session.created_at = new Date();


      await this.sessionRepository.save(session);
      this.sessionCacheService.saveSession(session.user_id, session);

      return session;
    } else {

      session = this.sessionRepository.create({
        access_token: tokenData.access_token,
        expires_in: tokenData.expires_in,
        refresh_token: tokenData.refresh_token,
        scope: tokenData.scope,
        token_type: tokenData.token_type,
        user_id: tokenData.user_id,
      });


      this.sessionCacheService.saveSession(session.user_id, session); // Guarda en caché
      return this.sessionRepository.save(session);
    }
  }

  async getUserInfo(userId: number): Promise<any> {
    try {

      await this.sessionCacheService.validateAndRefreshToken(userId);

      const response = await lastValueFrom(
        this.httpService.get('https://api.mercadolibre.com/users/me', {
          headers: {
            Authorization: `Bearer ${this.sessionCacheService.getSession(userId).access_token}`,
          },
        }),
      );

      return response.data;
    } catch (error) {

      console.error('Error al obtener la información del usuario:', error);
      throw new UnauthorizedException('No se pudo obtener la sesión. Por favor, inicie sesión nuevamente.');
    }
  }

}
