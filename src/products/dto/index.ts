export class CreateProductDto {
  internal_sku: string;
  name: string;
  stock: number;
  to_repair: number;
  total: number;
}

export class UpdateProductDto {
  internal_sku?: string;
  name?: string;
  stock?: number;
  to_repair?: number;
  total?: number;
}
