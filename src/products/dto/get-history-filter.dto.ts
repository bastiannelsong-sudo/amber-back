import { IsDateString, IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';

export class GetHistoryFilterDto {
  @IsOptional()
  @IsNumber()
  product_id?: number;

  @IsOptional()
  @IsEnum(['manual', 'order', 'adjustment', 'import'])
  change_type?: string;

  @IsOptional()
  @IsNumber()
  platform_id?: number;

  @IsOptional()
  @IsString()
  changed_by?: string;

  @IsOptional()
  @IsDateString()
  date_from?: string;

  @IsOptional()
  @IsDateString()
  date_to?: string;

  @IsOptional()
  @IsNumber()
  limit?: number;

  @IsOptional()
  @IsNumber()
  offset?: number;
}
