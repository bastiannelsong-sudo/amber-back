import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsDateString,
  IsIn,
} from 'class-validator';

export class CreateCouponDto {
  @IsString()
  code: string;

  @IsIn(['percentage', 'fixed'])
  discount_type: 'percentage' | 'fixed';

  @IsNumber()
  discount_value: number;

  @IsNumber()
  @IsOptional()
  min_purchase?: number;

  @IsNumber()
  @IsOptional()
  max_discount?: number;

  @IsNumber()
  @IsOptional()
  max_uses?: number;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;

  @IsDateString()
  @IsOptional()
  valid_from?: string;

  @IsDateString()
  @IsOptional()
  valid_until?: string;

  @IsString()
  @IsOptional()
  description?: string;
}

export class ValidateCouponDto {
  @IsString()
  code: string;

  @IsNumber()
  cart_total: number;
}
