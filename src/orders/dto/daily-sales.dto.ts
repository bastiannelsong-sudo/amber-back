import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumberString,
  Matches,
  IsNotEmpty,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

/**
 * Enum for logistic types (shipping methods)
 */
export enum LogisticTypeEnum {
  FULFILLMENT = 'fulfillment',
  CROSS_DOCKING = 'cross_docking',
  OTHER = 'other',
}

/**
 * Enum for date classification mode
 * - sii: ML/SII -04:00 timezone (orders between 00:00-00:59 local time shift to previous day in summer)
 * - mercado_libre: Chilean local timezone, no offset (midnight = midnight)
 */
export enum DateModeEnum {
  SII = 'sii',
  MERCADO_LIBRE = 'mercado_libre',
}

/**
 * Enum for status filter
 * - all: Show all orders (default)
 * - active: Only active orders (not cancelled/mediation/refunded)
 * - cancelled: Only cancelled orders
 * - in_mediation: Only orders in mediation
 * - refunded: Only refunded/returned orders
 * - inactive: All inactive orders (cancelled + mediation + refunded)
 */
export enum StatusFilterEnum {
  ALL = 'all',
  ACTIVE = 'active',
  CANCELLED = 'cancelled',
  IN_MEDIATION = 'in_mediation',
  REFUNDED = 'refunded',
  INACTIVE = 'inactive',
}

/**
 * Query DTO for daily sales endpoint
 * Applies: security-validate-all-input
 */
export class GetDailySalesQueryDto {
  @IsString()
  @IsNotEmpty({ message: 'La fecha es obligatoria' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Formato de fecha inválido. Use YYYY-MM-DD',
  })
  date: string;

  @IsNumberString({}, { message: 'seller_id debe ser un número válido' })
  @IsNotEmpty({ message: 'El seller_id es obligatorio' })
  seller_id: string;

  @IsOptional()
  @IsEnum(LogisticTypeEnum, {
    message: 'logistic_type debe ser: fulfillment, cross_docking, o other',
  })
  logistic_type?: LogisticTypeEnum;

  @IsOptional()
  @IsEnum(DateModeEnum, {
    message: 'date_mode debe ser: sii o mercado_libre',
  })
  date_mode?: DateModeEnum = DateModeEnum.SII;
}

/**
 * Item summary within an order
 */
export class OrderItemSummaryDto {
  item_id: string;
  title: string;
  quantity: number;
  unit_price: number;
  seller_sku: string;
  thumbnail: string | null;
}

/**
 * Single order with calculated metrics
 */
export class OrderSummaryDto {
  id: number;
  date_created: Date;
  date_approved: Date;
  status: string;
  is_cancelled: boolean; // True if order was cancelled/refunded/in_mediation (shown in list but not counted in sums)
  cancellation_type: 'cancelled' | 'in_mediation' | 'refunded' | null; // Specific reason: cancelada, mediación, devolución
  shipment_status: string | null; // Estado del envío (delivered, shipped, etc.) - para detectar pérdidas en reembolsos post-entrega
  total_amount: number;
  paid_amount: number;
  logistic_type: string;
  logistic_type_label: string;
  pack_id: number | null;

  @Type(() => OrderItemSummaryDto)
  items: OrderItemSummaryDto[];

  shipping_cost: number;
  courier_cost: number; // Costo externo del courier (para envíos gratis >$20k) - NO se muestra en columna Envío
  marketplace_fee: number;
  iva_amount: number;
  shipping_bonus: number; // Bonificación por envío de ML (para envíos gratis >$20k)
  flex_shipping_cost: number; // External flex shipping cost (net, without IVA)
  gross_amount: number;
  total_fees: number;
  net_profit: number;
  profit_margin: number;
  buyer?: {
    id: number;
    nickname: string;
    first_name: string;
    last_name: string;
    // Datos del destinatario del envío
    receiver_name?: string;
    receiver_phone?: string;
    receiver_rut?: string;
  };
}

/**
 * Summary for a logistic type (Full/Flex/Normal)
 */
