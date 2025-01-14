import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany } from 'typeorm';
import { User } from './user.entity';
import { OrderItem } from './order-item.entity';

@Entity()
export class Order {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  date_created: Date;

  @Column()
  last_updated: Date;

  @Column({ nullable: true })
  expiration_date: Date;

  @Column({ nullable: true })
  date_closed: Date;

  @Column()
  status: string;

  @Column('decimal', { precision: 10, scale: 2 })
  total_amount: number;

  @Column('decimal', { precision: 10, scale: 2 })
  paid_amount: number;

  @Column()
  currency_id: string;

  @ManyToOne(() => User, (user) => user.id)
  buyer: User;

  @ManyToOne(() => User, (user) => user.id)
  seller: User;

  @OneToMany(() => OrderItem, (item) => item.order)
  items: OrderItem[];
}
