import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumberString,
  Matches,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Enum for logistic types (shipping methods)
 */
export enum LogisticTypeEnum {
  FULFILLMENT = 'fulfillment',
  CROSS_DOCKING = 'cross_docking',
  OTHER = 'other',
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
  is_cancelled: boolean; // True if order was cancelled/refunded (shown in list but not counted in sums)
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
  total_fees: number;
  net_profit: number;
  average_order_value: number;
  average_profit_margin: number;
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
  total_fees: number;
  net_profit: number;
  average_order_value: number;
  average_profit_margin: number;
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
 * Response DTO for sync orders endpoint
 */
export class SyncOrdersResponseDto {
  synced: number;
  message: string;
  date: string;
  seller_id: number;
}