export class LogisticTypeSummaryDto {
  logistic_type: string;
  logistic_type_label: string;
  total_orders: number;
  total_items: number;
  gross_amount: number;
  shipping_cost: number;
  marketplace_fee: number;
  iva_amount: number;
  shipping_bonus: number; // Total bonificación por envío de ML for this type
  flex_shipping_cost: number; // Total external flex shipping cost for this type
  courier_cost: number; // Total courier cost for free shipping >$20k orders
  total_fees: number;
  net_profit: number;
  average_order_value: number;
  average_profit_margin: number;
  cancelled_count: number; // Number of pure cancelled orders (order.status === 'cancelled')
  cancelled_amount: number; // Sum of gross_amount of pure cancelled orders
  mediation_count: number; // Number of orders in mediation (payment.status === 'in_mediation')
  mediation_amount: number; // Sum of gross_amount of orders in mediation
  refunded_count: number; // Number of refunded/returned orders (payment.status === 'refunded')
  refunded_amount: number; // Sum of gross_amount of refunded orders
}

/**
 * Overall day summary
 */
export class DailySalesSummaryDto {
  total_orders: number;
  total_items: number;
  gross_amount: number;
  shipping_cost: number;
  marketplace_fee: number;
  iva_amount: number;
  shipping_bonus: number; // Total bonificación por envío de ML for the day
  flex_shipping_cost: number; // Total external flex shipping cost for the day
  courier_cost: number; // Total courier cost for free shipping >$20k orders
  total_fees: number;
  net_profit: number;
  average_order_value: number;
  average_profit_margin: number;
  cancelled_count: number; // Number of pure cancelled orders
  cancelled_amount: number; // Sum of gross_amount of pure cancelled orders
  mediation_count: number; // Number of orders in mediation
  mediation_amount: number; // Sum of gross_amount of orders in mediation
  refunded_count: number; // Number of refunded/returned orders
  refunded_amount: number; // Sum of gross_amount of refunded orders
}

/**
 * Logistic type breakdown in response
 */
export class LogisticTypeBreakdownDto {
  @Type(() => LogisticTypeSummaryDto)
  fulfillment: LogisticTypeSummaryDto;

  @Type(() => LogisticTypeSummaryDto)
  cross_docking: LogisticTypeSummaryDto;

  @Type(() => LogisticTypeSummaryDto)
  other: LogisticTypeSummaryDto;
}

/**
 * Orders grouped by logistic type
 */
export class OrdersByLogisticTypeDto {
  @Type(() => OrderSummaryDto)
  fulfillment: OrderSummaryDto[];

  @Type(() => OrderSummaryDto)
  cross_docking: OrderSummaryDto[];

  @Type(() => OrderSummaryDto)
  other: OrderSummaryDto[];
}

/**
 * Complete response DTO for daily sales endpoint
 */
export class DailySalesResponseDto {
  date: string;
  seller_id: number;

  @Type(() => DailySalesSummaryDto)
  summary: DailySalesSummaryDto;

  @Type(() => LogisticTypeBreakdownDto)
  by_logistic_type: LogisticTypeBreakdownDto;

  @Type(() => OrdersByLogisticTypeDto)
  orders: OrdersByLogisticTypeDto;
}

/**
 * Query DTO for sync orders endpoint
 * Applies: security-validate-all-input
 */
export class SyncOrdersQueryDto {
  @IsString()
  @IsNotEmpty({ message: 'La fecha es obligatoria' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Formato de fecha inválido. Use YYYY-MM-DD',
  })
  date: string;

  @IsNumberString({}, { message: 'seller_id debe ser un número válido' })
  @IsNotEmpty({ message: 'El seller_id es obligatorio' })
  seller_id: string;
}

/**
 * Info del tier Fazt después del recálculo post-sync
 */
export class FaztTierInfoDto {
  shipments_count: number;
  rate_per_shipment: number;
  total_updated: number;
  year_month: string;
}

/**
 * Response DTO for sync orders endpoint
 */
export class SyncOrdersResponseDto {
  synced: number;
  message: string;
  date: string;
  seller_id: number;
  fazt_tier?: FaztTierInfoDto | null;
}

/**
 * Query DTO for monthly sync endpoint
 * Applies: security-validate-all-input
 */
export class SyncMonthlyOrdersQueryDto {
  @IsString()
  @IsNotEmpty({ message: 'El mes es obligatorio' })
  @Matches(/^\d{4}-\d{2}$/, {
    message: 'Formato de mes inválido. Use YYYY-MM',
  })
  year_month: string;

  @IsNumberString({}, { message: 'seller_id debe ser un número válido' })
  @IsNotEmpty({ message: 'El seller_id es obligatorio' })
  seller_id: string;
}

/**
 * Response DTO for monthly sync endpoint
 */
export class SyncMonthlyOrdersResponseDto {
  total_synced: number;
  days_processed: number;
  message: string;
  year_month: string;
  seller_id: number;
  details: { date: string; synced: number }[];
}

