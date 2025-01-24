import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('categories')
export class Category {
  @PrimaryColumn()
  platform_id: number;

  @Column({ type: 'varchar', length: 255 })
  platform_name: string;
}
