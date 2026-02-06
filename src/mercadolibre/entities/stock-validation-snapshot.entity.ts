import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('ml_stock_validation_snapshots')
@Index(['seller_id', 'created_at'])
export class StockValidationSnapshot {
  @PrimaryGeneratedColumn()
  snapshot_id: number;

  @Column({ type: 'bigint' })
  seller_id: number;

  @Column({ type: 'int', default: 0 })
  total_items: number;

  @Column({ type: 'int', default: 0 })
  matching_count: number;

  @Column({ type: 'int', default: 0 })
  discrepancy_count: number;

  @Column({ type: 'int', default: 0 })
  error_count: number;

  @Column({ type: 'jsonb' })
  results_data: {
    matching: any[];
    discrepancies: any[];
    errors: any[];
  };

  @Column({ type: 'int', nullable: true })
  execution_time_ms: number;

  @CreateDateColumn()
  created_at: Date;
}
