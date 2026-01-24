import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

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

  @IsString()
  @IsOptional()
  created_by?: string;
}
