import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('sessions')
export class Session {

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

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;
}
