import { Entity, Column, PrimaryColumn } from 'typeorm';
@Entity()
export class User {
    @PrimaryColumn()
    id;
    @Column()
    nickname;
    @Column()
    first_name;
    @Column()
    last_name;
}
