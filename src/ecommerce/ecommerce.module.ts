import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EcommerceController } from './ecommerce.controller';
import { MercadoPagoService } from './services/mercadopago.service';
import { ReviewsService } from './services/reviews.service';
import { CouponsService } from './services/coupons.service';
import { EcommerceOrder } from './entities/ecommerce-order.entity';
import { Review } from './entities/review.entity';
import { Coupon } from './entities/coupon.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([EcommerceOrder, Review, Coupon]),
  ],
  controllers: [EcommerceController],
  providers: [MercadoPagoService, ReviewsService, CouponsService],
  exports: [ReviewsService, CouponsService],
})
export class EcommerceModule {}
