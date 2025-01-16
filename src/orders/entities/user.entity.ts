import { Entity, PrimaryGeneratedColumn, Column, PrimaryColumn } from 'typeorm';

@Entity()
export class User {
  @PrimaryColumn()
  id: number;

  @Column()
  nickname: string;

  @Column()
  first_name: string;

  @Column()
  last_name: string;
}
