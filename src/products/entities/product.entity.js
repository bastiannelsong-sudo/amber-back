import { Entity, PrimaryGeneratedColumn, Column, OneToMany, ManyToOne } from 'typeorm';
import { SecondarySku } from './secondary-sku.entity';
import { Category } from './category.entity';
@Entity('products')
export class Product {
    @PrimaryGeneratedColumn()
    product_id;
    @Column({ type: 'varchar', length: 255, unique: true })
    internal_sku;
    @Column({ type: 'varchar', length: 255 })
    name;
    @Column({ type: 'int' })
    stock;
    @Column({ type: 'int', default: 0 })
    to_repair;
    @Column({ type: 'int' })
    total;
    @OneToMany(() => SecondarySku, (secondarySku) => secondarySku.product)
    secondarySkus;
    @ManyToOne(() => Category, { onDelete: 'CASCADE' })
    category;
}
