import { Controller, Delete, Get, HttpException, HttpStatus, Redirect, } from '@nestjs/common';
@Controller('auth')
export class MercadoLibreAuthController {
    authService;
    sessionCacheService;
    constructor(authService, sessionCacheService) {
        this.authService = authService;
        this.sessionCacheService = sessionCacheService;
    }
    @Get('login')
    @Redirect()
    login() {
        const authUrl = this.authService.getAuthUrl();
        return { url: authUrl };
    }
    @Get('callback')
    @Redirect()
    async callback(
    @Query('code')
    code) {
        if (!code) {
            return { message: 'Authorization code not provided' };
        }
        const tokenData = await this.authService.exchangeCodeForToken(code);
        const redirectUrl = `http://localhost:5173/callback?message=Successfully%20authenticated&userId=${tokenData.user_id}`;
        return { url: redirectUrl };
    }
    @Get('user-info')
    async getUserInfo(
    @Query('userId', ParseIntPipe)
    userId) {
        return await this.authService.getUserInfo(userId);
    }
    @Delete(':userId')
    async deleteSession(
    @Param('userId', ParseIntPipe)
    userId) {
        try {
            this.sessionCacheService.deleteSession(userId);
            return `Sesión eliminada para el usuario con ID: ${userId}`;
        }
        catch (error) {
            throw new HttpException(`No se pudo eliminar la sesión para el usuario con ID: ${userId}`, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
