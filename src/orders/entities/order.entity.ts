import { Entity, Column, ManyToOne, OneToMany, PrimaryColumn } from 'typeorm';
import { User } from './user.entity';
import { OrderItem } from './order-item.entity';
import { Payment } from './payment.entity';

@Entity()
export class Order {
  @PrimaryColumn({ type: 'bigint' }) // Definir la clave primaria con tipo bigint
  id: number; // Cambiar BigInt a number en TypeScript

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

  @OneToMany(() => Payment, (payment) => payment.order)  // Relación con Payment
  payments: Payment[];

  // Agregar el campo fulfilled
  @Column({ type: 'boolean', default: false })
  fulfilled: boolean;

  // Agregar el campo tags
  @Column("simple-array", { nullable: true })
  tags: string[];
}
