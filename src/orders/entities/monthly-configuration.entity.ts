import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { User } from './user.entity';

/**
 * Configuracion mensual de costos operativos para un vendedor
 *
 * Almacena costos que varian mes a mes como:
 * - Costo de empaque por producto
 * - Notas/observaciones del mes
 *
 * Se usa junto con FaztConfiguration (tarifas de envio) para calcular
 * el costo total de operacion de un mes.
 */
@Entity('monthly_configuration')
@Unique(['seller', 'year_month'])
export class MonthlyConfiguration {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'seller_id' })
  seller: User;

  @Column({ name: 'seller_id' })
  seller_id: number;

  /**
   * Mes de la configuracion en formato YYYY-MM
   * Ejemplo: "2025-01" para enero 2025
   */
  @Column({ length: 7 })
  year_month: string;

  /**
   * Costo de empaque por producto/unidad (en CLP)
   * Este costo se multiplica por la cantidad de items vendidos
   */
  @Column('decimal', { precision: 10, scale: 2, default: 0 })
  packaging_cost_per_item: number;

  /**
   * Notas u observaciones del mes (opcional)
   * Para documentar gastos especiales, cambios, etc.
   */
  @Column('text', { nullable: true })
  notes: string | null;

  /**
   * Si la configuracion esta marcada como "cerrada" (mes finalizado)
   * Una vez cerrada, sirve como registro historico
   */
  @Column({ default: false })
  is_closed: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
