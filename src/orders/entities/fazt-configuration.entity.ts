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
 * Tier de tarifas de Fazt según volumen de envíos
 */
export interface FaztRateTier {
  min_shipments: number;
  max_shipments: number | null; // null = sin límite superior
  same_day_rm: number; // Precio Same Day Región Metropolitana (sin IVA)
  next_day_v_region: number; // Precio Next Day a V Región (sin IVA)
}

/**
 * Configuración de tarifas de Fazt para un vendedor
 *
 * Las tarifas se escalonan según el volumen de envíos mensuales.
 * El costo se calcula dinámicamente según los envíos del mes actual.
 */
@Entity('fazt_configuration')
@Unique(['seller'])
export class FaztConfiguration {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'seller_id' })
  seller: User;

  /**
   * Tarifas escalonadas por rango de volumen
   * Almacenado como JSON array
   */
  @Column('jsonb')
  rate_tiers: FaztRateTier[];

  /**
   * Recargo para zonas especiales (Colina, Padre Hurtado)
   * Valor en CLP sin IVA
   */
  @Column('decimal', { precision: 10, scale: 2, default: 1000 })
  special_zone_surcharge: number;

  /**
   * Recargo para paquetes XL
   * Valor en CLP sin IVA
   */
  @Column('decimal', { precision: 10, scale: 2, default: 2000 })
  xl_package_surcharge: number;

  /**
   * Tipo de servicio por defecto para calcular tarifas
   */
  @Column({ default: 'same_day_rm' })
  default_service_type: string; // 'same_day_rm' | 'next_day_v_region'

  /**
   * IDs de ciudades consideradas zonas especiales
   * Para Colina y Padre Hurtado de ML
   */
  @Column('simple-array', { nullable: true })
  special_zone_city_ids: string[];

  /**
   * Si la configuración está activa
   */
  @Column({ default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}

/**
 * Tarifas por defecto de Fazt (sin IVA)
 * Basadas en la imagen de tarifas proporcionada
 */
export const DEFAULT_FAZT_TIERS: FaztRateTier[] = [
  { min_shipments: 100, max_shipments: 200, same_day_rm: 3290, next_day_v_region: 3990 },
  { min_shipments: 201, max_shipments: 400, same_day_rm: 2790, next_day_v_region: 3290 },
  { min_shipments: 401, max_shipments: 601, same_day_rm: 2590, next_day_v_region: 3090 },
  { min_shipments: 601, max_shipments: 800, same_day_rm: 2490, next_day_v_region: 2990 },
  { min_shipments: 801, max_shipments: 1000, same_day_rm: 2390, next_day_v_region: 2890 },
  { min_shipments: 1001, max_shipments: null, same_day_rm: 2290, next_day_v_region: 2790 },
];

/**
 * IDs de ciudades de zonas especiales en MercadoLibre Chile
 * TODO: Verificar estos IDs con la API de ML
 */
export const DEFAULT_SPECIAL_ZONE_CITY_IDS: string[] = [
  // Colina y Padre Hurtado - IDs a verificar
];
