import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from './entities/notification.entity';
import { HttpService } from '@nestjs/axios';
import { AxiosResponse } from 'axios';
import { Session } from 'src/auth/entities/session.entity';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class NotificationService {
  private clientId: string;
  private clientSecret: string;
  private apiUrl: string;

  private refreshAttemptCount: number = 0;

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    
    @InjectRepository(Session)
    private readonly sessionRepository: Repository<Session>,
    
    private readonly httpService: HttpService,
    private configService: ConfigService,
  ) {
    this.clientId = this.configService.get<string>('CLIENT_ID');
    this.clientSecret = this.configService.get<string>('CLIENT_SECRET');
    this.apiUrl = this.configService.get<string>('MERCADO_LIBRE_API_URL');
  
    if (!this.clientId || !this.clientSecret || !this.apiUrl) {
      throw new Error('Faltan las variables de configuración necesarias (CLIENT_ID, CLIENT_SECRET)');
    }

    console.log('CLIENT_ID:', this.clientId);
    console.log('CLIENT_SECRET:', this.clientSecret);
  }

  async saveNotification(data: Partial<Notification>): Promise<Notification> {
    const notification = this.notificationRepository.create(data);
    return this.notificationRepository.save(notification);
  }

  async findAll(): Promise<Notification[]> {
    return this.notificationRepository.find();
  }

  async handleNotification(eventData: any): Promise<void> {
    console.log('Evento recibido:', eventData);
    
    const { topic, resource, user_id, application_id, sent, attempts, received, actions } = eventData;
    
    const notification = this.notificationRepository.create({
      topic,
      resource,
      user_id,
      application_id,
      sent: new Date(sent),
      attempts,
      received: new Date(received),
      actions,
    });

    await this.notificationRepository.save(notification);

    const orderDetails = await this.getOrderDetails(notification);
    console.log('Detalles de la orden:', orderDetails);
  }

  private async getOrderDetails(notification: Notification): Promise<any> {
    let session: Session | null = null;
    try {
      session = await this.sessionRepository.findOne({ where: { user_id: notification.user_id } });

      if (!session) {
        console.log('No se encontró sesión activa para el usuario:', notification.user_id);
        // No se lanza un error, solo se loguea el problema y retornamos un valor por defecto
        return { error: 'No se encontró sesión activa' }; // Aquí puedes devolver lo que consideres necesario
      }

      const accessToken = session.access_token;
      console.log('Intentando acceder con el token:', accessToken);

      const response: AxiosResponse = await firstValueFrom(
        this.httpService.get(`${this.apiUrl}${notification.resource}`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }),
      );

      return response.data;
    } catch (error) {
      if (error.response?.status === 401) {
        console.log('401: El token ha expirado. Intentando hacer refresh...');
        
        if (this.refreshAttemptCount >= 1) {
          console.log('Se ha intentado refrescar el token anteriormente, pero falló. No se intentará más.');
          throw new Error('No se pudo refrescar el token tras múltiples intentos.');
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
          });

          this.refreshAttemptCount = 0;

          return this.getOrderDetails(notification);
        } catch (refreshError) {
          console.log('No se pudo refrescar el token:', refreshError.message);
          throw new Error('No se pudo refrescar el token.');
        }
      } else {
        console.log('Error en la solicitud:', error.message);
        throw error;
      }
    }
  }

  private async refreshAccessToken(refreshToken: string): Promise<any> {
    try {
      console.log('Realizando solicitud para refrescar el token...');
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
      console.log('Error al obtener nuevo access_token:', error.message);
      throw new Error('Error al obtener nuevo access_token: ' + error.message);
    }
  }
}