/**
 * Query DTO for date range sales endpoint
 * Supports both single day (from_date = to_date) and date ranges
 * Applies: security-validate-all-input
 */
export class GetDateRangeSalesQueryDto {
  @IsString()
  @IsNotEmpty({ message: 'La fecha inicial es obligatoria' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Formato de fecha inicial inválido. Use YYYY-MM-DD',
  })
  from_date: string;

  @IsString()
  @IsNotEmpty({ message: 'La fecha final es obligatoria' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Formato de fecha final inválido. Use YYYY-MM-DD',
  })
  to_date: string;

  @IsNumberString({}, { message: 'seller_id debe ser un número válido' })
  @IsNotEmpty({ message: 'El seller_id es obligatorio' })
  seller_id: string;

  @IsOptional()
  @IsEnum(LogisticTypeEnum, {
    message: 'logistic_type debe ser: fulfillment, cross_docking, o other',
  })
  logistic_type?: LogisticTypeEnum;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt({ message: 'page debe ser un número entero' })
  @Min(1, { message: 'page debe ser mayor o igual a 1' })
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt({ message: 'limit debe ser un número entero' })
  @Min(1, { message: 'limit debe ser mayor o igual a 1' })
  @Max(10000, { message: 'limit no puede ser mayor a 10000' })
  limit?: number = 20;

  @IsOptional()
  @IsEnum(DateModeEnum, {
    message: 'date_mode debe ser: sii o mercado_libre',
  })
  date_mode?: DateModeEnum = DateModeEnum.SII;

  @IsOptional()
  @IsEnum(StatusFilterEnum, {
    message: 'status_filter debe ser: all, active, cancelled, in_mediation, refunded, o inactive',
  })
  status_filter?: StatusFilterEnum = StatusFilterEnum.ALL;
}

/**
 * Pagination metadata DTO
 */
export class PaginationMetaDto {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}

/**
 * Response DTO for date range sales endpoint
 */
export class DateRangeSalesResponseDto {
  from_date: string;
  to_date: string;
  seller_id: number;
  days_count: number;

  @Type(() => DailySalesSummaryDto)
  summary: DailySalesSummaryDto;

  @Type(() => LogisticTypeBreakdownDto)
  by_logistic_type: LogisticTypeBreakdownDto;

  @Type(() => OrdersByLogisticTypeDto)
  orders: OrdersByLogisticTypeDto;

  @Type(() => PaginationMetaDto)
  pagination?: PaginationMetaDto;
}

/**
 * Pack group DTO - groups orders that share the same pack_id
 * Single orders (without pack_id) are treated as their own "pack"
 */
export class PackGroupDto {
  pack_id: number | null; // null for single orders without pack

  // Pack-level aggregated values (sum of all orders in pack)
  pack_total_amount: number;
  pack_shipping_cost: number; // Shipping cost/income (once per pack, NOT summed)
  pack_marketplace_fee: number;
  pack_iva_amount: number;
  pack_shipping_bonus: number;
  pack_flex_shipping_cost: number; // Fazt cost (once per pack)
  pack_courier_cost: number; // Courier cost for free shipping (once per pack)
  pack_net_profit: number;
  pack_profit_margin: number;

  // Logistic type (same for all orders in pack)
  logistic_type: string;
  logistic_type_label: string;

  // Date (from first order)
  date_approved: Date;

  // Status (combined - if any is cancelled, show as cancelled)
  status: string;
  is_cancelled: boolean;
  cancellation_type: 'cancelled' | 'in_mediation' | 'refunded' | null;
  shipment_status: string | null; // Estado del envío (delivered, shipped, etc.) - para detectar pérdidas

  // Buyer info (same for all orders in pack)
  buyer?: {
    id: number;
    nickname: string;
    first_name: string;
    last_name: string;
    receiver_name?: string;
    receiver_phone?: string;
    receiver_rut?: string;
  };

  // All orders in this pack
  @Type(() => OrderSummaryDto)
  orders: OrderSummaryDto[];

  // All items across all orders in pack (flattened for easy display)
  @Type(() => OrderItemSummaryDto)
  all_items: OrderItemSummaryDto[];
}

/**
 * Response DTO for audit summary (reconciliation report).
 *
 * Cruza las órdenes de un día con los registros de auditoría de inventario
 * para detectar órdenes que nunca fueron procesadas (sin descuento).
 */
