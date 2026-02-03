import { Controller, Get, Put, Post, Body, Param, ParseIntPipe, Query } from '@nestjs/common';
import { MercadoLibreService } from './mercadolibre.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../products/entities/product.entity';
import { SecondarySku } from '../products/entities/secondary-sku.entity';

@Controller('mercadolibre')
export class MercadoLibreController {
  constructor(
    private readonly mercadoLibreService: MercadoLibreService,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(SecondarySku)
    private readonly secondarySkuRepository: Repository<SecondarySku>,
  ) {}

  @Get('orders')
  async getOrders(
    @Query('date') date: string,
    @Query('seller_id', ParseIntPipe) seller_id: number,
  ) {
    if (!date) {
      throw new Error('La fecha es obligatoria');
    }
    return this.mercadoLibreService.getOrdersByDate(date, seller_id);
  }

  // ==================== ITEMS & STOCK ====================

  /**
   * Get a single item from ML
   */
  @Get('items/:itemId')
  async getItem(
    @Param('itemId') itemId: string,
    @Query('seller_id', ParseIntPipe) sellerId: number,
  ) {
    return this.mercadoLibreService.getItem(itemId, sellerId);
  }

  /**
   * Search items by seller SKU
   */
  @Get('items/search/sku')
  async searchBySku(
    @Query('sku') sku: string,
    @Query('seller_id', ParseIntPipe) sellerId: number,
  ) {
    if (!sku) {
      throw new Error('El SKU es obligatorio');
    }
    return this.mercadoLibreService.searchItemsBySku(sku, sellerId);
  }

  /**
   * Get all seller items
   */
  @Get('items')
  async getAllItems(@Query('seller_id', ParseIntPipe) sellerId: number) {
    return this.mercadoLibreService.getAllSellerItems(sellerId);
  }

  /**
   * Validate stock: Compare local inventory with ML stock
   * Returns discrepancies between local and ML stock
   */
  @Get('stock/validate')
  async validateStock(@Query('seller_id', ParseIntPipe) sellerId: number) {
    // Get all products with ML secondary SKUs (platform_id = 1 for Mercado Libre)
    const secondarySkus = await this.secondarySkuRepository.find({
      where: { platform: { platform_id: 1 } }, // Mercado Libre
      relations: ['product', 'platform'],
    });

    if (secondarySkus.length === 0) {
      return {
        message: 'No hay productos vinculados a Mercado Libre',
        matching: [],
        discrepancies: [],
        errors: [],
      };
    }

    // Prepare data for validation
    const localProducts = secondarySkus.map((sku) => ({
      product_id: sku.product.product_id,
      internal_sku: sku.product.internal_sku,
      name: sku.product.name,
      local_stock: sku.product.stock, // Stock total del producto
      ml_item_id: sku.secondary_sku, // Este es el MLC... de ML
    }));

    const result = await this.mercadoLibreService.validateStockWithML(localProducts, sellerId);

    return {
      summary: {
        total: localProducts.length,
        matching: result.matching.length,
        discrepancies: result.discrepancies.length,
        errors: result.errors.length,
      },
      ...result,
    };
  }

  /**
   * Update stock in Mercado Libre
   */
  @Put('items/:itemId/stock')
  async updateMLStock(
    @Param('itemId') itemId: string,
    @Query('seller_id', ParseIntPipe) sellerId: number,
    @Body('quantity', ParseIntPipe) quantity: number,
  ) {
    return this.mercadoLibreService.updateItemStock(itemId, quantity, sellerId);
  }

  /**
   * Sync stock: Update ML stock to match local inventory
   */
  @Post('stock/sync-to-ml')
  async syncStockToML(
    @Query('seller_id', ParseIntPipe) sellerId: number,
    @Body() body: { items?: string[] }, // Optional: specific items to sync
  ) {
    // Get products with ML secondary SKUs
    const query = this.secondarySkuRepository
      .createQueryBuilder('sku')
      .leftJoinAndSelect('sku.product', 'product')
      .leftJoinAndSelect('sku.platform', 'platform')
      .where('platform.platform_id = :platformId', { platformId: 1 });

    if (body.items && body.items.length > 0) {
      query.andWhere('sku.secondary_sku IN (:...items)', { items: body.items });
    }

    const secondarySkus = await query.getMany();

    const results = {
      success: [] as any[],
      failed: [] as any[],
    };

    for (const sku of secondarySkus) {
      try {
        await this.mercadoLibreService.updateItemStock(
          sku.secondary_sku,
          sku.product.stock,
          sellerId,
        );
        results.success.push({
          ml_item_id: sku.secondary_sku,
          internal_sku: sku.product.internal_sku,
          stock_sent: sku.product.stock,
        });
      } catch (error) {
        results.failed.push({
          ml_item_id: sku.secondary_sku,
          internal_sku: sku.product.internal_sku,
          error: error.message,
        });
      }
    }

    return {
      summary: {
        total: secondarySkus.length,
        success: results.success.length,
        failed: results.failed.length,
      },
      ...results,
    };
  }

