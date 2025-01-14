import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('sessions')
export class Session {
  static id(id: any, arg1: { access_token: any; expires_in: any; refresh_token: any; }) {
    throw new Error('Method not implemented.');
  }
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text' })
  access_token: string;

  @Column({ type: 'int' })
  expires_in: number;

  @Column({ type: 'text' })
  refresh_token: string;

  @Column({ type: 'text' })
  scope: string;

  @Column({ type: 'text' })
  token_type: string;

  @Column({ type: 'bigint' })
  user_id: number;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;
  static refresh_token: any;
}
