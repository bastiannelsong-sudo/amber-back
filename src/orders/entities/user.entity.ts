import { Entity, PrimaryGeneratedColumn, Column, PrimaryColumn } from 'typeorm';

@Entity()
export class User {
  @PrimaryColumn('bigint')
  id: number;

  @Column()
  nickname: string;

  @Column()
  first_name: string;

  @Column()
  last_name: string;
}
