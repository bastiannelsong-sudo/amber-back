import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('product_audits')
export class ProductAudit {
  @PrimaryGeneratedColumn()
  audit_id: number;

  @Column({ type: 'bigint'})
  order_id: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  internal_sku: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  secondary_sku: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  logistic_type:string

  @Column({ type: 'varchar', length: 255 })
  platform_name: string;

  @Column({ type: 'int' })
  quantity_discounted: number;

  @Column({ type: 'text', nullable: true })
  error_message: string;

  @CreateDateColumn()
  created_at: Date;

  @Column({ type: 'enum', enum: ['OK_INTERNO', 'OK_FULL', 'NOT_FOUND','CANCELLED'] })
  status: 'OK_INTERNO' | 'OK_FULL' | 'NOT_FOUND' | 'CANCELLED';
}
