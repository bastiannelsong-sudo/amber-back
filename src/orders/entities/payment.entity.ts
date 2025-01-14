import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { Order } from './order.entity';

@Entity()
export class Payment {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Order, (order) => order.id)
  order: Order;

  @Column()
  payment_method_id: string;

  @Column()
  payment_type: string;

  @Column()
  status: string;

  @Column('decimal', { precision: 10, scale: 2 })
  transaction_amount: number;

  @Column('decimal', { precision: 10, scale: 2 })
  shipping_cost: number;

  @Column('decimal', { precision: 10, scale: 2 })
  marketplace_fee: number;

  @Column('decimal', { precision: 10, scale: 2 })
  total_paid_amount: number;

  @Column()
  date_approved: Date;

  @Column()
  currency_id: string;
}
