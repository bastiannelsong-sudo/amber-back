import { Column, Entity, PrimaryColumn } from 'typeorm';
@Entity('platforms')
export class Platform {
    @PrimaryColumn()
    platform_id;
    @Column({ type: 'varchar', length: 255 })
    platform_name;
}
