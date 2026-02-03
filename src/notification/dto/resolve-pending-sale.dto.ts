import { IsArray, IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, ValidateNested, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ResolveItemDto {
  @IsNumber()
  @IsNotEmpty()
  product_id: number;

  @IsNumber()
  @Min(1)
  @IsNotEmpty()
  quantity: number;
}

export class ResolvePendingSaleDto {
  // Legacy: single product (backwards compat)
  @IsNumber()
  @IsOptional()
  product_id?: number;

  // New: multiple products with custom quantities
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ResolveItemDto)
  @IsOptional()
  items?: ResolveItemDto[];

  @IsBoolean()
  @IsOptional()
  create_mapping?: boolean;

  @IsString()
  @IsNotEmpty()
  resolved_by: string;
}
