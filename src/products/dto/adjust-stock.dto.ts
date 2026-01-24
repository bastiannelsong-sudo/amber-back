import { IsNumber, IsString, IsNotEmpty } from 'class-validator';

export class AdjustStockDto {
  @IsNumber()
  @IsNotEmpty()
  adjustment: number; // Puede ser positivo (+10) o negativo (-5)

  @IsString()
  @IsNotEmpty()
  reason: string; // Obligatorio: "Inventario físico", "Producto dañado", etc.

  @IsString()
  @IsNotEmpty()
  changed_by: string; // Usuario que hace el ajuste
}
