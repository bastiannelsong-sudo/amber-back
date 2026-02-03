import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateProductMappingDto {
  @IsNumber()
  @IsNotEmpty()
  platform_id: number;

  @IsString()
  @IsNotEmpty()
  platform_sku: string;

  @IsNumber()
  @IsNotEmpty()
  product_id: number;

  @IsNumber()
  @IsOptional()
  @Min(1)
  quantity?: number;

  @IsString()
  @IsOptional()
  created_by?: string;
}
