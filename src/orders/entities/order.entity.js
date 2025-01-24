import { Entity, Column, ManyToOne, OneToMany, PrimaryColumn } from 'typeorm';
import { User } from './user.entity';
import { OrderItem } from './order-item.entity';
import { Payment } from './payment.entity';
@Entity()
export class Order {
    @PrimaryColumn({ type: 'bigint' }) // Definir la clave primaria con tipo bigint
    id; // Cambiar BigInt a number en TypeScript
    @Column()
    date_created;
    @Column()
    last_updated;
    @Column({ nullable: true })
    expiration_date;
    @Column({ nullable: true })
    date_closed;
    @Column()
    status;
    @Column('decimal', { precision: 10, scale: 2 })
    total_amount;
    @Column('decimal', { precision: 10, scale: 2 })
    paid_amount;
    @Column()
    currency_id;
    @ManyToOne(() => User, (user) => user.id)
    buyer;
    @ManyToOne(() => User, (user) => user.id)
    seller;
    @OneToMany(() => OrderItem, (item) => item.order)
    items;
    @OneToMany(() => Payment, (payment) => payment.order) // Relación con Payment
    payments;
    // Agregar el campo fulfilled
    @Column({ type: 'boolean', default: false })
    fulfilled;
    // Agregar el campo tags
    @Column("simple-array", { nullable: true })
    tags;
    @Column({ nullable: true })
    shipping_id; // Nuevo campo para el shipping_id
    @Column({ nullable: true })
    logistic_type; // Nuevo campo para el logistic_type
    @Column({ type: 'bigint', nullable: true })
    pack_id;
}
