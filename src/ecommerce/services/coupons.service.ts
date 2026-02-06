import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Coupon } from '../entities/coupon.entity';
import { CreateCouponDto } from '../dto/create-coupon.dto';

@Injectable()
export class CouponsService {
  constructor(
    @InjectRepository(Coupon)
    private couponRepository: Repository<Coupon>,
  ) {}

  /**
   * Create a new coupon
   */
  async create(dto: CreateCouponDto): Promise<Coupon> {
    const existing = await this.couponRepository.findOne({
      where: { code: dto.code.toUpperCase() },
    });
    if (existing) {
      throw new BadRequestException('El codigo de cupon ya existe');
    }

    const coupon = this.couponRepository.create({
      ...dto,
      code: dto.code.toUpperCase(),
    });
    return this.couponRepository.save(coupon);
  }

  /**
   * Validate a coupon and calculate discount
   */
  async validate(
    code: string,
    cartTotal: number,
  ): Promise<{
    valid: boolean;
    discount_amount: number;
    message: string;
    coupon?: Coupon;
  }> {
    const coupon = await this.couponRepository.findOne({
      where: { code: code.toUpperCase() },
    });

    if (!coupon) {
      return { valid: false, discount_amount: 0, message: 'Cupon no encontrado' };
    }

    if (!coupon.is_active) {
      return { valid: false, discount_amount: 0, message: 'Este cupon ya no esta activo' };
    }

    const now = new Date();
    if (coupon.valid_from && now < coupon.valid_from) {
      return { valid: false, discount_amount: 0, message: 'Este cupon aun no esta vigente' };
    }
    if (coupon.valid_until && now > coupon.valid_until) {
      return { valid: false, discount_amount: 0, message: 'Este cupon ha expirado' };
    }

    if (coupon.max_uses && coupon.times_used >= coupon.max_uses) {
      return { valid: false, discount_amount: 0, message: 'Este cupon ha alcanzado su limite de uso' };
    }

    if (coupon.min_purchase && cartTotal < Number(coupon.min_purchase)) {
      return {
        valid: false,
        discount_amount: 0,
        message: `Compra minima de $${Number(coupon.min_purchase).toLocaleString('es-CL')} requerida`,
      };
    }

    // Calculate discount
    let discountAmount: number;
    if (coupon.discount_type === 'percentage') {
      discountAmount = cartTotal * (Number(coupon.discount_value) / 100);
      if (coupon.max_discount && discountAmount > Number(coupon.max_discount)) {
        discountAmount = Number(coupon.max_discount);
      }
    } else {
      discountAmount = Number(coupon.discount_value);
    }

    discountAmount = Math.round(discountAmount);

    return {
      valid: true,
      discount_amount: discountAmount,
      message: coupon.discount_type === 'percentage'
        ? `${Number(coupon.discount_value)}% de descuento aplicado`
        : `$${discountAmount.toLocaleString('es-CL')} de descuento aplicado`,
      coupon,
    };
  }

  /**
   * Increment coupon usage count
   */
  async incrementUsage(code: string): Promise<void> {
    const coupon = await this.couponRepository.findOne({
      where: { code: code.toUpperCase() },
    });
    if (coupon) {
      coupon.times_used += 1;
      await this.couponRepository.save(coupon);
    }
  }

  /**
   * Get all coupons
   */
  async findAll(): Promise<Coupon[]> {
    return this.couponRepository.find({
      order: { created_at: 'DESC' },
    });
  }

  /**
   * Toggle coupon active status
   */
  async toggleActive(couponId: number): Promise<Coupon> {
    const coupon = await this.couponRepository.findOne({
      where: { coupon_id: couponId },
    });
    if (!coupon) throw new NotFoundException('Cupon no encontrado');

    coupon.is_active = !coupon.is_active;
    return this.couponRepository.save(coupon);
  }
}
