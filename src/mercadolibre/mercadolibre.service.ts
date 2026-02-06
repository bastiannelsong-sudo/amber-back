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

  // ==================== ITEMS & STOCK ====================

  /**
   * Normalize item ID to include country prefix (MLC for Chile)
   * If the ID already has a prefix, return as-is
   */
  private normalizeItemId(itemId: string): string {
    if (!itemId) return itemId;
    // If already has country prefix (MLC, MLA, MLB, etc.), return as-is
    if (/^ML[A-Z]/.test(itemId)) {
      return itemId;
    }
    // Add MLC prefix for Chile
    return `MLC${itemId}`;
  }

  /**
   * Get item details by item ID
   * Returns stock (available_quantity), pictures, price, etc.
   */
  async getItem(itemId: string, sellerId: number): Promise<any> {
    try {
      const session = await this.sessionRepository.findOne({
        where: { user_id: sellerId },
      });

      if (!session) {
        throw new Error('No se encontró sesión activa');
      }

      const normalizedId = this.normalizeItemId(itemId);
      const url = `${this.apiUrl}/items/${normalizedId}`;
      console.log(`[MercadoLibreService] Fetching item: ${url}`);

      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        })
      );

      return response.data;
    } catch (error) {
      console.error(`[MercadoLibreService] Error fetching item ${itemId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get multiple items at once (up to 20)
   */
  async getMultipleItems(itemIds: string[], sellerId: number): Promise<any[]> {
    try {
      const session = await this.sessionRepository.findOne({
        where: { user_id: sellerId },
      });

      if (!session) {
        throw new Error('No se encontró sesión activa');
      }

      // Normalize all item IDs to include country prefix
      const normalizedIds = itemIds.map(id => this.normalizeItemId(id));

      // ML API allows up to 20 items per request
      const results: any[] = [];
      const chunks = [];
      for (let i = 0; i < normalizedIds.length; i += 20) {
        chunks.push(normalizedIds.slice(i, i + 20));
      }

      for (const chunk of chunks) {
        const ids = chunk.join(',');
        const url = `${this.apiUrl}/items?ids=${ids}`;
        console.log(`[MercadoLibreService] Fetching multiple items: ${chunk.length} items`);

        const response = await firstValueFrom(
          this.httpService.get(url, {
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
          })
        );

        // Response is array of {code, body} objects
        for (const item of response.data) {
          if (item.code === 200) {
            results.push(item.body);
          } else {
            console.warn(`[MercadoLibreService] Item ${item.body?.id} returned code ${item.code}`);
          }
        }
      }

      return results;
    } catch (error) {
      console.error(`[MercadoLibreService] Error fetching multiple items:`, error.message);
      throw error;
    }
  }

  /**
   * Search items by SELLER_SKU to get the correct user_product_id
   * This helps us get the right ID for querying stock by location
   */
  async searchItemBySKU(sku: string, sellerId: number): Promise<any> {
    try {
      const session = await this.sessionRepository.findOne({
        where: { user_id: sellerId },
      });

      if (!session) {
        throw new Error('No se encontró sesión activa');
      }

      const url = `${this.apiUrl}/users/${sellerId}/items/search?seller_sku=${encodeURIComponent(sku)}`;
      console.log(`[SearchBySKU] Searching for SKU: ${sku}`);

      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        })
      );

      if (response.data && response.data.results && response.data.results.length > 0) {
        console.log(`[SearchBySKU] ✓ Found ${response.data.results.length} items for SKU ${sku}`);
        return response.data.results[0]; // Return first match
      }

      console.log(`[SearchBySKU] ✗ No items found for SKU ${sku}`);
      return null;
    } catch (error) {
      const status = error.response?.status;
      const message = error.response?.data?.message || error.message;
      console.log(`[SearchBySKU] ✗ Error ${status} searching SKU ${sku}: ${message}`);
      return null;
    }
  }

  /**
   * Get stock breakdown by location (Full/Flex coexistence)
   * Returns stock in meli_facility (Full) and selling_address (Flex)
   * Only works for items with logistic_type=fulfillment and tag self_service_in
   * Available in Argentina (MLA) and Chile (MLC)
   */
  async getStockByLocation(userProductId: string, sellerId: number): Promise<any> {
    try {
      const session = await this.sessionRepository.findOne({
        where: { user_id: sellerId },
      });

      if (!session) {
        throw new Error('No se encontró sesión activa');
      }

      const url = `${this.apiUrl}/user-products/${userProductId}/stock`;
      console.log(`[StockByLocation] GET ${url}`);

      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        })
      );

      return response.data;
    } catch (error) {
      // Not all items support this endpoint (only Full/Flex coexistence)
      const status = error.response?.status;
      const message = error.response?.data?.message || error.message;
      console.log(`[StockByLocation] ✗ Error ${status} for ${userProductId}: ${message}`);
      throw error; // Re-throw para que el caller pueda manejarlo
    }
  }

  /**
   * Get item with include_attributes=all (may include SELLER_SKU in variations)
   */
  async getItemWithAttributes(itemId: string, sellerId: number): Promise<any> {
    try {
      const session = await this.sessionRepository.findOne({
        where: { user_id: sellerId },
      });

      if (!session) {
        throw new Error('No se encontró sesión activa');
      }

      const normalizedId = this.normalizeItemId(itemId);
      const url = `${this.apiUrl}/items/${normalizedId}?include_attributes=all`;
      console.log(`[MercadoLibreService] Fetching item with attributes: ${url}`);

      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        })
      );

      return response.data;
    } catch (error) {
      console.error(`[MercadoLibreService] Error fetching item with attributes ${itemId}:`, error.message);
      return null;
    }
  }

  /**
   * Get a specific variation by ID (may include SELLER_SKU attribute)
   */
  async getVariationById(itemId: string, variationId: number, sellerId: number): Promise<any> {
    try {
      const session = await this.sessionRepository.findOne({
        where: { user_id: sellerId },
      });

      if (!session) {
        throw new Error('No se encontró sesión activa');
      }

      const normalizedId = this.normalizeItemId(itemId);
      const url = `${this.apiUrl}/items/${normalizedId}/variations/${variationId}`;
      console.log(`[MercadoLibreService] Fetching variation: ${url}`);

      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        })
      );

      return response.data;
    } catch (error) {
      console.error(`[MercadoLibreService] Error fetching variation ${variationId}:`, error.message);
      return null;
    }
  }

  /**
   * Get item variations with their SKUs (seller_custom_field)
   * This endpoint returns full variation details including seller_custom_field
   */
  async getItemVariations(itemId: string, sellerId: number): Promise<any[]> {
    try {
      const session = await this.sessionRepository.findOne({
        where: { user_id: sellerId },
      });

      if (!session) {
        throw new Error('No se encontró sesión activa');
      }

      const normalizedId = this.normalizeItemId(itemId);
      const url = `${this.apiUrl}/items/${normalizedId}/variations`;

      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        })
      );

      const variations = response.data || [];
      if (variations.length > 0) {
        console.log(`[MercadoLibreService] Got ${variations.length} variations for ${normalizedId}`);
        // Log first variation to see structure
        const firstVar = variations[0];
        console.log(`[MercadoLibreService] Sample variation SKU: seller_custom_field="${firstVar.seller_custom_field}", seller_sku="${firstVar.seller_sku}"`);
      }

      return variations;
    } catch (error) {
      console.error(`[MercadoLibreService] Error fetching variations for ${itemId}:`, error.message);
      return [];
    }
  }

  /**
   * Search seller's items by SKU (seller_sku attribute)
   */
  async searchItemsBySku(sku: string, sellerId: number): Promise<any> {
    try {
      const session = await this.sessionRepository.findOne({
        where: { user_id: sellerId },
      });

      if (!session) {
        throw new Error('No se encontró sesión activa');
      }

      const url = `${this.apiUrl}/users/${sellerId}/items/search?seller_sku=${encodeURIComponent(sku)}`;
      console.log(`[MercadoLibreService] Searching items by SKU: ${sku}`);

      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        })
      );

      return response.data;
    } catch (error) {
      console.error(`[MercadoLibreService] Error searching items by SKU ${sku}:`, error.message);
      throw error;
    }
  }

  /**
   * Get all seller's active items
   */
  async getAllSellerItems(sellerId: number): Promise<string[]> {
    try {
      const session = await this.sessionRepository.findOne({
        where: { user_id: sellerId },
      });

      if (!session) {
        throw new Error('No se encontró sesión activa');
      }

      const allItemIds: string[] = [];
      let offset = 0;
      const limit = 100;
      let total = 0;

      do {
        const url = `${this.apiUrl}/users/${sellerId}/items/search?offset=${offset}&limit=${limit}`;
        console.log(`[MercadoLibreService] Fetching seller items: offset=${offset}`);

        const response = await firstValueFrom(
          this.httpService.get(url, {
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
          })
        );

        const data = response.data;
        total = data.paging?.total || 0;
        const results = data.results || [];

        allItemIds.push(...results);
        offset += limit;
      } while (offset < total);

      console.log(`[MercadoLibreService] Total seller items: ${allItemIds.length}`);
      return allItemIds;
    } catch (error) {
      console.error(`[MercadoLibreService] Error fetching seller items:`, error.message);
      throw error;
    }
  }

  /**
   * Update variation SKU (seller_custom_field) in Mercado Libre
   */
  async updateVariationSku(
    itemId: string,
    variationId: number,
    sku: string,
    sellerId: number,
  ): Promise<any> {
    try {
      const session = await this.sessionRepository.findOne({
        where: { user_id: sellerId },
      });

      if (!session) {
        throw new Error('No se encontró sesión activa');
      }

      const normalizedId = this.normalizeItemId(itemId);
      const url = `${this.apiUrl}/items/${normalizedId}/variations/${variationId}`;
      console.log(`[MercadoLibreService] Updating variation SKU: ${normalizedId}/${variationId} -> "${sku}"`);

      const response = await firstValueFrom(
        this.httpService.put(
          url,
          { seller_custom_field: sku },
          {
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
          }
        )
      );

      console.log(`[MercadoLibreService] Variation SKU updated successfully`);
      return response.data;
    } catch (error) {
      console.error(`[MercadoLibreService] Error updating variation SKU:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Update item stock in Mercado Libre
   */
  async updateItemStock(itemId: string, quantity: number, sellerId: number): Promise<any> {
    try {
      const session = await this.sessionRepository.findOne({
        where: { user_id: sellerId },
      });

      if (!session) {
        throw new Error('No se encontró sesión activa');
      }

      const normalizedId = this.normalizeItemId(itemId);
      const url = `${this.apiUrl}/items/${normalizedId}`;
      console.log(`[MercadoLibreService] Updating item stock: ${normalizedId} -> ${quantity}`);

      const response = await firstValueFrom(
        this.httpService.put(
          url,
          { available_quantity: quantity },
          {
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
          }
        )
      );

      console.log(`[MercadoLibreService] Stock updated successfully for ${itemId}`);
      return response.data;
    } catch (error) {
      console.error(`[MercadoLibreService] Error updating stock for ${itemId}:`, error.message);
      throw error;
    }
  }

  /**
   * Compare local inventory stock with ML stock for all products with ML secondary SKUs
   */
  async validateStockWithML(
    localProducts: Array<{
      product_id: number;
      internal_sku: string;
      name: string;
      local_stock: number;
      ml_item_id: string;
      logistic_type?: string;
    }>,
    sellerId: number
  ): Promise<{
    matching: any[];
    discrepancies: any[];
    errors: any[];
  }> {
    const matching: any[] = [];
    const discrepancies: any[] = [];
    const errors: any[] = [];

    // Get ML item IDs
    const itemIds = localProducts.map(p => p.ml_item_id).filter(Boolean);

    if (itemIds.length === 0) {
      return { matching, discrepancies, errors };
    }

    try {
      // Fetch all ML items at once (IDs will be normalized inside getMultipleItems)
      console.log(`[ValidateStock] Fetching ${itemIds.length} ML items...`);
      const mlItems = await this.getMultipleItems(itemIds, sellerId);
      console.log(`[ValidateStock] Got ${mlItems.length} ML items`);

      // Map by full ML ID (with prefix)
      const mlItemsMap = new Map(mlItems.map(item => [item.id, item]));

      // Fetch stock breakdown (Full/Flex) using VARIATION user_product_ids
      // With rate limiting to avoid 429 errors
      console.log(`[ValidateStock] ⚡ Fetching stock breakdown (optimized with parallelization)...`);
      const stockBreakdownStartTime = Date.now();
      const stockByLocationMap = new Map<string, any>(); // Map by item ID (for items without variations)
      const stockByVariationMap = new Map<number, any>(); // Map by variation ID (for items with variations)

      // Helper function to delay execution
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

      // Process items in batches with rate limiting
      const BATCH_SIZE = 10; // Process 10 items at a time
      const DELAY_BETWEEN_CALLS = 100; // 100ms between calls (optimized from 150ms)

      let processedCount = 0;

      for (let i = 0; i < mlItems.length; i += BATCH_SIZE) {
        const batch = mlItems.slice(i, i + BATCH_SIZE);
        console.log(`[ValidateStock] Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(mlItems.length / BATCH_SIZE)}`);

        for (const mlItem of batch) {
          // Check if item has variations with user_product_id
          if (mlItem.variations && mlItem.variations.length > 0) {
            const variationsWithUserProductId = mlItem.variations.filter(v => v.user_product_id);

            if (variationsWithUserProductId.length > 0) {
              // Store stock breakdown PER VARIATION - PARALLEL with staggering to avoid rate limits
              const stockPromises = variationsWithUserProductId.map(async (variation, idx) => {
                try {
                  // Stagger calls to avoid rate limiting (50ms between each)
                  await delay(idx * 50);

                  const stockData = await this.getStockByLocation(variation.user_product_id, sellerId);

                  if (stockData && stockData.locations) {
                    const flexLocation = stockData.locations.find((loc: any) => loc.type === 'selling_address');
                    const fullLocation = stockData.locations.find((loc: any) => loc.type === 'meli_facility');

                    // Store by variation ID, not item ID
                    stockByVariationMap.set(variation.id, {
                      locations: [
                        { type: 'selling_address', quantity: flexLocation?.quantity || 0 },
                        { type: 'meli_facility', quantity: fullLocation?.quantity || 0 }
                      ]
                    });
                  }
                } catch (error) {
                  if (error.response?.status === 429) {
                    console.log(`[ValidateStock] ⚠️ Rate limit on variation ${variation.id}, waiting 3s...`);
                    await delay(3000);
                  }
                }
              });

              // Wait for all variations in parallel
              await Promise.allSettled(stockPromises);
            }
          } else {
            const userProductId = mlItem.user_product_id || mlItem.catalog_product_id;

            if (userProductId) {
              try {
                const stockData = await this.getStockByLocation(userProductId, sellerId);
                if (stockData && stockData.locations) {
                  stockByLocationMap.set(mlItem.id, stockData);
                }
                await delay(DELAY_BETWEEN_CALLS);
              } catch (error) {
                if (error.response?.status === 429) {
                  await delay(3000);
                }
              }
            }
          }

          processedCount++;
          if (processedCount % 20 === 0) {
            console.log(`[ValidateStock] Progress: ${processedCount}/${mlItems.length} items, ${stockByLocationMap.size} with stock data`);
          }
        }
      }

      const stockBreakdownTime = ((Date.now() - stockBreakdownStartTime) / 1000).toFixed(1);
      console.log(`[ValidateStock] ✅ Stock breakdown complete in ${stockBreakdownTime}s: ${stockByLocationMap.size} items + ${stockByVariationMap.size} variations`);

      // Identify items with variations that need individual variation fetching
      // The /items/{id}/variations endpoint doesn't return SELLER_SKU attribute
      // We need to fetch /items/{id}/variations/{variation_id} for each variation
      const itemsWithVariations = mlItems.filter(item =>
        item.variations && item.variations.length > 0
      );

      console.log(`[ValidateStock] ${itemsWithVariations.length} items have variations`);

      // Collect all variation IDs to fetch individually
      const variationFetchTasks: Array<{ itemId: string; variationId: number }> = [];
      for (const item of itemsWithVariations) {
        for (const variation of item.variations) {
          variationFetchTasks.push({ itemId: item.id, variationId: variation.id });
        }
      }

      console.log(`[ValidateStock] ⚡ Fetching ${variationFetchTasks.length} individual variations for SELLER_SKU (concurrency: 20)...`);
      const variationFetchStartTime = Date.now();

      // Fetch individual variations in parallel with concurrency limit
      // This is the only way to get SELLER_SKU attribute from ML API
      const variationDetailsMap = new Map<number, any>();
      const CONCURRENCY = 20; // Increased from 10 for better performance

      for (let i = 0; i < variationFetchTasks.length; i += CONCURRENCY) {
        const batch = variationFetchTasks.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.allSettled(
          batch.map(task => this.getVariationById(task.itemId, task.variationId, sellerId))
        );

        batchResults.forEach((result, idx) => {
          if (result.status === 'fulfilled' && result.value) {
            variationDetailsMap.set(batch[idx].variationId, result.value);
          }
        });
      }

      const variationFetchTime = ((Date.now() - variationFetchStartTime) / 1000).toFixed(1);
      console.log(`[ValidateStock] ✅ Fetched ${variationDetailsMap.size} variation details in ${variationFetchTime}s`);

      // Helper to extract SELLER_SKU from variation's attributes array
      const getSellerSkuFromVariation = (variation: any): string | null => {
        if (!variation?.attributes) return null;
        const skuAttr = variation.attributes.find((a: any) => a.id === 'SELLER_SKU');
        return skuAttr?.value_name || null;
      };

      for (const product of localProducts) {
        // Normalize the local ml_item_id to match the ML API response format
        const normalizedId = this.normalizeItemId(product.ml_item_id);
        const mlItem = mlItemsMap.get(normalizedId);

        if (!mlItem) {
          errors.push({
            product_id: product.product_id,
            internal_sku: product.internal_sku,
            name: product.name,
            ml_item_id: normalizedId,
            original_id: product.ml_item_id,
            error: 'Item no encontrado en Mercado Libre',
          });
          continue;
        }

        // Check if item has variations and find the specific one by SKU
        let mlStock = mlItem.available_quantity || 0;
        let variationInfo: { id: number; attributes: string; sku?: string; unmatched_variations?: any[] } | null = null;

        if (mlItem.variations && mlItem.variations.length > 0) {
          // Build enriched variations with SELLER_SKU from individual fetches
          const enrichedVariations = mlItem.variations.map((v: any) => {
            const fullDetails = variationDetailsMap.get(v.id);
            const sellerSku = fullDetails ? getSellerSkuFromVariation(fullDetails) : null;
            return {
              ...v,
              seller_sku: sellerSku,
              attributes: fullDetails?.attributes || [],
            };
          });

          // 🔍 LOG para PCR0007/PCR0008/PCR0009
          if (['PCR0007', 'PCR0008', 'PCR0009'].includes(product.internal_sku)) {
            console.log(`\n${'='.repeat(70)}`);
            console.log(`🔍 [${product.internal_sku}] Buscando match en validación de stock`);
            console.log(`   Item ML: ${mlItem.id}`);
            console.log(`   Variaciones totales: ${enrichedVariations.length}`);
            enrichedVariations.forEach((v: any) => {
              console.log(`\n   📦 Variación ${v.id}:`);
              console.log(`      - SELLER_SKU: ${v.seller_sku ? `"${v.seller_sku}"` : '❌ NULL'}`);
              console.log(`      - available_quantity: ${v.available_quantity ?? 0}`);
              console.log(`      - Match: ${v.seller_sku?.toUpperCase() === product.internal_sku.toUpperCase() ? '✅' : '❌'}`);
            });
          }

          // Try to find the variation that matches the internal SKU
          const matchingVariation = enrichedVariations.find((v: any) => {
            const varSku = v.seller_sku || v.seller_custom_field;
            return varSku === product.internal_sku ||
              varSku?.toUpperCase() === product.internal_sku?.toUpperCase();
          });

          // 🔍 LOG resultado del match para PCR0007/PCR0008/PCR0009
          if (['PCR0007', 'PCR0008', 'PCR0009'].includes(product.internal_sku)) {
            if (matchingVariation) {
              console.log(`\n   ✅ MATCH ENCONTRADO:`);
              console.log(`      - Variation ID: ${matchingVariation.id}`);
              console.log(`      - Stock a usar: ${matchingVariation.available_quantity ?? mlStock}`);
            } else {
              console.log(`\n   ❌ NO SE ENCONTRÓ MATCH`);
              console.log(`      - Se usará stock total del item: ${mlStock}`);
            }
            console.log(`${'='.repeat(70)}\n`);
          }

          if (matchingVariation) {
            // Use the specific variation's stock
            mlStock = matchingVariation.available_quantity ?? mlStock;
            variationInfo = {
              id: matchingVariation.id,
              sku: matchingVariation.seller_sku,
              attributes: matchingVariation.attribute_combinations
                ?.map((attr: any) => `${attr.name}: ${attr.value_name}`)
                .join(', ') || '',
            };
          } else if (enrichedVariations.length > 1) {
            // Item has variations but we couldn't match by SKU
            // Build detailed list of available variations
            const variationDetails = enrichedVariations.map((v: any) => ({
              id: v.id,
              sku: v.seller_sku || '(sin SKU)',
              stock: v.available_quantity ?? 0,
              attributes: v.attribute_combinations
                ?.map((attr: any) => `${attr.name}: ${attr.value_name}`)
                .join(', ') || '',
            }));

            variationInfo = {
              id: 0,
              attributes: `⚠️ ${enrichedVariations.length} variaciones - Stock total: ${mlStock}`,
              unmatched_variations: variationDetails,
            };
          }
        }

        const localStock = product.local_stock;

        // Get stock breakdown if available (Full/Flex)
        // For items with variations, use the matched variation's stock breakdown
        // For items without variations, use the item-level stock breakdown
        let stockBreakdown = null;
        if (variationInfo && variationInfo.id > 0) {
          // Has matched variation - use variation-specific stock
          stockBreakdown = stockByVariationMap.get(variationInfo.id);
        } else {
          // No variation or no match - use item-level stock
          stockBreakdown = stockByLocationMap.get(normalizedId);
        }

        let mlStockFull: number | null = null;
        let mlStockFlex: number | null = null;

        if (stockBreakdown?.locations) {
          const fullLocation = stockBreakdown.locations.find((loc: any) => loc.type === 'meli_facility');
          const flexLocation = stockBreakdown.locations.find((loc: any) => loc.type === 'selling_address');

          mlStockFull = fullLocation?.quantity ?? null;
          mlStockFlex = flexLocation?.quantity ?? null;

          // For variations with stock breakdown, calculate total stock based on logistic_type
          if (variationInfo && variationInfo.id > 0 && mlStockFlex != null) {
            if (product.logistic_type === 'fulfillment') {
              // For fulfillment: only compare with Flex (your depot)
              // Full stock is managed by ML, not your responsibility
              mlStock = mlStockFlex;
            } else if (mlStockFull != null) {
              // For cross_docking/flex: compare with total (Flex + Full)
              mlStock = mlStockFlex + mlStockFull;
            }
          }
        }

        const result = {
          product_id: product.product_id,
          internal_sku: product.internal_sku,
          name: product.name,
          ml_item_id: normalizedId,
          ml_title: mlItem.title,
          local_stock: localStock,
          ml_stock: mlStock,
          ml_stock_full: mlStockFull,
          ml_stock_flex: mlStockFlex,
          ml_status: mlItem.status,
          ml_pictures: mlItem.pictures?.map((p: any) => p.url) || [],
          ml_price: mlItem.price,
          ml_permalink: mlItem.permalink,
          ml_variation: variationInfo,
        };

        if (localStock === mlStock) {
          matching.push(result);
        } else {
          discrepancies.push({
            ...result,
            difference: localStock - mlStock,
          });
        }
      }
    } catch (error) {
      console.error(`[MercadoLibreService] Error validating stock:`, error.message);
      errors.push({ error: error.message });
    }

    // Log summary of stock breakdown data
    const itemsWithStockBreakdown = [...matching, ...discrepancies].filter(
      item => item.ml_stock_flex != null || item.ml_stock_full != null
    );
    console.log(`[ValidateStock] 📊 Final result: ${itemsWithStockBreakdown.length} items with stock breakdown data`);
    if (itemsWithStockBreakdown.length > 0) {
      console.log(`[ValidateStock] Sample:`, {
        sku: itemsWithStockBreakdown[0].internal_sku,
        flex: itemsWithStockBreakdown[0].ml_stock_flex,
        full: itemsWithStockBreakdown[0].ml_stock_full,
      });
    }

    return { matching, discrepancies, errors };
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
