import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class ResolvePendingSaleDto {
  @IsNumber()
  @IsNotEmpty()
  product_id: number;

  @IsBoolean()
  @IsOptional()
  create_mapping?: boolean; // Si true, crea un mapeo automático

  @IsString()
  @IsNotEmpty()
  resolved_by: string;
}
