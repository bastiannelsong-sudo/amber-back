import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { Product } from './product.entity';
import { Platform } from './platform.entity';
@Entity('secondary_skus')
export class SecondarySku {
    @PrimaryGeneratedColumn()
    secondary_sku_id;
    @Column({ type: 'varchar', length: 255 })
    secondary_sku;
    @Column({ type: 'int' })
    stock_quantity;
    @Column({ type: 'varchar', length: 2083, nullable: true })
    publication_link;
    @ManyToOne(() => Product, (product) => product.secondarySkus, { onDelete: 'CASCADE' })
    product;
    @ManyToOne(() => Platform, { onDelete: 'CASCADE' })
    platform;
}
