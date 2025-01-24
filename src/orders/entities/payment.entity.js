import { Entity, Column, ManyToOne, PrimaryColumn } from 'typeorm';
import { Order } from './order.entity';
@Entity()
export class Payment {
    @PrimaryColumn({ type: 'bigint' }) // Definir la clave primaria con tipo bigint
    id; // Cambiar BigInt a number en TypeScript
    @ManyToOne(() => Order, (order) => order.id)
    order;
    @Column()
    payment_method_id;
    @Column()
    payment_type;
    @Column()
    status;
    @Column('decimal', { precision: 10, scale: 2 })
    transaction_amount;
    @Column('decimal', { precision: 10, scale: 2 })
    shipping_cost;
    @Column('decimal', { precision: 10, scale: 2 })
    marketplace_fee;
    @Column('decimal', { precision: 10, scale: 2 })
    total_paid_amount;
    @Column()
    date_approved;
    @Column()
    currency_id;
}
