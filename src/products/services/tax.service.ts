import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TaxService {
  private readonly ivaPercentage: number;

  constructor(private configService: ConfigService) {
    this.ivaPercentage = this.configService.get<number>('IVA_PERCENTAGE') || 19;
  }

  /**
   * Obtiene el porcentaje de IVA actual
   */
  getIvaPercentage(): number {
    return this.ivaPercentage;
  }

  /**
   * Calcula el IVA de un monto neto
   * @param netAmount Monto sin IVA
   * @returns Monto del IVA
   */
  calculateIva(netAmount: number): number {
    return Number((netAmount * (this.ivaPercentage / 100)).toFixed(2));
  }

  /**
   * Calcula el monto total con IVA incluido
   * @param netAmount Monto sin IVA
   * @returns Monto total con IVA
   */
  addIva(netAmount: number): number {
    return Number((netAmount * (1 + this.ivaPercentage / 100)).toFixed(2));
  }

  /**
   * Extrae el monto neto de un monto con IVA incluido
   * @param grossAmount Monto con IVA incluido
   * @returns Monto neto sin IVA
   */
  removeIva(grossAmount: number): number {
    return Number((grossAmount / (1 + this.ivaPercentage / 100)).toFixed(2));
  }

  /**
   * Extrae el IVA de un monto con IVA incluido
   * @param grossAmount Monto con IVA incluido
   * @returns Monto del IVA
   */
  extractIva(grossAmount: number): number {
    const netAmount = this.removeIva(grossAmount);
    return Number((grossAmount - netAmount).toFixed(2));
  }
}
