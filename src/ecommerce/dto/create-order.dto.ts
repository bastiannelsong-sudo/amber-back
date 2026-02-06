import {
  IsString,
  IsNumber,
  IsArray,
  IsOptional,
  IsEmail,
  ValidateNested,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

class OrderItemDto {
  @IsNumber()
  product_id: number;

  @IsString()
  name: string;

  @IsString()
  internal_sku: string;

  @IsNumber()
  @Min(1)
  quantity: number;

  @IsNumber()
  unit_price: number;

  @IsString()
  @IsOptional()
  image_url?: string;
}

export class CreateOrderDto {
  @IsEmail()
  customer_email: string;

  @IsString()
  customer_name: string;

  @IsString()
  @IsOptional()
  customer_phone?: string;

  @IsString()
  shipping_address: string;

  @IsString()
  shipping_city: string;

  @IsString()
  shipping_region: string;

  @IsString()
  @IsOptional()
  shipping_postal_code?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  @IsString()
  @IsOptional()
  coupon_code?: string;
}
