import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('coupons')
export class Coupon {
  @PrimaryGeneratedColumn()
  coupon_id: number;

  @Column({ type: 'varchar', length: 50, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 20 })
  discount_type: 'percentage' | 'fixed'; // percentage or fixed amount

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  discount_value: number; // 10 = 10% or $10,000

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  min_purchase: number; // Minimum cart value to apply

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  max_discount: number; // Max discount for percentage coupons

  @Column({ type: 'int', nullable: true })
  max_uses: number; // Total uses allowed (null = unlimited)

  @Column({ type: 'int', default: 0 })
  times_used: number;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'timestamp', nullable: true })
  valid_from: Date;

  @Column({ type: 'timestamp', nullable: true })
  valid_until: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string;

  @CreateDateColumn()
  created_at: Date;
}
