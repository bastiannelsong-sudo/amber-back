import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SecondarySkuDto } from './index';

export class UpdateProductDto {
  @IsString()
  @IsOptional()
  internal_sku?: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsNumber()
  @IsOptional()
  stock?: number;

  @IsNumber()
  @IsOptional()
  cost?: number;

  @IsNumber()
  @IsOptional()
  category_id?: number;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => SecondarySkuDto)
  secondarySkus?: SecondarySkuDto[];

  // Razón del cambio (obligatorio para cambios manuales)
  @IsString()
  @IsOptional()
  change_reason?: string;

  // Usuario que hace el cambio
  @IsString()
  @IsOptional()
  changed_by?: string;
}