export class AuditSummaryResponseDto {
  date: string;
  seller_id: number;
  total_orders: number; // Total órdenes de ML para ese día
  inventory_deducted: number; // OK_INTERNO - stock descontado del inventario
  fulfillment: number; // Logistic type fulfillment — ML maneja stock, no requiere descuento local
  not_found: number; // NOT_FOUND - webhook procesó pero SKU no mapeado
  without_audit: number; // Sin auditoría (excluye full/canceladas/null) = orden nunca procesada y requiere atención
  pending_mapping: number; // Ventas pendientes de resolución manual
  cancelled: number; // CANCELLED - órdenes canceladas (stock restaurado)
  missing_logistics_data: number; // Órdenes sin logistic_type (NULL) - no se pudo obtener info de envío
  already_mapped: number; // Órdenes cuyas pending_sales ya fueron procesadas/mapeadas
  tracking_active: boolean; // true si la fecha está dentro del período de seguimiento (>= MIN_APPROVED_DATE)
}

/**
 * DTO for an unprocessed order (sin auditoría).
 * Incluye items para que el usuario pueda ver qué SKUs faltan.
 */
export class UnprocessedOrderItemDto {
  title: string;
  seller_sku: string;
  quantity: number;
  unit_price: number;
  thumbnail: string | null;
}

export class UnprocessedOrderDto {
  order_id: number;
  date_approved: Date;
  status: string;
  total_amount: number;
  logistic_type: string;
  items: UnprocessedOrderItemDto[];
}

/**
 * DTO for reprocess result (per order).
 */
export class ReprocessItemResultDto {
  sku: string;
  status: string;
  message: string;
}

export class ReprocessResultDto {
  order_id: number;
  status: 'processed' | 'partial' | 'already_processed';
  message: string;
  items?: ReprocessItemResultDto[];
}

export class ReprocessAllResultDto {
  total: number;
  processed: number;
  failed: number;
  details: ReprocessResultDto[];
}

/**
 * Paginated response DTO for date range sales endpoint
 * Contains only the orders for the current page with pagination metadata
 */
export class PaginatedDateRangeSalesResponseDto {
  from_date: string;
  to_date: string;
  seller_id: number;
  days_count: number;

  @Type(() => DailySalesSummaryDto)
  summary: DailySalesSummaryDto;

  @Type(() => LogisticTypeBreakdownDto)
  by_logistic_type: LogisticTypeBreakdownDto;

  @Type(() => OrderSummaryDto)
  orders: OrderSummaryDto[]; // Flat array of orders for current page

  @Type(() => PackGroupDto)
  packs: PackGroupDto[]; // Orders grouped by pack_id

  @Type(() => PaginationMetaDto)
  pagination: PaginationMetaDto;
}

// ─── Discount History DTOs ──────────────────────────────────

export type DiscountStatus = 'discounted' | 'pending' | 'resolved' | 'ignored' | 'cancelled';
export type LogisticGroup = 'flex' | 'centro_envio';

export class GetDiscountHistoryQueryDto {
  @IsString()
  @IsNotEmpty({ message: 'La fecha inicial es obligatoria' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Formato de fecha inicial inválido. Use YYYY-MM-DD',
  })
  from_date: string;

  @IsString()
  @IsNotEmpty({ message: 'La fecha final es obligatoria' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Formato de fecha final inválido. Use YYYY-MM-DD',
  })
  to_date: string;

  @IsNumberString({}, { message: 'seller_id debe ser un número válido' })
  @IsNotEmpty({ message: 'El seller_id es obligatorio' })
  seller_id: string;
}

export class DiscountHistoryItemDto {
  order_id: number;
  pack_id: number | null;
  internal_sku: string | null;
  platform_sku: string | null;
  quantity: number;
  status: DiscountStatus;
  logistic_group: LogisticGroup;
  error_message: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  sale_date: string | null;
  platform_name: string | null;
}

export class DiscountHistoryDaySummaryDto {
  total_items: number;
  discounted_count: number;
  pending_count: number;
  resolved_count: number;
  ignored_count: number;
  cancelled_count: number;
}

export class DiscountHistoryLogisticDataDto {
  summary: DiscountHistoryDaySummaryDto;
  items: DiscountHistoryItemDto[];
}

export class DiscountHistoryDayDto {
  date: string;
  summary: DiscountHistoryDaySummaryDto;
  by_logistic_group: {
    flex: DiscountHistoryLogisticDataDto;
    centro_envio: DiscountHistoryLogisticDataDto;
  };
}

export class DiscountHistoryResponseDto {
  from_date: string;
  to_date: string;
  seller_id: number;
  days: DiscountHistoryDayDto[];
  totals: DiscountHistoryDaySummaryDto;
}