  /**
   * Sync stock: Update local inventory to match ML stock
   */
  @Post('stock/sync-from-ml')
  async syncStockFromML(
    @Query('seller_id', ParseIntPipe) sellerId: number,
    @Body() body: { items?: string[] },
  ) {
    // Get products with ML secondary SKUs
    const query = this.secondarySkuRepository
      .createQueryBuilder('sku')
      .leftJoinAndSelect('sku.product', 'product')
      .leftJoinAndSelect('sku.platform', 'platform')
      .where('platform.platform_id = :platformId', { platformId: 1 });

    if (body.items && body.items.length > 0) {
      query.andWhere('sku.secondary_sku IN (:...items)', { items: body.items });
    }

    const secondarySkus = await query.getMany();
    const itemIds = secondarySkus.map((s) => s.secondary_sku);

    if (itemIds.length === 0) {
      return { message: 'No hay items para sincronizar', success: [], failed: [] };
    }

    // Helper to normalize item ID (add MLC prefix if missing)
    const normalizeId = (id: string) => {
      if (!id) return id;
      return /^ML[A-Z]/.test(id) ? id : `MLC${id}`;
    };

    // Get ML items (service will normalize IDs internally)
    const mlItems = await this.mercadoLibreService.getMultipleItems(itemIds, sellerId);
    // Map by normalized ML ID
    const mlItemsMap = new Map(mlItems.map((item) => [item.id, item]));

    const results = {
      success: [] as any[],
      failed: [] as any[],
    };

    for (const sku of secondarySkus) {
      // Normalize to match the ML API response format
      const normalizedId = normalizeId(sku.secondary_sku);
      const mlItem = mlItemsMap.get(normalizedId);

      if (!mlItem) {
        results.failed.push({
          ml_item_id: sku.secondary_sku,
          internal_sku: sku.product.internal_sku,
          error: 'Item no encontrado en ML',
        });
        continue;
      }

      try {
        const oldStock = sku.product.stock;
        const newStock = mlItem.available_quantity || 0;
        const imageUrl = mlItem.pictures?.[0]?.url || null;

        // Update local product stock and image
        await this.productRepository.update(sku.product.product_id, {
          stock: newStock,
          ...(imageUrl && { image_url: imageUrl }),
        });

        results.success.push({
          ml_item_id: sku.secondary_sku,
          internal_sku: sku.product.internal_sku,
          old_stock: oldStock,
          new_stock: newStock,
          image_url: imageUrl,
        });
      } catch (error) {
        results.failed.push({
          ml_item_id: sku.secondary_sku,
          internal_sku: sku.product.internal_sku,
          error: error.message,
        });
      }
    }

    return {
      summary: {
        total: secondarySkus.length,
        success: results.success.length,
        failed: results.failed.length,
      },
      ...results,
    };
  }

  /**
   * Sync images only: Update local product images from ML without changing stock
   */
  @Post('images/sync')
  async syncImagesFromML(
    @Query('seller_id', ParseIntPipe) sellerId: number,
    @Body() body: { items?: string[] },
  ) {
    // Get products with ML secondary SKUs
    const query = this.secondarySkuRepository
      .createQueryBuilder('sku')
      .leftJoinAndSelect('sku.product', 'product')
      .leftJoinAndSelect('sku.platform', 'platform')
      .where('platform.platform_id = :platformId', { platformId: 1 });

    if (body.items && body.items.length > 0) {
      query.andWhere('sku.secondary_sku IN (:...items)', { items: body.items });
    }

    const secondarySkus = await query.getMany();
    const itemIds = secondarySkus.map((s) => s.secondary_sku);

    if (itemIds.length === 0) {
      return { message: 'No hay items para sincronizar', success: [], failed: [] };
    }

    // Helper to normalize item ID (add MLC prefix if missing)
    const normalizeId = (id: string) => {
      if (!id) return id;
      return /^ML[A-Z]/.test(id) ? id : `MLC${id}`;
    };

    // Get ML items
    const mlItems = await this.mercadoLibreService.getMultipleItems(itemIds, sellerId);
    const mlItemsMap = new Map(mlItems.map((item) => [item.id, item]));

    const results = {
      success: [] as any[],
      failed: [] as any[],
    };

    for (const sku of secondarySkus) {
      const normalizedId = normalizeId(sku.secondary_sku);
      const mlItem = mlItemsMap.get(normalizedId);

      if (!mlItem) {
        results.failed.push({
          ml_item_id: sku.secondary_sku,
          internal_sku: sku.product.internal_sku,
          error: 'Item no encontrado en ML',
        });
        continue;
      }

      try {
        const imageUrl = mlItem.pictures?.[0]?.url || null;

        if (imageUrl) {
          await this.productRepository.update(sku.product.product_id, {
            image_url: imageUrl,
          });

          results.success.push({
            ml_item_id: sku.secondary_sku,
            internal_sku: sku.product.internal_sku,
            product_name: sku.product.name,
            image_url: imageUrl,
          });
        } else {
          results.failed.push({
            ml_item_id: sku.secondary_sku,
            internal_sku: sku.product.internal_sku,
            error: 'Item no tiene imagen en ML',
          });
        }
      } catch (error) {
        results.failed.push({
          ml_item_id: sku.secondary_sku,
          internal_sku: sku.product.internal_sku,
          error: error.message,
        });
      }
    }

    return {
      summary: {
        total: secondarySkus.length,
        success: results.success.length,
        failed: results.failed.length,
      },
      ...results,
    };
  }
}
