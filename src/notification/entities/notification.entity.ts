import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  topic: string;

  @Column()
  resource: string;

  @Column()
  user_id: number;

  @Column('bigint')  // Cambiar a 'bigint' para manejar números grandes
  application_id: number;

  @Column({ type: 'timestamp' })
  sent: Date;

  @Column()
  attempts: number;

  @Column({ type: 'timestamp' })
  received: Date;

  @Column('simple-array', { nullable: true })
  actions: string[];

  @Column({ type: 'boolean', default: false })  // Nueva columna 'processed'
  processed: boolean;

  // === Columnas de enriquecimiento ===

  @Column({ type: 'varchar', length: 50, nullable: true })
  event_type: string | null;

  @Column({ type: 'text', nullable: true })
  summary: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  product_name: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  seller_sku: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  total_amount: number | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  currency_id: string | null;

  @Column({ type: 'bigint', nullable: true })
  order_id: number | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  order_status: string | null;

  @Column({ type: 'boolean', default: false })
  read: boolean;

  @Column({ type: 'timestamp', nullable: true })
  read_at: Date | null;
}
