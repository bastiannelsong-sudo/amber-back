import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ProductAudit } from './entities/product-audit.entity';
import { Product } from '../products/entities/product.entity';
import { InventoryService, MappedProduct } from '../products/services/inventory.service';
import { PendingSalesService } from './services/pending-sales.service';
import { Platform } from '../products/entities/platform.entity';
import { EventEmitter2 } from '@nestjs/event-emitter';

interface FalabellaOrderItem {
  sku: string;
  shop_sku: string;
  name: string;
  quantity: number;
  unit_price: number;
  currency: string;
}

export interface FalabellaNotificationPayload {
  order_id: string;
  order_number: string;
  status: string;
  items: FalabellaOrderItem[];
  sale_date: string;
}

@Injectable()
export class FalabellaNotificationService {
  private readonly logger = new Logger(FalabellaNotificationService.name);
  private falabellaPlatformId: number | null = null;

  constructor(
    @InjectRepository(ProductAudit)
    private readonly productAuditRepository: Repository<ProductAudit>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    private readonly dataSource: DataSource,
    private readonly inventoryService: InventoryService,
    private readonly pendingSalesService: PendingSalesService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private async getFalabellaPlatformId(): Promise<number | null> {
    if (this.falabellaPlatformId !== null) return this.falabellaPlatformId;

    const platformRepo = this.dataSource.getRepository(Platform);
    const platform = await platformRepo.findOne({
      where: { platform_name: 'Falabella' },
    });

    if (platform) {
      this.falabellaPlatformId = platform.platform_id;
    }

    return this.falabellaPlatformId;
  }

  async processNotification(payload: FalabellaNotificationPayload): Promise<any> {
    const { order_id, items, sale_date, status } = payload;

    this.logger.log(`Procesando notificación Falabella: orden ${order_id}, status ${status}, ${items.length} items`);

    // Idempotency: si ya fue procesada, omitir
    const existingAudit = await this.productAuditRepository.findOne({
      where: { order_id: parseInt(order_id), platform_name: 'Falabella' },
    });

    if (existingAudit) {
      this.logger.log(`Orden Falabella ${order_id} ya fue procesada, omitiendo`);
      return { message: 'Order already processed', order_id };
    }

    const platformId = await this.getFalabellaPlatformId();
    const results = [];

    for (const item of items) {
      const result = await this.handleItemInventory(order_id, item, platformId, sale_date);
      results.push(result);
    }

    // Emitir evento SSE para clientes conectados
    this.eventEmitter.emit('notification.processed', {
      event_type: 'falabella_order',
      summary: `Venta Falabella: ${items.map(i => `${i.name} x${i.quantity}`).join(', ')}`,
      order_id: order_id,
      order_status: status,
      platform: 'Falabella',
    });

    return { message: 'Processed', order_id, results };
  }

  private async handleItemInventory(
    orderId: string,
    item: FalabellaOrderItem,
    platformId: number | null,
    saleDate: string,
  ): Promise<any> {
    const { sku, shop_sku, name, quantity } = item;

    // Resolver productos mapeados (puede ser multiples)
    let mappedProducts: MappedProduct[] = [];

    if (platformId) {
      mappedProducts = await this.inventoryService.findProductsBySku(platformId, sku);
      if (mappedProducts.length === 0 && shop_sku) {
        mappedProducts = await this.inventoryService.findProductsBySku(platformId, shop_sku);
      }
    }

    // Fallback: buscar directamente por internal_sku
    if (mappedProducts.length === 0) {
      const product = await this.productRepository.findOne({
        where: [{ internal_sku: sku }, ...(shop_sku ? [{ internal_sku: shop_sku }] : [])],
        relations: ['secondarySkus'],
      });
      if (product) {
        mappedProducts = [{ product, quantity: 1 }];
      }
    }

    // No se encontro ningun producto
    if (mappedProducts.length === 0) {
      if (platformId) {
        try {
          await this.pendingSalesService.create({
            platform_id: platformId,
            platform_order_id: orderId,
            platform_sku: sku || shop_sku,
            quantity: quantity,
            sale_date: new Date(saleDate),
            raw_data: { item, order_id: orderId },
          });
          this.logger.log(`PendingSale creado para orden Falabella ${orderId}, SKU: ${sku}`);
        } catch (error) {
          this.logger.warn(`No se pudo crear PendingSale: ${error.message}`);
        }
      }
      await this.createAudit(orderId, sku, shop_sku, 'NOT_FOUND', 0, 'SKU no encontrado en el inventario');
      return { sku, status: 'NOT_FOUND' };
    }

    // Validar stock de TODOS los productos antes de descontar
    for (const { product, quantity: mappingQty } of mappedProducts) {
      const totalNeeded = quantity * mappingQty;
      const hasStock = await this.inventoryService.validateStockAvailability(product.product_id, totalNeeded);
      if (!hasStock) {
        await this.createAudit(orderId, sku, shop_sku, 'NOT_FOUND', 0, `Stock insuficiente en producto ${product.internal_sku} para descontar ${totalNeeded} unidades`);
        return { sku, status: 'INSUFFICIENT_STOCK' };
      }
    }

    // Todo validado: descontar TODOS los productos
    const results = [];
    for (const { product, quantity: mappingQty } of mappedProducts) {
      const totalToDeduct = quantity * mappingQty;
      const metadata = {
        change_type: 'order' as const,
        changed_by: 'Sistema Falabella',
        change_reason: `Venta orden Falabella #${orderId}`,
        platform_id: platformId || undefined,
        platform_order_id: orderId,
      };
      try {
        await this.inventoryService.deductStock(product.product_id, totalToDeduct, metadata);
        await this.createAudit(orderId, sku, shop_sku, 'OK_INTERNO', totalToDeduct);
        this.logger.log(`Stock descontado: producto ${product.internal_sku}, cantidad ${totalToDeduct}, orden Falabella ${orderId}`);
        results.push({ sku: product.internal_sku, status: 'OK_INTERNO', product_id: product.product_id });
      } catch (error) {
        this.logger.error(`Error descontando stock para orden Falabella ${orderId}: ${error.message}`);
        await this.createAudit(orderId, sku, shop_sku, 'NOT_FOUND', 0, `Error descontando stock: ${error.message}`);
        results.push({ sku: product.internal_sku, status: 'ERROR' });
      }
    }

    return { sku, status: 'OK_INTERNO', products: results };
  }

  private async createAudit(
    orderId: string,
    sku: string,
    shopSku: string,
    status: 'OK_INTERNO' | 'OK_FULL' | 'NOT_FOUND' | 'CANCELLED',
    quantityDiscounted: number,
    errorMessage?: string,
  ): Promise<void> {
    const audit = this.productAuditRepository.create({
      order_id: parseInt(orderId),
      internal_sku: sku,
      secondary_sku: shopSku,
      status,
      quantity_discounted: quantityDiscounted,
      error_message: errorMessage || null,
      logistic_type: 'falabella_standard',
      platform_name: 'Falabella',
    });

    await this.productAuditRepository.save(audit);
  }
}
