import { Entity, Column, ManyToOne, OneToMany, PrimaryColumn, JoinColumn } from 'typeorm';
import { User } from './user.entity';
import { OrderItem } from './order-item.entity';
import { Payment } from './payment.entity';

@Entity()
export class Order {
  @PrimaryColumn({ type: 'bigint' }) // Definir la clave primaria con tipo bigint
  id: number; // Cambiar BigInt a number en TypeScript

  @Column()
  date_approved:Date;

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

  @Column({ nullable: true })
  buyerId: number;

  @ManyToOne(() => User, (user) => user.id)
  @JoinColumn({ name: 'buyerId' })
  buyer: User;

  @Column({ nullable: true })
  sellerId: number;

  @ManyToOne(() => User, (user) => user.id)
  @JoinColumn({ name: 'sellerId' })
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

  @Column({ nullable: true })
  shipping_id: string;  // Nuevo campo para el shipping_id

  @Column({ nullable: true })
  logistic_type: string; // Nuevo campo para el logistic_type

  @Column({ type: 'bigint', nullable: true })
  pack_id: number;

  // Datos del destinatario (receiver) del envío
  @Column({ nullable: true })
  receiver_name: string;

  @Column({ nullable: true })
  receiver_phone: string;

  @Column({ nullable: true })
  receiver_rut: string;
}
