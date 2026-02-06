import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { MercadoPagoService } from './services/mercadopago.service';
import { ReviewsService } from './services/reviews.service';
import { CouponsService } from './services/coupons.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { CreateReviewDto } from './dto/create-review.dto';
import { CreateCouponDto, ValidateCouponDto } from './dto/create-coupon.dto';

@Controller('ecommerce')
export class EcommerceController {
  constructor(
    private readonly mercadoPagoService: MercadoPagoService,
    private readonly reviewsService: ReviewsService,
    private readonly couponsService: CouponsService,
  ) {}

  // ─── PAYMENTS ────────────────────────────────────────

  @Post('orders')
  createOrder(@Body() dto: CreateOrderDto) {
    return this.mercadoPagoService.createOrder(dto);
  }

  @Post('payments/webhook')
  handleWebhook(@Body() data: any) {
    return this.mercadoPagoService.handleWebhook(data);
  }

  @Get('orders/:orderNumber')
  getOrder(@Param('orderNumber') orderNumber: string) {
    return this.mercadoPagoService.getOrderByNumber(orderNumber);
  }

  @Get('orders')
  getOrders(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.mercadoPagoService.getOrders(
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
    );
  }

  // ─── REVIEWS ─────────────────────────────────────────

  @Post('reviews')
  createReview(@Body() dto: CreateReviewDto) {
    return this.reviewsService.create(dto);
  }

  @Get('reviews/:productId')
  getProductReviews(@Param('productId') productId: number) {
    return this.reviewsService.getByProduct(Number(productId));
  }

  @Patch('reviews/:reviewId/helpful')
  markReviewHelpful(@Param('reviewId') reviewId: number) {
    return this.reviewsService.markHelpful(Number(reviewId));
  }

  @Get('bestsellers')
  getBestsellerIds(@Query('limit') limit?: number) {
    return this.reviewsService.getBestsellerIds(limit ? Number(limit) : 10);
  }

  // ─── COUPONS ─────────────────────────────────────────

  @Post('coupons')
  createCoupon(@Body() dto: CreateCouponDto) {
    return this.couponsService.create(dto);
  }

  @Post('coupons/validate')
  validateCoupon(@Body() dto: ValidateCouponDto) {
    return this.couponsService.validate(dto.code, dto.cart_total);
  }

  @Get('coupons')
  getCoupons() {
    return this.couponsService.findAll();
  }

  @Patch('coupons/:couponId/toggle')
  toggleCoupon(@Param('couponId') couponId: number) {
    return this.couponsService.toggleActive(Number(couponId));
  }
}
