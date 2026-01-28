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

  /**
   * Get the previous calendar date string (YYYY-MM-DD) given a date string.
   */
  private getPreviousDate(dateStr: string): string {
    const d = new Date(`${dateStr}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
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

      // ML API internally uses -04:00 for Chile regardless of DST.
      // During Chilean summer (-03:00), orders between 00:00-00:59 Chilean time
      // are 23:00-23:59 in ML's -04:00 timezone (previous ML day).
      // To capture these, extend the sync range 1 hour backward into the previous day.
      // Duplicates are handled by upsert in the sync process.
      const prevDate = this.getPreviousDate(date);
      const fromDate = `${prevDate}T23:00:00.000-04:00`;
      const toDate = `${date}T23:59:59.999-04:00`;

      // Fetch ALL orders using pagination (no status filter = all statuses)
      const allOrders: any[] = [];
      let offset = 0;
      const limit = 50; // ML API max per page
      let totalOrders = 0;

      do {
        const url = `${this.BASE_URL}?seller=${sellerId}&order.date_created.from=${fromDate}&order.date_created.to=${toDate}&offset=${offset}&limit=${limit}`;
        console.log(`[MercadoLibreService] Fetching ALL orders page: offset=${offset}, limit=${limit}`);

        const response = await firstValueFrom(
          this.httpService.get(url, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          })
        );

        const data = response.data;
        totalOrders = data.paging?.total || 0;
        const results = data.results || [];

        allOrders.push(...results);
        console.log(`[MercadoLibreService] Fetched ${results.length} orders (total so far: ${allOrders.length}/${totalOrders})`);

        offset += limit;
      } while (offset < totalOrders);

      console.log(`[MercadoLibreService] Total orders fetched for ${date}: ${allOrders.length}`);

      // Return in the same format as before, but with all orders
      return {
        paging: { total: allOrders.length, offset: 0, limit: allOrders.length },
        results: allOrders,
      } as any;
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

  /**
   * Get orders that were UPDATED (not created) in a date range
   * This catches status changes like cancellations, returns, etc.
   * Uses order.date_last_updated instead of order.date_created
   */
  async getOrdersUpdatedInRange(fromDate: string, toDate: string, sellerId: number): Promise<any[]> {
    try {
      const session = await this.sessionRepository.findOne({
        where: { user_id: sellerId },
      });

      if (!session) {
        console.log('No se encontró sesión activa para el usuario:', sellerId);
        throw new Error('No se encontró sesión activa');
      }

      const accessToken = session.access_token;

      // ML API uses -04:00 for Chile internally. Extend range 1 hour backward
      // to capture orders in Chilean midnight DST gap (same logic as getOrdersByDate).
      const prevFromDate = this.getPreviousDate(fromDate);
      const fromDateISO = `${prevFromDate}T23:00:00.000-04:00`;
      const toDateISO = `${toDate}T23:59:59.999-04:00`;

      const allOrders: any[] = [];
      let offset = 0;
      const limit = 50;
      let totalOrders = 0;

      do {
        // Use date_last_updated instead of date_created to catch status changes (no status filter = all)
        const url = `${this.BASE_URL}?seller=${sellerId}&order.date_last_updated.from=${fromDateISO}&order.date_last_updated.to=${toDateISO}&offset=${offset}&limit=${limit}`;
        console.log(`[MercadoLibreService] Fetching ALL updated orders: offset=${offset}`);

        const response = await firstValueFrom(
          this.httpService.get(url, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          })
        );

        const data = response.data;
        totalOrders = data.paging?.total || 0;
        const results = data.results || [];

        allOrders.push(...results);
        console.log(`[MercadoLibreService] Fetched ${results.length} updated orders (total so far: ${allOrders.length}/${totalOrders})`);

        offset += limit;
      } while (offset < totalOrders);

      console.log(`[MercadoLibreService] Total UPDATED orders fetched: ${allOrders.length}`);

      return {
        paging: { total: allOrders.length, offset: 0, limit: allOrders.length },
        results: allOrders,
      } as any;
    } catch (error) {
      console.error('Error fetching updated orders:', error.message);
      throw new Error('No se pudieron obtener las órdenes actualizadas');
    }
  }

  /**
   * Get recent orders (last N days) that might have status changes
   * Useful for detecting cancellations, returns, etc.
   */
  async getRecentOrders(sellerId: number, daysBack: number = 30): Promise<any[]> {
    try {
      const session = await this.sessionRepository.findOne({
        where: { user_id: sellerId },
      });

      if (!session) {
        throw new Error('No se encontró sesión activa');
      }

      const accessToken = session.access_token;

      // Calculate date range
      const toDate = new Date();
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - daysBack);

      const fromDateISO = fromDate.toISOString();
      const toDateISO = toDate.toISOString();

      const allOrders: any[] = [];
      let offset = 0;
      const limit = 50;
      let totalOrders = 0;

      // Fetch all recent orders (all statuses)
      do {
        const url = `${this.BASE_URL}?seller=${sellerId}&order.date_created.from=${fromDateISO}&order.date_created.to=${toDateISO}&offset=${offset}&limit=${limit}`;

        const response = await firstValueFrom(
          this.httpService.get(url, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          })
        );

        const data = response.data;
        totalOrders = data.paging?.total || 0;
        const results = data.results || [];

        allOrders.push(...results);
        offset += limit;
      } while (offset < totalOrders);

      console.log(`[MercadoLibreService] Fetched ${allOrders.length} recent orders (last ${daysBack} days)`);

      return {
        paging: { total: allOrders.length, offset: 0, limit: allOrders.length },
        results: allOrders,
      } as any;
    } catch (error) {
      console.error('Error fetching recent orders:', error.message);
      throw new Error('No se pudieron obtener las órdenes recientes');
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

  /**
   * Get full order details from ML API (includes complete payment info with fees)
   */
  async getOrderDetails(orderId: number, sellerId: number): Promise<any> {
    try {
      const session = await this.sessionRepository.findOne({
        where: { user_id: sellerId },
      });

      if (!session) {
        console.log(`[MercadoLibreService] No session found for seller ${sellerId}`);
        return null;
      }

      const url = `${this.apiUrl}/orders/${orderId}`;
      console.log(`[MercadoLibreService] Fetching order details: ${url}`);

      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        })
      );

      console.log(`[MercadoLibreService] Order details payments:`, JSON.stringify(response.data?.payments, null, 2));
      return response.data;
    } catch (error) {
      console.error(`[MercadoLibreService] Error fetching order details ${orderId}:`, error.message);
      return null;
    }
  }

  /**
   * Get billing info for an order to retrieve marketplace fees
   */
  async getOrderBillingInfo(orderId: number, sellerId: number): Promise<any> {
    try {
      const session = await this.sessionRepository.findOne({
        where: { user_id: sellerId },
      });

      if (!session) {
        console.log(`[MercadoLibreService] No session found for seller ${sellerId}`);
        return null;
      }

      const url = `${this.apiUrl}/orders/${orderId}/billing_info`;
      console.log(`[MercadoLibreService] Fetching billing info: ${url}`);

      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        })
      );

      console.log(`[MercadoLibreService] Billing info response:`, JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error) {
      console.error(`[MercadoLibreService] Error fetching billing info for order ${orderId}:`, error.message);
      return null;
    }
  }

  /**
   * Get shipment info for an order to retrieve logistic_type
   */
  async getOrderShipment(orderId: number, sellerId: number): Promise<any> {
    try {
      const session = await this.sessionRepository.findOne({
        where: { user_id: sellerId },
      });

      if (!session) {
        console.log(`[MercadoLibreService] No session found for seller ${sellerId}`);
        return null;
      }

      const url = `${this.apiUrl}/orders/${orderId}/shipments`;
      console.log(`[MercadoLibreService] Fetching shipment info: ${url}`);

      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        })
      );

      console.log(`[MercadoLibreService] Shipment logistic_type: ${response.data?.logistic_type}`);
      return response.data;
    } catch (error) {
      console.error(`[MercadoLibreService] Error fetching shipment for order ${orderId}:`, error.message);
      return null;
    }
  }

  /**
   * Get shipment costs breakdown - this may contain the actual shipping cost charged to seller
   */
  async getShipmentCosts(shipmentId: number, sellerId: number): Promise<any> {
    try {
      const session = await this.sessionRepository.findOne({
        where: { user_id: sellerId },
      });

      if (!session) {
        console.log(`[MercadoLibreService] No session found for seller ${sellerId}`);
        return null;
      }

      const url = `${this.apiUrl}/shipments/${shipmentId}/costs`;
      console.log(`[MercadoLibreService] Fetching shipment costs: ${url}`);

      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        })
      );

      console.log(`[MercadoLibreService] Shipment costs response:`, JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error) {
      console.error(`[MercadoLibreService] Error fetching shipment costs ${shipmentId}:`, error.message);
      return null;
    }
  }

  /**
   * Get full shipment details by shipment ID
   */
  async getShipmentById(shipmentId: number, sellerId: number): Promise<any> {
    try {
      const session = await this.sessionRepository.findOne({
        where: { user_id: sellerId },
      });

      if (!session) {
        console.log(`[MercadoLibreService] No session found for seller ${sellerId}`);
        return null;
      }

      const url = `${this.apiUrl}/shipments/${shipmentId}`;
      console.log(`[MercadoLibreService] Fetching shipment by ID: ${url}`);

      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        })
      );

      console.log(`[MercadoLibreService] Shipment by ID response:`, JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error) {
      console.error(`[MercadoLibreService] Error fetching shipment ${shipmentId}:`, error.message);
      return null;
    }
  }

  /**
   * Extract marketplace fee from billing info response
   * Handles different structures that ML API might return
   */
  extractMarketplaceFee(billingInfo: any): number {
    if (!billingInfo) {
      return 0;
    }

    // Structure 1: billing_info.details array with type=fee
    if (billingInfo.billing_info?.details) {
      const details = billingInfo.billing_info.details;
      let totalFee = 0;

      for (const detail of details) {
        if (detail.type === 'fee' || detail.type === 'marketplace_fee' ||
            detail.type === 'ml_fee' || detail.type === 'sale_fee') {
          totalFee += Math.abs(detail.amount || 0);
        }
      }

      if (totalFee > 0) return totalFee;
    }

    // Structure 2: Direct fees array
    if (billingInfo.fees) {
      let totalFee = 0;
      for (const fee of billingInfo.fees) {
        totalFee += Math.abs(fee.amount || 0);
      }
      if (totalFee > 0) return totalFee;
    }

    // Structure 3: Direct properties
    if (billingInfo.sale_fee) {
      return Math.abs(billingInfo.sale_fee);
    }
    if (billingInfo.marketplace_fee) {
      return Math.abs(billingInfo.marketplace_fee);
    }

    // Structure 4: billing_info.transactions
    if (billingInfo.billing_info?.transactions) {
      let totalFee = 0;
      for (const transaction of billingInfo.billing_info.transactions) {
        if (transaction.type === 'fee' || transaction.type?.includes('fee')) {
          totalFee += Math.abs(transaction.amount || 0);
        }
      }
      if (totalFee > 0) return totalFee;
    }

    return 0;
  }

  /**
   * Get pack information from ML API
   * Packs group multiple orders together (when buyer purchases multiple products)
   * Returns the orders contained in the pack
   */
  async getPackInfo(packId: number, sellerId: number): Promise<any> {
    try {
      const session = await this.sessionRepository.findOne({
        where: { user_id: sellerId },
      });

      if (!session) {
        console.log(`[MercadoLibreService] No session found for seller ${sellerId}`);
        return null;
      }

      const url = `${this.apiUrl}/packs/${packId}`;
      console.log(`[MercadoLibreService] Fetching pack info: ${url}`);

      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        })
      );

      console.log(`[MercadoLibreService] Pack info response:`, JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error) {
      console.error(`[MercadoLibreService] Error fetching pack ${packId}:`, error.message);
      // Return error details for debugging
      return {
        error: true,
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
      };
    }
  }

  /**
   * Search orders by pack_id
   * Uses the orders search endpoint with pack filter
   */
  async getOrdersByPackId(packId: number, sellerId: number): Promise<any> {
    try {
      const session = await this.sessionRepository.findOne({
        where: { user_id: sellerId },
      });

      if (!session) {
        console.log(`[MercadoLibreService] No session found for seller ${sellerId}`);
        return null;
      }

      // Search for orders with this pack_id
      const url = `${this.apiUrl}/orders/search?seller=${sellerId}&pack_id=${packId}`;
      console.log(`[MercadoLibreService] Searching orders by pack_id: ${url}`);

      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        })
      );

      console.log(`[MercadoLibreService] Orders by pack_id response:`, JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error) {
      console.error(`[MercadoLibreService] Error searching orders by pack ${packId}:`, error.message);
      return {
        error: true,
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
      };
    }
  }
}
