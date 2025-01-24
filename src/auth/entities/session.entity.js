import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
@Entity('sessions')
export class Session {
    @PrimaryGeneratedColumn()
    id;
    @Column({ type: 'text' })
    access_token;
    @Column({ type: 'int' })
    expires_in;
    @Column({ type: 'text' })
    refresh_token;
    @Column({ type: 'text' })
    scope;
    @Column({ type: 'text' })
    token_type;
    @Column({ type: 'int' })
    user_id;
    @CreateDateColumn({ type: 'timestamp' })
    created_at;
    @UpdateDateColumn({ type: 'timestamp' })
    updated_at;
}
