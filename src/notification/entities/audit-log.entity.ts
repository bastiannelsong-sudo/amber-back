import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  entity: string; // Nombre de la entidad (tabla)

  @Column()
  action: string; // "create", "update", "delete"

  @Column('json')
  changes: any; // JSON con los detalles de las columnas modificadas

  @CreateDateColumn()
  timestamp: Date; // Marca de tiempo
}
