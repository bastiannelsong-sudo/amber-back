import { Controller, Get, Put, Post, Body, Param, ParseIntPipe, Query } from '@nestjs/common';
import { MercadoLibreService } from './mercadolibre.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../products/entities/product.entity';
import { SecondarySku } from '../products/entities/secondary-sku.entity';
import { StockValidationSnapshot } from './entities/stock-validation-snapshot.entity';

@Controller('mercadolibre')
export class MercadoLibreController {
  constructor(
    private readonly mercadoLibreService: MercadoLibreService,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(SecondarySku)
    private readonly secondarySkuRepository: Repository<SecondarySku>,
    @InjectRepository(StockValidationSnapshot)
    private readonly snapshotRepository: Repository<StockValidationSnapshot>,
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
   * Supports caching: returns cached results unless force_refresh=true
   */
  @Get('stock/validate')
  async validateStock(
    @Query('seller_id', ParseIntPipe) sellerId: number,
    @Query('force_refresh') forceRefresh?: string,
  ) {
    const shouldRefresh = forceRefresh === 'true';

    // If NOT force_refresh, try to return cached snapshot
    if (!shouldRefresh) {
      const lastSnapshot = await this.snapshotRepository.findOne({
        where: { seller_id: sellerId },
        order: { created_at: 'DESC' },
      });

      if (lastSnapshot) {
        // Use stored ISO timestamp to avoid timezone conversion issues
        const cacheTimestamp = lastSnapshot.results_data?._timestamp_iso ||
          (lastSnapshot.created_at ? lastSnapshot.created_at.toISOString() : new Date().toISOString());
        console.log(`[StockValidation] 📦 Loading from cache (last updated: ${cacheTimestamp})`);
        return {
          summary: {
            total: lastSnapshot.total_items,
            matching: lastSnapshot.matching_count,
            discrepancies: lastSnapshot.discrepancy_count,
            errors: lastSnapshot.error_count,
          },
          ...lastSnapshot.results_data,
          metadata: {
            from_cache: true,
            last_updated: cacheTimestamp,
            execution_time_ms: lastSnapshot.execution_time_ms,
          },
        };
      }
    }

    // Execute fresh validation
    console.log(`[StockValidation] 🔄 Executing fresh validation for seller ${sellerId}`);
    const startTime = Date.now();

    // Get all products with ML secondary SKUs (platform_id = 1 for Mercado Libre)
    const secondarySkus = await this.secondarySkuRepository.find({
      where: { platform: { platform_id: 1 } }, // Mercado Libre
      relations: ['product', 'platform'],
    });

    if (secondarySkus.length === 0) {
      return {
        message: 'No hay productos vinculados a Mercado Libre',
        summary: {
          total: 0,
          matching: 0,
          discrepancies: 0,
          errors: 0,
        },
        matching: [],
        discrepancies: [],
        errors: [],
        metadata: {
          from_cache: false,
          last_updated: new Date(),
          execution_time_ms: 0,
        },
      };
    }

    // Prepare data for validation
    const localProducts = secondarySkus.map((sku) => ({
      product_id: sku.product.product_id,
      internal_sku: sku.product.internal_sku,
      name: sku.product.name,
      // Si es fulfillment (ML maneja el inventario), solo contar stock
      // Si es flex/otros (tú manejas inventario), contar stock + stock_bodega
      local_stock: sku.logistic_type === 'fulfillment'
        ? (sku.product.stock || 0)
        : (sku.product.stock || 0) + (sku.product.stock_bodega || 0),
      ml_item_id: sku.secondary_sku, // Este es el MLC... de ML
      logistic_type: sku.logistic_type, // Pass logistic_type to service
    }));

    const result = await this.mercadoLibreService.validateStockWithML(localProducts, sellerId);

    // Create a map of ml_item_id -> logistic_type for easy lookup
    const logisticTypeMap = new Map(
      secondarySkus.map(sku => [sku.secondary_sku, sku.logistic_type])
    );

    // Enrich results with logistic_type and stock details
    const enrichItem = (item: any) => ({
      ...item,
      logistic_type: logisticTypeMap.get(item.ml_item_id) || 'other',
      stock: secondarySkus.find(s => s.secondary_sku === item.ml_item_id)?.product.stock || 0,
      stock_bodega: secondarySkus.find(s => s.secondary_sku === item.ml_item_id)?.product.stock_bodega || 0,
      // Preserve stock breakdown fields
      ml_stock_flex: item.ml_stock_flex,
      ml_stock_full: item.ml_stock_full,
    });

    const enrichedMatching = result.matching.map(enrichItem);
    const enrichedDiscrepancies = result.discrepancies.map(enrichItem);
    const enrichedErrors = result.errors;

    // Log how many items have stock breakdown
    const itemsWithBreakdown = [...enrichedMatching, ...enrichedDiscrepancies].filter(
      item => item.ml_stock_flex != null || item.ml_stock_full != null
    );
    console.log(`[Controller] 📤 Sending ${itemsWithBreakdown.length} items with stock breakdown to frontend`);

    const executionTime = Date.now() - startTime;

    // Save snapshot to database
    const currentTimestamp = new Date().toISOString();
    const snapshot = this.snapshotRepository.create({
      seller_id: sellerId,
      total_items: localProducts.length,
      matching_count: enrichedMatching.length,
      discrepancy_count: enrichedDiscrepancies.length,
      error_count: enrichedErrors.length,
      results_data: {
        matching: enrichedMatching,
        discrepancies: enrichedDiscrepancies,
        errors: enrichedErrors,
        // Store ISO timestamp in results_data to avoid timezone issues
        _timestamp_iso: currentTimestamp,
      },
      execution_time_ms: executionTime,
    });

    const savedSnapshot = await this.snapshotRepository.save(snapshot);
    const timestamp = currentTimestamp;
    console.log(`[StockValidation] ✅ Saved snapshot_id: ${savedSnapshot.snapshot_id} (${localProducts.length} items, ${(executionTime / 1000).toFixed(1)}s)`);
    console.log(`[StockValidation] 🕐 Sending timestamp: ${timestamp}`);

    return {
      summary: {
        total: localProducts.length,
        matching: enrichedMatching.length,
        discrepancies: enrichedDiscrepancies.length,
        errors: enrichedErrors.length,
      },
      matching: enrichedMatching,
      discrepancies: enrichedDiscrepancies,
      errors: enrichedErrors,
      metadata: {
        from_cache: false,
        last_updated: timestamp,
        execution_time_ms: executionTime,
      },
    };
  }

  /**
   * Diagnose why a product doesn't appear in stock validation
   */
  @Get('stock/diagnose/:sku')
  async diagnoseProduct(
    @Param('sku') sku: string,
    @Query('seller_id', ParseIntPipe) sellerId: number,
  ) {
    console.log(`[Diagnose] 🔍 Investigating SKU: ${sku}`);

    // 1. Find product in database
    const product = await this.productRepository.findOne({
      where: { internal_sku: sku },
    });

    if (!product) {
      return {
        found: false,
        error: `Product with SKU ${sku} not found in database`,
        suggestion: 'Verify the SKU is correct',
      };
    }

    // 2. Find secondary SKU for Mercado Libre
    const secondarySku = await this.secondarySkuRepository.findOne({
      where: {
        product: { product_id: product.product_id },
        platform: { platform_id: 1 }, // Mercado Libre
      },
      relations: ['product', 'platform'],
    });

    if (!secondarySku) {
      return {
        found: true,
        product: {
          internal_sku: product.internal_sku,
          name: product.name,
          stock: product.stock,
          stock_bodega: product.stock_bodega,
        },
        linked_to_ml: false,
        error: 'Product not linked to Mercado Libre',
        suggestion: 'Add a secondary SKU for Mercado Libre (platform_id = 1)',
      };
    }

    // 3. Try to fetch from Mercado Libre
    let mlItemData: any = null;
    let mlError: string | null = null;

    try {
      mlItemData = await this.mercadoLibreService.getItem(
        secondarySku.secondary_sku,
        sellerId,
      );
    } catch (error: any) {
      mlError = error.message || 'Failed to fetch from ML';
    }

    // 4. Check if it's in latest snapshot
    const latestSnapshot = await this.snapshotRepository.findOne({
      where: { seller_id: sellerId },
      order: { created_at: 'DESC' },
    });

    let inSnapshot: 'matching' | 'discrepancies' | 'errors' | 'not_found' = 'not_found';
    if (latestSnapshot) {
      const allItems = [
        ...latestSnapshot.results_data.matching,
        ...latestSnapshot.results_data.discrepancies,
        ...latestSnapshot.results_data.errors,
      ];
      const foundItem = allItems.find(
        (item: any) => item.internal_sku === sku || item.ml_item_id === secondarySku.secondary_sku
      );

      if (foundItem) {
        if (latestSnapshot.results_data.matching.some((i: any) => i.internal_sku === sku)) {
          inSnapshot = 'matching';
        } else if (latestSnapshot.results_data.discrepancies.some((i: any) => i.internal_sku === sku)) {
          inSnapshot = 'discrepancies';
        } else if (latestSnapshot.results_data.errors.some((i: any) => i.internal_sku === sku)) {
          inSnapshot = 'errors';
        }
      }
    }

    // 5. Build diagnosis
    const diagnosis: any = {
      found: true,
      linked_to_ml: true,
      product: {
        internal_sku: product.internal_sku,
        name: product.name,
        stock: product.stock,
        stock_bodega: product.stock_bodega,
        stock_total: product.stock + (product.stock_bodega || 0),
      },
      ml_link: {
        secondary_sku: secondarySku.secondary_sku,
        ml_item_id: `MLC-${secondarySku.secondary_sku}`,
        publication_link: secondarySku.publication_link,
        logistic_type: secondarySku.logistic_type,
        variation_id: secondarySku.variation_id,
      },
      ml_status: mlItemData ? {
        exists: true,
        status: mlItemData.status,
        available_quantity: mlItemData.available_quantity,
        sold_quantity: mlItemData.sold_quantity,
        has_variations: mlItemData.variations?.length > 0,
        variations_count: mlItemData.variations?.length || 0,
      } : {
        exists: false,
        error: mlError,
      },
      validation_snapshot: {
        exists: !!latestSnapshot,
        last_validation: latestSnapshot?.created_at,
        in_results: inSnapshot,
      },
    };

    // 6. Add possible reasons if not found in results
    if (inSnapshot === 'not_found' && latestSnapshot) {
      diagnosis.possible_reasons = [];

      if (mlItemData?.status === 'paused' || mlItemData?.status === 'closed') {
        diagnosis.possible_reasons.push({
          reason: 'Item is PAUSED or CLOSED in Mercado Libre',
          detail: `Status: ${mlItemData.status}. Paused items are skipped during validation.`,
          solution: 'Activate the item in Mercado Libre',
        });
      }

      if (!mlItemData?.variations || mlItemData.variations.length === 0) {
        const hasUserProductId = mlItemData?.user_product_id || mlItemData?.catalog_product_id;
        if (!hasUserProductId) {
          diagnosis.possible_reasons.push({
            reason: 'No user_product_id and no variations in ML',
            detail: 'Cannot fetch stock breakdown without user_product_id or variations from ML API',
            solution: 'Check if item has variations in ML or if ML provides user_product_id',
          });
        }
      }

      if (mlItemData?.variations?.length > 0) {
        const variationsWithUserProductId = mlItemData.variations.filter(
          (v: any) => v.user_product_id
        );
        if (variationsWithUserProductId.length === 0) {
          diagnosis.possible_reasons.push({
            reason: 'Variations exist but none have user_product_id',
            detail: `Found ${mlItemData.variations.length} variations, but none have user_product_id`,
            solution: 'ML API issue or variations not properly configured',
          });
        }
      }

      if (mlError) {
        diagnosis.possible_reasons.push({
          reason: 'Error fetching from Mercado Libre API',
          detail: mlError,
          solution: 'Check ML API credentials and item permissions',
        });
      }
    }

    return diagnosis;
  }

  /**
   * Test ML Search API - Diagnose why sync doesn't find a product
   * Tests the actual ML search that the sync uses
   */
  @Get('stock/test-search/:sku')
  async testMLSearch(
    @Param('sku') sku: string,
    @Query('seller_id', ParseIntPipe) sellerId: number,
  ) {
    console.log(`[Test Search] 🔍 Testing ML search for SKU: ${sku}`);

    const result: any = {
      sku,
      seller_id: sellerId,
      search_result: null,
      items_found: [],
      variations_with_seller_sku: [],
      diagnosis: {
        search_works: false,
        items_count: 0,
        has_matching_variation: false,
        reason: null,
      },
    };

    try {
      // Step 1: Test the search
      console.log(`[Test Search] Step 1: Calling searchItemsBySku("${sku}", ${sellerId})`);
      const searchResult = await this.mercadoLibreService.searchItemsBySku(sku, sellerId);
      result.search_result = searchResult;

      if (!searchResult || !searchResult.results || searchResult.results.length === 0) {
        result.diagnosis.search_works = false;
        result.diagnosis.reason = `La búsqueda ML /users/${sellerId}/items/search?seller_sku=${sku} no devolvió resultados. ` +
          `Esto significa que el SELLER_SKU no está configurado en el item o sus variaciones en Mercado Libre.`;
        console.log(`[Test Search] ❌ No results found`);
        return result;
      }

      result.diagnosis.search_works = true;
      result.diagnosis.items_count = searchResult.results.length;
      result.items_found = searchResult.results;

      console.log(`[Test Search] ✅ Found ${searchResult.results.length} items`);

      // Step 2: For each item, get full details and check variations
      for (const itemId of searchResult.results) {
        console.log(`[Test Search] Step 2: Fetching item details for ${itemId}`);

        try {
          const itemData = await this.mercadoLibreService.getItem(itemId, sellerId);

          if (itemData.variations && itemData.variations.length > 0) {
            console.log(`[Test Search] Item ${itemId} has ${itemData.variations.length} variations, checking each...`);

            // Fetch each variation's details to get SELLER_SKU
            for (const variation of itemData.variations) {
              try {
                const varDetails = await this.mercadoLibreService.getVariationById(
                  itemId,
                  variation.id,
                  sellerId,
                );

                const sellerSku = varDetails?.attributes?.find((a: any) => a.id === 'SELLER_SKU')?.value_name;

                result.variations_with_seller_sku.push({
                  item_id: itemId,
                  variation_id: variation.id,
                  seller_sku: sellerSku || null,
                  matches: sellerSku?.toUpperCase() === sku.toUpperCase(),
                  stock: variation.available_quantity,
                });

                if (sellerSku?.toUpperCase() === sku.toUpperCase()) {
                  result.diagnosis.has_matching_variation = true;
                  console.log(`[Test Search] ✅ Variation ${variation.id} has SELLER_SKU = "${sellerSku}" (MATCH)`);
                }
              } catch (error) {
                console.log(`[Test Search] ⚠️  Error fetching variation ${variation.id}:`, error.message);
              }
            }
          } else {
            console.log(`[Test Search] Item ${itemId} has no variations`);
          }
        } catch (error) {
          console.log(`[Test Search] ⚠️  Error fetching item ${itemId}:`, error.message);
        }
      }

      // Diagnosis summary
      if (result.diagnosis.has_matching_variation) {
        result.diagnosis.reason = `✅ TODO CORRECTO: La búsqueda encuentra el item y tiene variación con SELLER_SKU="${sku}". ` +
          `El sync DEBERÍA vincular correctamente. Si no lo hace, revisa los logs del sync.`;
      } else {
        result.diagnosis.reason = `⚠️  PROBLEMA: La búsqueda encuentra items pero ninguna variación tiene SELLER_SKU="${sku}". ` +
          `Necesitas configurar el SELLER_SKU en ML para que el sync pueda hacer el match.`;
      }

    } catch (error) {
      result.diagnosis.reason = `❌ ERROR: ${error.message}`;
      console.error(`[Test Search] Error:`, error.message);
    }

    return result;
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
      // Si es fulfillment (ML maneja el inventario), solo enviar stock
      // Si es flex/otros (tú manejas inventario), enviar stock + stock_bodega
      const totalStock = sku.logistic_type === 'fulfillment'
        ? (sku.product.stock || 0)
        : (sku.product.stock || 0) + (sku.product.stock_bodega || 0);
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
        // Calcular oldStock según tipo de logística
        const oldStock = sku.logistic_type === 'fulfillment'
          ? (sku.product.stock || 0)
          : (sku.product.stock || 0) + (sku.product.stock_bodega || 0);
        const newStock = mlItem.available_quantity || 0;
        const imageUrl = mlItem.pictures?.[0]?.url || null;

        // Update local product stock and image
        // Si es fulfillment: actualizar stock y limpiar stock_bodega
        // Si es flex/otros: actualizar solo stock, mantener stock_bodega
        await this.productRepository.update(sku.product.product_id, {
          stock: newStock,
          ...(sku.logistic_type === 'fulfillment' && { stock_bodega: 0 }),
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

        // 🔍 LOG DETALLADO para PCR0008
        if (product.internal_sku === 'PCR0008' || product.internal_sku === 'PCR0007') {
          console.log(`\n${'='.repeat(70)}`);
          console.log(`🔍 [PCR0008] Step 1: Búsqueda en ML`);
          console.log(`   SKU buscado: "${product.internal_sku}"`);
          console.log(`   Resultado de búsqueda:`, searchResult);
          console.log(`   Items encontrados: ${searchResult?.results?.length || 0}`);
          if (searchResult?.results?.length > 0) {
            console.log(`   IDs: ${searchResult.results.join(', ')}`);
          } else {
            console.log(`   ❌ NO ENCONTRADO - La búsqueda ML no devolvió items`);
            console.log(`   Posible causa: SELLER_SKU no configurado en ML`);
          }
          console.log(`${'='.repeat(70)}\n`);
        }

        return { product, itemIds: searchResult?.results || [] };
      },
      CONCURRENCY,
    );

    // Collect all item IDs and map to products
    // FIXED: Changed to Map<string, Product[]> to support multiple products per item
    // (e.g., PCR0007, PCR0008, PCR0009 all map to the same ML item)
    const itemToProductMap = new Map<string, Product[]>();
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
        // Add product to array instead of overwriting
        const existingProducts = itemToProductMap.get(itemId) || [];
        existingProducts.push(product);
        itemToProductMap.set(itemId, existingProducts);

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
      const products = itemToProductMap.get(mlItem.id);
      if (!products || products.length === 0) continue;

      // Skip paused, closed, or inactive items - only sync active ones
      if (mlItem.status !== 'active') {
        for (const product of products) {
          results.discovery.skipped_paused.push({
            internal_sku: product.internal_sku,
            ml_item_id: mlItem.id,
            ml_title: mlItem.title,
            status: mlItem.status,
          });
        }
        continue;
      }

      // FIXED: Process each product that maps to this item
      for (const product of products) {

      const logisticType = mlItem.shipping?.logistic_type || 'other';

      // Check if item has variations - find the matching one by SELLER_SKU
      let matchedVariationId: number | null = null;
      let stockToUse = mlItem.available_quantity || 0;
      let matchedVariation: any = null;

      if (mlItem.variations && mlItem.variations.length > 0) {
        // 🔍 LOG DETALLADO para PCR0008
        if (product.internal_sku === 'PCR0008' || product.internal_sku === 'PCR0007') {
          console.log(`\n${'='.repeat(70)}`);
          console.log(`🔍 [PCR0008] Step 3: Procesando Item ${mlItem.id}`);
          console.log(`   Título ML: "${mlItem.title}"`);
          console.log(`   Status: ${mlItem.status}`);
          console.log(`   Logistic Type: ${logisticType}`);
          console.log(`   Variaciones totales: ${mlItem.variations.length}`);
          console.log(`${'='.repeat(70)}`);
        }

        // Find the variation that matches this product's SKU
        for (const variation of mlItem.variations) {
          const fullDetails = variationDetailsMap.get(variation.id);
          const varSku = fullDetails ? getSellerSkuFromVariation(fullDetails) : null;

          // 🔍 LOG DETALLADO para PCR0008
          if (product.internal_sku === 'PCR0008' || product.internal_sku === 'PCR0007') {
            console.log(`\n   📦 Variación ${variation.id}:`);
            console.log(`      - Detalles obtenidos: ${fullDetails ? '✅ Sí' : '❌ No'}`);
            console.log(`      - SELLER_SKU: ${varSku ? `"${varSku}"` : '❌ NULL'}`);
            console.log(`      - Match con "PCR0008": ${varSku?.toUpperCase() === 'PCR0008' ? '✅ SÍ' : '❌ NO'}`);
            console.log(`      - Stock: ${variation.available_quantity ?? 0}`);
          }

          if (varSku && varSku.toUpperCase() === product.internal_sku.toUpperCase()) {
            matchedVariationId = variation.id;
            matchedVariation = variation;
            stockToUse = variation.available_quantity ?? 0;
            console.log(`[Full Sync] Matched variation ${variation.id} (${varSku}) to product ${product.internal_sku}`);

            // 🔍 LOG DETALLADO para PCR0008
            if (product.internal_sku === 'PCR0008' || product.internal_sku === 'PCR0007') {
              console.log(`\n   ✅ MATCH ENCONTRADO!`);
              console.log(`      - Variation ID seleccionada: ${matchedVariationId}`);
              console.log(`      - Stock a usar: ${stockToUse}`);
            }

            break;
          }
        }

        // 🔍 LOG DETALLADO para PCR0008
        if (product.internal_sku === 'PCR0008' || product.internal_sku === 'PCR0007') {
          if (!matchedVariationId) {
            console.log(`\n   ❌ NO SE ENCONTRÓ MATCH`);
            console.log(`   Ninguna variación tiene SELLER_SKU = "PCR0008"`);
            console.log(`   El secondary_sku NO se creará para este producto.`);
          }
          console.log(`${'='.repeat(70)}\n`);
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

          // 🔍 LOG DETALLADO para PCR0008
          if (product.internal_sku === 'PCR0008' || product.internal_sku === 'PCR0007') {
            console.log(`\n${'='.repeat(70)}`);
            console.log(`🔍 [PCR0008] Step 4: Actualizando link existente`);
            console.log(`   Secondary SKU ID: ${existingLink.secondary_sku_id}`);
            console.log(`   Logistic Type: ${logisticType}`);
            console.log(`   Variation ID: ${matchedVariationId}`);
            console.log(`${'='.repeat(70)}\n`);
          }
        } else {
          // 🔍 LOG DETALLADO para PCR0008
          if (product.internal_sku === 'PCR0008' || product.internal_sku === 'PCR0007') {
            console.log(`\n${'='.repeat(70)}`);
            console.log(`🔍 [PCR0008] Step 4: Link ya existe y está actualizado`);
            console.log(`   Secondary SKU ID: ${existingLink.secondary_sku_id}`);
            console.log(`   No requiere cambios`);
            console.log(`${'='.repeat(70)}\n`);
          }
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

        // 🔍 LOG DETALLADO para PCR0008
        if (product.internal_sku === 'PCR0008' || product.internal_sku === 'PCR0007') {
          console.log(`\n${'='.repeat(70)}`);
          console.log(`🔍 [PCR0008] Step 4: Creando nuevo link`);
          console.log(`   ML Item ID: ${mlItem.id}`);
          console.log(`   Variation ID: ${matchedVariationId || 'NULL'}`);
          console.log(`   Product ID: ${product.product_id}`);
          console.log(`   Logistic Type: ${logisticType}`);
          console.log(`   Stock: ${stockToUse}`);
          console.log(`   ✅ Se agregará a la cola de creación`);
          console.log(`${'='.repeat(70)}\n`);
        }
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
      } // End of: for (const product of products)
    } // End of: for (const mlItem of mlItems)

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
