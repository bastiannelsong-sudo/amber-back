import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';
@Entity('audit_logs')
export class AuditLog {
    @PrimaryGeneratedColumn()
    id;
    @Column()
    entity; // Nombre de la entidad (tabla)
    @Column()
    action; // "create", "update", "delete"
    @Column('json')
    changes; // JSON con los detalles de las columnas modificadas
    @CreateDateColumn()
    timestamp; // Marca de tiempo
}
