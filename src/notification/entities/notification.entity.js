import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
@Entity('notifications')
export class Notification {
    @PrimaryGeneratedColumn('uuid')
    id;
    @Column()
    topic;
    @Column()
    resource;
    @Column()
    user_id;
    @Column('bigint') // Cambiar a 'bigint' para manejar números grandes
    application_id;
    @Column({ type: 'timestamp' })
    sent;
    @Column()
    attempts;
    @Column({ type: 'timestamp' })
    received;
    @Column('simple-array', { nullable: true })
    actions;
    @Column({ type: 'boolean', default: false }) // Nueva columna 'processed'
    processed;
}
