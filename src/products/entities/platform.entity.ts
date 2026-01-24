import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('platforms')
export class Platform {
  @PrimaryColumn()
  platform_id: number;

  @Column({ type: 'varchar', length: 255 })
  platform_name: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  webhook_url: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  api_base_url: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  client_id: string;

  @Column({ type: 'text', nullable: true })
  client_secret: string; // Debería estar encriptado en producción

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'jsonb', nullable: true })
  config: any; // Configuración adicional específica por plataforma
}
