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
   * Get item variations (debug endpoint) - returns full variation data
   * Tests multiple API approaches to find where SKU is stored
   */
  @Get('items/:itemId/variations')
  async getItemVariations(
    @Param('itemId') itemId: string,
    @Query('seller_id', ParseIntPipe) sellerId: number,
  ) {
    // Get variations from dedicated endpoint
    const variations = await this.mercadoLibreService.getItemVariations(itemId, sellerId);

    // Get item with include_attributes=all (may include SELLER_SKU)
    const itemWithAttrs = await this.mercadoLibreService.getItemWithAttributes(itemId, sellerId);

    // Get each variation individually (may include more data)
    const variationDetails = await Promise.all(
      variations.slice(0, 3).map((v: any) =>
        this.mercadoLibreService.getVariationById(itemId, v.id, sellerId)
      )
    );

    // Extract SKU info from different sources
    const skuAnalysis = variations.map((v: any) => {
      // Check attributes array for SELLER_SKU
      const skuFromAttrs = v.attributes?.find((a: any) => a.id === 'SELLER_SKU')?.value_name;
      // Check attribute_combinations
      const skuFromCombinations = v.attribute_combinations?.find((a: any) => a.id === 'SELLER_SKU')?.value_name;

      return {
        variation_id: v.id,
        seller_custom_field: v.seller_custom_field,
        seller_sku_from_attributes: skuFromAttrs || null,
        seller_sku_from_combinations: skuFromCombinations || null,
        has_attributes_array: !!v.attributes,
        attributes_count: v.attributes?.length || 0,
      };
    });

    return {
      item_id: itemId,
      item_seller_custom_field: itemWithAttrs?.seller_custom_field,
      item_seller_sku_attribute: itemWithAttrs?.attributes?.find((a: any) => a.id === 'SELLER_SKU')?.value_name,
      variations_count: variations.length,
      // SKU analysis for each variation
      sku_analysis: skuAnalysis,
      // Individual variation details (may have more data)
      individual_variation_details: variationDetails,
      // Raw variations from /variations endpoint
      variations_raw: variations,
    };
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
      local_stock: (sku.product.stock || 0) + (sku.product.stock_bodega || 0), // Stock total (tienda + bodega)
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
   * Update variation SKU (seller_custom_field) in Mercado Libre
   * This fixes variations where SKU is null in the API but set in seller center
   */
  @Put('items/:itemId/variations/:variationId/sku')
  async updateVariationSku(
    @Param('itemId') itemId: string,
    @Param('variationId', ParseIntPipe) variationId: number,
    @Query('seller_id', ParseIntPipe) sellerId: number,
    @Body('sku') sku: string,
  ) {
    if (!sku) {
      throw new Error('El SKU es obligatorio');
    }
    return this.mercadoLibreService.updateVariationSku(itemId, variationId, sku, sellerId);
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
      const totalStock = (sku.product.stock || 0) + (sku.product.stock_bodega || 0);
      try {
        await this.mercadoLibreService.updateItemStock(
          sku.secondary_sku,
          totalStock,
          sellerId,
        );
        results.success.push({
          ml_item_id: sku.secondary_sku,
          internal_sku: sku.product.internal_sku,
          stock_sent: totalStock,
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
        const oldStock = (sku.product.stock || 0) + (sku.product.stock_bodega || 0);
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
   * Discovery sync: Match ML items with local products by SKU and create links
   * This updates product names, images, prices, and creates secondary_sku entries
   */
  @Post('products/discover')
  async discoverAndLinkProducts(
    @Query('seller_id', ParseIntPipe) sellerId: number,
  ) {
    // Get all local products
    const localProducts = await this.productRepository.find();
    const productsBySkuUpper = new Map(
      localProducts.map((p) => [p.internal_sku.toUpperCase(), p]),
    );

    // Get all ML item IDs
    const mlItemIds = await this.mercadoLibreService.getAllSellerItems(sellerId);

    if (mlItemIds.length === 0) {
      return { message: 'No hay items en Mercado Libre', matched: [], unmatched: [] };
    }

    // Get full details for all ML items
    const mlItems = await this.mercadoLibreService.getMultipleItems(mlItemIds, sellerId);

    const results = {
      matched: [] as any[],
      unmatched: [] as any[],
      errors: [] as any[],
    };

    // Helper to extract SKU from item attributes
    const getSkuFromAttributes = (attributes: any[]): string | null => {
      if (!attributes) return null;
      const skuAttr = attributes.find((a: any) => a.id === 'SELLER_SKU');
      return skuAttr?.value_name || null;
    };

    for (const mlItem of mlItems) {
      // Get SKU from seller_custom_field, SELLER_SKU attribute, or variations
      let sku = mlItem.seller_custom_field || getSkuFromAttributes(mlItem.attributes);
      let variationId: number | null = null;

      // If no SKU at item level, check variations
      if (!sku && mlItem.variations?.length > 0) {
        // For items with variations, each variation has its own SKU
        // ML can store SKU in seller_custom_field or seller_sku
        for (const variation of mlItem.variations) {
          const varSku = variation.seller_custom_field || variation.seller_sku;
          if (varSku) {
            const product = productsBySkuUpper.get(varSku.toUpperCase());
            if (product) {
              try {
                // Check if link already exists
                const existingLink = await this.secondarySkuRepository.findOne({
                  where: {
                    secondary_sku: mlItem.id,
                    product: { product_id: product.product_id },
                  },
                });

                if (!existingLink) {
                  // Create secondary_sku link
                  await this.secondarySkuRepository.save({
                    secondary_sku: mlItem.id,
                    stock_quantity: variation.available_quantity || 0,
                    publication_link: mlItem.permalink,
                    product: product,
                    platform: { platform_id: 1 }, // Mercado Libre
                  });
                }

                // Update product with ML data
                const imageUrl = mlItem.pictures?.[0]?.url || null;
                await this.productRepository.update(product.product_id, {
                  name: mlItem.title,
                  ...(imageUrl && { image_url: imageUrl }),
                });

                results.matched.push({
                  ml_item_id: mlItem.id,
                  ml_title: mlItem.title,
                  internal_sku: product.internal_sku,
                  variation_sku: varSku,
                  price: mlItem.price,
                  permalink: mlItem.permalink,
                  image: imageUrl,
                });
              } catch (error) {
                results.errors.push({
                  ml_item_id: mlItem.id,
                  sku: varSku,
                  error: error.message,
                });
              }
            }
          }
        }
        continue; // Already processed variations
      }

      if (!sku) {
        results.unmatched.push({
          ml_item_id: mlItem.id,
          ml_title: mlItem.title,
          price: mlItem.price,
          permalink: mlItem.permalink,
          reason: 'Sin SKU en ML',
        });
        continue;
      }

      // Find matching local product
      const product = productsBySkuUpper.get(sku.toUpperCase());

      if (!product) {
        results.unmatched.push({
          ml_item_id: mlItem.id,
          ml_title: mlItem.title,
          ml_sku: sku,
          price: mlItem.price,
          permalink: mlItem.permalink,
          reason: 'SKU no encontrado en productos locales',
        });
        continue;
      }

      try {
        // Check if link already exists
        const existingLink = await this.secondarySkuRepository.findOne({
          where: {
            secondary_sku: mlItem.id,
            product: { product_id: product.product_id },
          },
        });

        if (!existingLink) {
          // Create secondary_sku link
          await this.secondarySkuRepository.save({
            secondary_sku: mlItem.id,
            stock_quantity: mlItem.available_quantity || 0,
            publication_link: mlItem.permalink,
            product: product,
            platform: { platform_id: 1 }, // Mercado Libre
          });
        }

        // Update product with ML data
        const imageUrl = mlItem.pictures?.[0]?.url || null;
        await this.productRepository.update(product.product_id, {
          name: mlItem.title,
          ...(imageUrl && { image_url: imageUrl }),
        });

        results.matched.push({
          ml_item_id: mlItem.id,
          ml_title: mlItem.title,
          internal_sku: product.internal_sku,
          price: mlItem.price,
          permalink: mlItem.permalink,
          image: imageUrl,
        });
      } catch (error) {
        results.errors.push({
          ml_item_id: mlItem.id,
          sku: sku,
          error: error.message,
        });
      }
    }

    return {
      summary: {
        total_ml_items: mlItems.length,
        matched: results.matched.length,
        unmatched: results.unmatched.length,
        errors: results.errors.length,
      },
      ...results,
    };
  }

  /**
   * Discovery V2: Reverse search - for each local SKU, search in ML by seller_sku
   * This finds items in Fulfillment and other logistic types where SKU is indexed differently
   */
  @Post('products/discover-v2')
  async discoverAndLinkProductsV2(
    @Query('seller_id', ParseIntPipe) sellerId: number,
  ) {
    // Get all local products
    const localProducts = await this.productRepository.find();

    const results = {
      matched: [] as any[],
      not_found: [] as any[],
      errors: [] as any[],
    };

    console.log(`[Discovery V2] Starting reverse search for ${localProducts.length} local products`);

    // For each local product, search in ML by SKU
    for (const product of localProducts) {
      try {
        // Search ML by seller_sku
        const searchResult = await this.mercadoLibreService.searchItemsBySku(
          product.internal_sku,
          sellerId,
        );

        const itemIds = searchResult?.results || [];

        if (itemIds.length === 0) {
          results.not_found.push({
            internal_sku: product.internal_sku,
            name: product.name,
            stock: product.stock,
          });
          continue;
        }

        // Get full details for found items
        const mlItems = await this.mercadoLibreService.getMultipleItems(itemIds, sellerId);

        for (const mlItem of mlItems) {
          // Get logistic_type from shipping info
          const logisticType = mlItem.shipping?.logistic_type || 'other';

          // Check if link already exists
          const existingLink = await this.secondarySkuRepository.findOne({
            where: {
              secondary_sku: mlItem.id,
              product: { product_id: product.product_id },
            },
          });

          if (existingLink) {
            // Update logistic_type if it changed
            if (existingLink.logistic_type !== logisticType) {
              await this.secondarySkuRepository.update(existingLink.secondary_sku_id, {
                logistic_type: logisticType,
              });
            }
          } else {
            // Create secondary_sku link with logistic_type
            await this.secondarySkuRepository.save({
              secondary_sku: mlItem.id,
              stock_quantity: mlItem.available_quantity || 0,
              publication_link: mlItem.permalink,
              logistic_type: logisticType,
              variation_id: null,
              product: product,
              platform: { platform_id: 1 }, // Mercado Libre
            });
          }

          // Update product with ML data (name and image)
          const imageUrl = mlItem.pictures?.[0]?.url || null;
          await this.productRepository.update(product.product_id, {
            name: mlItem.title,
            ...(imageUrl && { image_url: imageUrl }),
          });

          results.matched.push({
            internal_sku: product.internal_sku,
            ml_item_id: mlItem.id,
            ml_title: mlItem.title,
            logistic_type: logisticType,
            ml_stock: mlItem.available_quantity,
            local_stock: product.stock,
            price: mlItem.price,
            permalink: mlItem.permalink,
            image: imageUrl,
            is_new_link: !existingLink,
          });
        }
      } catch (error) {
        results.errors.push({
          internal_sku: product.internal_sku,
          error: error.message,
        });
      }
    }

    // Group results by logistic type for summary
    const byLogistic = {
      fulfillment: results.matched.filter((m) => m.logistic_type === 'fulfillment').length,
      cross_docking: results.matched.filter((m) => m.logistic_type === 'cross_docking').length,
      xd_drop_off: results.matched.filter((m) => m.logistic_type === 'xd_drop_off').length,
      other: results.matched.filter((m) => !['fulfillment', 'cross_docking', 'xd_drop_off'].includes(m.logistic_type)).length,
    };

    return {
      summary: {
        total_local_products: localProducts.length,
        matched: results.matched.length,
        not_found_in_ml: results.not_found.length,
        errors: results.errors.length,
        by_logistic_type: byLogistic,
      },
      ...results,
    };
  }

  /**
   * Full sync: Discovery + Images (Optimized)
   * 1. Search SKUs in parallel with concurrency limit
   * 2. Batch fetch item details (20 per request)
   * 3. Batch database operations
   */
  @Post('images/sync')
  async syncFullFromML(
    @Query('seller_id', ParseIntPipe) sellerId: number,
  ) {
    const localProducts = await this.productRepository.find();
    const CONCURRENCY = 5; // Limit parallel API calls to avoid rate limiting

    const results = {
      discovery: {
        matched: [] as any[],
        not_found: [] as any[],
        skipped_paused: [] as any[],
        errors: [] as any[],
      },
      images: {
        synced: [] as any[],
        no_image: [] as any[],
      },
    };

    console.log(`[Full Sync] Starting for ${localProducts.length} local products (concurrency: ${CONCURRENCY})`);

    // Helper to process in batches with concurrency limit
    const processInBatches = async <T, R>(
      items: T[],
      processor: (item: T) => Promise<R>,
      batchSize: number,
    ): Promise<{ item: T; result?: R; error?: string }[]> => {
      const results: { item: T; result?: R; error?: string }[] = [];
      for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        const batchResults = await Promise.allSettled(batch.map(processor));
        batchResults.forEach((res, idx) => {
          if (res.status === 'fulfilled') {
            results.push({ item: batch[idx], result: res.value });
          } else {
            results.push({ item: batch[idx], error: res.reason?.message || 'Unknown error' });
          }
        });
      }
      return results;
    };

    // Step 1: Search all SKUs in parallel batches
    console.log(`[Full Sync] Step 1: Searching ${localProducts.length} SKUs in ML...`);
    const skuSearchResults = await processInBatches(
      localProducts,
      async (product) => {
        const searchResult = await this.mercadoLibreService.searchItemsBySku(
          product.internal_sku,
          sellerId,
        );
        return { product, itemIds: searchResult?.results || [] };
      },
      CONCURRENCY,
    );

    // Collect all item IDs and map to products
    const itemToProductMap = new Map<string, Product>();
    const allItemIds: string[] = [];

    for (const { item: product, result, error } of skuSearchResults) {
      if (error) {
        results.discovery.errors.push({ internal_sku: product.internal_sku, error });
        continue;
      }
      if (!result || result.itemIds.length === 0) {
        results.discovery.not_found.push({ internal_sku: product.internal_sku, name: product.name });
        continue;
      }
      for (const itemId of result.itemIds) {
        itemToProductMap.set(itemId, product);
        if (!allItemIds.includes(itemId)) {
          allItemIds.push(itemId);
        }
      }
    }

    console.log(`[Full Sync] Step 2: Fetching details for ${allItemIds.length} ML items...`);

    // Step 2: Fetch all item details in one batch call (getMultipleItems already batches by 20)
    let mlItems: any[] = [];
    if (allItemIds.length > 0) {
      try {
        mlItems = await this.mercadoLibreService.getMultipleItems(allItemIds, sellerId);
      } catch (error) {
        console.error(`[Full Sync] Error fetching items:`, error.message);
      }
    }

    console.log(`[Full Sync] Step 3: Processing ${mlItems.length} items and updating DB...`);

    // Step 3a: For items with variations, fetch individual variation details to get SELLER_SKU
    const itemsWithVariations = mlItems.filter(item => item.variations && item.variations.length > 0);
    const variationFetchTasks: Array<{ itemId: string; variationId: number }> = [];

    for (const item of itemsWithVariations) {
      for (const variation of item.variations) {
        variationFetchTasks.push({ itemId: item.id, variationId: variation.id });
      }
    }

    console.log(`[Full Sync] Fetching ${variationFetchTasks.length} individual variations for SELLER_SKU...`);

    const variationDetailsMap = new Map<number, any>();
    const VARIATION_CONCURRENCY = 10;

    for (let i = 0; i < variationFetchTasks.length; i += VARIATION_CONCURRENCY) {
      const batch = variationFetchTasks.slice(i, i + VARIATION_CONCURRENCY);
      const batchResults = await Promise.allSettled(
        batch.map(task => this.mercadoLibreService.getVariationById(task.itemId, task.variationId, sellerId))
      );

      batchResults.forEach((result, idx) => {
        if (result.status === 'fulfilled' && result.value) {
          variationDetailsMap.set(batch[idx].variationId, result.value);
        }
      });
    }

    console.log(`[Full Sync] Fetched ${variationDetailsMap.size} variation details`);

    // Helper to extract SELLER_SKU from variation
    const getSellerSkuFromVariation = (variation: any): string | null => {
      if (!variation?.attributes) return null;
      const skuAttr = variation.attributes.find((a: any) => a.id === 'SELLER_SKU');
      return skuAttr?.value_name || null;
    };

    // Step 3b: Get existing links in one query
    const existingLinks = await this.secondarySkuRepository.find({
      where: { platform: { platform_id: 1 } },
      relations: ['product'],
    });
    // Key includes variation_id for proper matching
    const existingLinksMap = new Map(
      existingLinks.map((link) => [`${link.secondary_sku}-${link.variation_id || 'null'}-${link.product.product_id}`, link]),
    );

    // Prepare batch operations
    const linksToCreate: any[] = [];
    const linksToUpdate: { id: number; logisticType: string; variationId?: number }[] = [];
    const productsToUpdate: { id: number; name: string; imageUrl?: string; images?: string[]; price?: number }[] = [];
    // Track which products we've already processed (to handle multiple ML items per product)
    const processedProducts = new Set<number>();

    for (const mlItem of mlItems) {
      const product = itemToProductMap.get(mlItem.id);
      if (!product) continue;

      // Skip paused, closed, or inactive items - only sync active ones
      if (mlItem.status !== 'active') {
        results.discovery.skipped_paused.push({
          internal_sku: product.internal_sku,
          ml_item_id: mlItem.id,
          ml_title: mlItem.title,
          status: mlItem.status,
        });
        continue;
      }

      const logisticType = mlItem.shipping?.logistic_type || 'other';

      // Check if item has variations - find the matching one by SELLER_SKU
      let matchedVariationId: number | null = null;
      let stockToUse = mlItem.available_quantity || 0;
      let matchedVariation: any = null;

      if (mlItem.variations && mlItem.variations.length > 0) {
        // Find the variation that matches this product's SKU
        for (const variation of mlItem.variations) {
          const fullDetails = variationDetailsMap.get(variation.id);
          const varSku = fullDetails ? getSellerSkuFromVariation(fullDetails) : null;

          if (varSku && varSku.toUpperCase() === product.internal_sku.toUpperCase()) {
            matchedVariationId = variation.id;
            matchedVariation = variation;
            stockToUse = variation.available_quantity ?? 0;
            console.log(`[Full Sync] Matched variation ${variation.id} (${varSku}) to product ${product.internal_sku}`);
            break;
          }
        }
      }

      // Get images - prefer variation-specific images if available
      let allImages: string[] = [];
      let imageUrl: string | null = null;

      if (matchedVariation?.picture_ids?.length > 0) {
        // Get variation-specific images by matching picture_ids with item pictures
        const variationPictureIds = new Set(matchedVariation.picture_ids);
        const variationPictures = mlItem.pictures?.filter((p: any) => variationPictureIds.has(p.id)) || [];
        allImages = variationPictures.map((p: any) => p.url).filter(Boolean);
        imageUrl = allImages[0] || null;
      }

      // Fallback to item-level images if no variation images
      if (allImages.length === 0) {
        allImages = mlItem.pictures?.map((p: any) => p.url).filter(Boolean) || [];
        imageUrl = allImages[0] || null;
      }

      const linkKey = `${mlItem.id}-${matchedVariationId || 'null'}-${product.product_id}`;
      const existingLink = existingLinksMap.get(linkKey);

      if (existingLink) {
        if (existingLink.logistic_type !== logisticType || existingLink.variation_id !== matchedVariationId) {
          linksToUpdate.push({
            id: existingLink.secondary_sku_id,
            logisticType,
            variationId: matchedVariationId,
          });
        }
      } else {
        linksToCreate.push({
          secondary_sku: mlItem.id,
          stock_quantity: stockToUse,
          publication_link: mlItem.permalink,
          logistic_type: logisticType,
          variation_id: matchedVariationId,
          product: { product_id: product.product_id },
          platform: { platform_id: 1 },
        });
      }

      // Queue product update (only once per product)
      if (!processedProducts.has(product.product_id)) {
        processedProducts.add(product.product_id);
        productsToUpdate.push({
          id: product.product_id,
          name: mlItem.title,
          imageUrl: imageUrl || undefined,
          images: allImages.length > 0 ? allImages : undefined,
          price: mlItem.price || undefined,
        });
      }

      // Track results
      if (imageUrl) {
        results.images.synced.push({
          internal_sku: product.internal_sku,
          ml_item_id: mlItem.id,
          variation_id: matchedVariationId,
          image_url: imageUrl,
          images_count: allImages.length,
          all_images: allImages,
        });
      } else {
        results.images.no_image.push({
          internal_sku: product.internal_sku,
          ml_item_id: mlItem.id,
          variation_id: matchedVariationId,
        });
      }

      results.discovery.matched.push({
        internal_sku: product.internal_sku,
        ml_item_id: mlItem.id,
        ml_title: mlItem.title,
        variation_id: matchedVariationId,
        logistic_type: logisticType,
        ml_stock: stockToUse,
        price: mlItem.price,
        permalink: mlItem.permalink,
        has_image: !!imageUrl,
        images_count: allImages.length,
        is_new_link: !existingLink,
      });
    }

    // Execute batch DB operations
    if (linksToCreate.length > 0) {
      console.log(`[Full Sync] Creating ${linksToCreate.length} new links...`);
      await this.secondarySkuRepository.save(linksToCreate);
    }

    for (const update of linksToUpdate) {
      await this.secondarySkuRepository.update(update.id, {
        logistic_type: update.logisticType as any,
        ...(update.variationId !== undefined && { variation_id: update.variationId }),
      });
    }

    // Update products in batches of 50
    for (let i = 0; i < productsToUpdate.length; i += 50) {
      const batch = productsToUpdate.slice(i, i + 50);
      await Promise.all(
        batch.map((p) =>
          this.productRepository.update(p.id, {
            name: p.name,
            ...(p.imageUrl && { image_url: p.imageUrl }),
            ...(p.images && { images: p.images }),
            ...(p.price !== undefined && { price: p.price }),
          }),
        ),
      );
    }

    // Summary
    const byLogistic = {
      fulfillment: results.discovery.matched.filter((m) => m.logistic_type === 'fulfillment').length,
      cross_docking: results.discovery.matched.filter((m) => m.logistic_type === 'cross_docking').length,
      xd_drop_off: results.discovery.matched.filter((m) => m.logistic_type === 'xd_drop_off').length,
      other: results.discovery.matched.filter((m) => !['fulfillment', 'cross_docking', 'xd_drop_off'].includes(m.logistic_type)).length,
    };

    console.log(`[Full Sync] Complete: ${results.discovery.matched.length} matched, ${results.discovery.not_found.length} not found`);

    return {
      summary: {
        total_local_products: localProducts.length,
        matched: results.discovery.matched.length,
        not_found_in_ml: results.discovery.not_found.length,
        skipped_paused: results.discovery.skipped_paused.length,
        errors: results.discovery.errors.length,
        images_synced: results.images.synced.length,
        images_missing: results.images.no_image.length,
        new_links_created: linksToCreate.length,
        links_updated: linksToUpdate.length,
        by_logistic_type: byLogistic,
      },
      ...results,
    };
  }
}
