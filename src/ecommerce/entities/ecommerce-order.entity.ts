import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('ecommerce_orders')
export class EcommerceOrder {
  @PrimaryGeneratedColumn()
  order_id: number;

  @Column({ type: 'varchar', length: 50, unique: true })
  order_number: string;

  // Customer info
  @Column({ type: 'varchar', length: 255 })
  customer_email: string;

  @Column({ type: 'varchar', length: 255 })
  customer_name: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  customer_phone: string;

  // Shipping address
  @Column({ type: 'text' })
  shipping_address: string;

  @Column({ type: 'varchar', length: 100 })
  shipping_city: string;

  @Column({ type: 'varchar', length: 100 })
  shipping_region: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  shipping_postal_code: string;

  // Order items stored as JSON
  @Column({ type: 'jsonb' })
  items: {
    product_id: number;
    name: string;
    internal_sku: string;
    quantity: number;
    unit_price: number;
    image_url?: string;
  }[];

  // Pricing
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  subtotal: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  shipping_cost: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  discount_amount: number;

  @Column({ type: 'varchar', length: 50, nullable: true })
  coupon_code: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  total: number;

  // MercadoPago
  @Column({ type: 'varchar', length: 255, nullable: true })
  mp_preference_id: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  mp_payment_id: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  mp_payment_status: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  mp_payment_method: string;

  // Order status
  @Column({
    type: 'varchar',
    length: 30,
    default: 'pending',
  })
  status: 'pending' | 'paid' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'refunded';

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
