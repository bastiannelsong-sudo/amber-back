import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  topic: string;

  @Column()
  resource: string;

  @Column()
  user_id: number;

  @Column('bigint')  // Cambiar a 'bigint' para manejar números grandes
  application_id: number;

  @Column({ type: 'timestamp' })
  sent: Date;

  @Column()
  attempts: number;

  @Column({ type: 'timestamp' })
  received: Date;

  @Column('simple-array', { nullable: true })
  actions: string[];

  @Column({ type: 'boolean', default: false })  // Nueva columna 'processed'
  processed: boolean;

}
