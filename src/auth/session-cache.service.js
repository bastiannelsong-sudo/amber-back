import { Injectable, UnauthorizedException } from '@nestjs/common';
import { lastValueFrom } from 'rxjs';
@Injectable()
export class SessionCacheService {
    httpService;
    configService;
    sessionRepository;
    clientId;
    clientSecret;
    constructor(httpService, configService, 
    @InjectRepository(Session)
    sessionRepository) {
        this.httpService = httpService;
        this.configService = configService;
        this.sessionRepository = sessionRepository;
        this.clientId = this.configService.get('CLIENT_ID');
        this.clientSecret = this.configService.get('CLIENT_SECRET');
    }
    sessionCache = new Map();
    saveSession(userId, sessionData) {
        this.sessionCache.set(userId, sessionData);
    }
    getSession(userId) {
        return this.sessionCache.get(userId) || null;
    }
    deleteSession(userId) {
        this.sessionCache.delete(userId);
    }
    isTokenExpired(session) {
        const expirationDate = new Date(session.created_at.getTime() + session.expires_in * 1000);
        const thirtyMinutesBeforeExpiration = new Date(expirationDate.getTime() - 30 * 60 * 1000);
        const currentTime = new Date();
        return currentTime > thirtyMinutesBeforeExpiration;
    }
    async validateAndRefreshToken(userId) {
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
    async refreshAccessToken(userId, refreshToken) {
        try {
            const response = await lastValueFrom(this.httpService.post('https://api.mercadolibre.com/oauth/token', {
                grant_type: 'refresh_token',
                client_id: this.clientId,
                client_secret: this.clientSecret,
                refresh_token: refreshToken,
            }));
            const newAccessToken = response.data.access_token;
            const newRefreshToken = response.data.refresh_token;
            // Actualiza la sesión con los nuevos tokens
            await this.updateSession(userId, newAccessToken, newRefreshToken, response.data.expires_in);
            console.log(`Sesión actualizada para el usuario ${userId} con nuevos tokens.`);
        }
        catch (error) {
            console.error('Error al intentar refrescar el token:', error);
            throw new UnauthorizedException('No se pudo refrescar el token. Por favor, inicie sesión nuevamente.');
        }
    }
    async updateSession(userId, newAccessToken, newRefreshToken, expiresIn) {
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
