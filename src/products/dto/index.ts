// create-product.dto.ts
import { IsArray, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateProductDto {
  @IsString()
  internal_sku: string;

  @IsString()
  name: string;

  @IsNumber()
  stock: number;

  @IsNumber()
  @IsOptional()
  stock_bodega?: number;

  @IsNumber()
  @IsOptional()
  cost?: number;

  @IsNumber()
  category_id: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SecondarySkuDto)
  secondarySkus: SecondarySkuDto[];
}

export class SecondarySkuDto {
  @IsString()
  secondary_sku: string;

  @IsNumber()
  stock_quantity: number;

  @IsString()
  @IsOptional()
  publication_link?: string;

  @IsNumber()
  platform_id: number;
}

// Re-export other DTOs
export { UpdateProductDto } from './update-product.dto';
export { AdjustStockDto } from './adjust-stock.dto';
