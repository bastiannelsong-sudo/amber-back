import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Order } from './order.entity';
@Entity()
export class OrderItem {
    @PrimaryGeneratedColumn()
    id;
    @ManyToOne(() => Order, (order) => order.items)
    @JoinColumn({ name: 'orderId' })
    order;
    @Column()
    item_id;
    @Column()
    title;
    @Column()
    category_id;
    @Column('int')
    quantity;
    @Column('decimal', { precision: 10, scale: 2 })
    unit_price;
    @Column('decimal', { precision: 10, scale: 2, nullable: true })
    full_unit_price;
    @Column()
    currency_id;
    @Column()
    condition;
    @Column()
    warranty;
    @Column({ nullable: true })
    seller_sku;
}
