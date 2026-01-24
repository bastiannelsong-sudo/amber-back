import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  Unique,
} from 'typeorm';
import { User } from './user.entity';

@Entity('monthly_flex_cost')
@Unique(['year_month', 'seller'])
export class MonthlyFlexCost {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 7 })
  year_month: string; // Format: YYYY-MM (e.g., "2025-01")

  @ManyToOne(() => User)
  seller: User;

  @Column('decimal', { precision: 12, scale: 2 })
  net_cost: number; // Cost without IVA

  @Column('decimal', { precision: 12, scale: 2 })
  iva_amount: number; // IVA (19%)

  @Column('decimal', { precision: 12, scale: 2 })
  total_cost: number; // net_cost + iva_amount

  @Column({ type: 'int', default: 0 })
  flex_orders_count: number; // Number of Flex orders in that month (for reference)

  @Column({ nullable: true })
  notes: string; // Optional notes (e.g., invoice number)

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
