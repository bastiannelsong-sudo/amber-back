import {
  IsString,
  IsNumber,
  IsOptional,
  IsEmail,
  Min,
  Max,
  MaxLength,
} from 'class-validator';

export class CreateReviewDto {
  @IsNumber()
  product_id: number;

  @IsString()
  @MaxLength(100)
  customer_name: string;

  @IsEmail()
  customer_email: string;

  @IsNumber()
  @Min(1)
  @Max(5)
  rating: number;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  title?: string;

  @IsString()
  @MaxLength(2000)
  comment: string;

  @IsString()
  @IsOptional()
  order_number?: string;
}
