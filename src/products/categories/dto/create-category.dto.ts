import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre de la categoría es requerido' })
  @MaxLength(255, { message: 'El nombre no puede exceder 255 caracteres' })
  name: string;
}
