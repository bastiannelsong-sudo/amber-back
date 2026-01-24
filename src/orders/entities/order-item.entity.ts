import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, PrimaryColumn, JoinColumn } from 'typeorm';
import { Order } from './order.entity';

@Entity()
export class OrderItem {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Order, (order) => order.items)
  @JoinColumn({ name: 'orderId' })
  order: Order;

  @Column()
  item_id: string;

  @Column()
  title: string;

  @Column()
  category_id: string;

  @Column('int')
  quantity: number;

  @Column('decimal', { precision: 10, scale: 2 })
  unit_price: number;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  full_unit_price: number;

  @Column()
  currency_id: string;

  @Column()
  condition: string;

  @Column()
  warranty: string;

  @Column({nullable: true})
  seller_sku: string;

  @Column({ nullable: true })
  thumbnail: string;
}
