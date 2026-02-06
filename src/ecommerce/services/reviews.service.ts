import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Review } from '../entities/review.entity';
import { EcommerceOrder } from '../entities/ecommerce-order.entity';
import { CreateReviewDto } from '../dto/create-review.dto';

@Injectable()
export class ReviewsService {
  constructor(
    @InjectRepository(Review)
    private reviewRepository: Repository<Review>,
    @InjectRepository(EcommerceOrder)
    private orderRepository: Repository<EcommerceOrder>,
  ) {}

  /**
   * Create a new review
   */
  async create(dto: CreateReviewDto): Promise<Review> {
    // Check if customer already reviewed this product
    const existing = await this.reviewRepository.findOne({
      where: {
        product_id: dto.product_id,
        customer_email: dto.customer_email,
      },
    });
    if (existing) {
      throw new BadRequestException('Ya dejaste una review para este producto');
    }

    // Check if it's a verified purchase
    let verifiedPurchase = false;
    if (dto.order_number) {
      const order = await this.orderRepository.findOne({
        where: {
          order_number: dto.order_number,
          customer_email: dto.customer_email,
          status: 'paid',
        },
      });
      if (order) {
        const hasProduct = order.items.some(
          (item) => item.product_id === dto.product_id,
        );
        if (hasProduct) {
          verifiedPurchase = true;
        }
      }
    }

    const review = this.reviewRepository.create({
      ...dto,
      verified_purchase: verifiedPurchase,
      is_approved: true,
    });

    return this.reviewRepository.save(review);
  }

  /**
   * Get reviews for a product
   */
  async getByProduct(productId: number): Promise<{
    reviews: Review[];
    average_rating: number;
    total_reviews: number;
    rating_distribution: Record<number, number>;
  }> {
    const reviews = await this.reviewRepository.find({
      where: { product_id: productId, is_approved: true },
      order: { created_at: 'DESC' },
    });

    const totalReviews = reviews.length;
    const averageRating =
      totalReviews > 0
        ? reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews
        : 0;

    // Rating distribution (1-5)
    const ratingDistribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    reviews.forEach((r) => {
      ratingDistribution[r.rating] = (ratingDistribution[r.rating] || 0) + 1;
    });

    return {
      reviews,
      average_rating: Math.round(averageRating * 10) / 10,
      total_reviews: totalReviews,
      rating_distribution: ratingDistribution,
    };
  }

  /**
   * Mark a review as helpful
   */
  async markHelpful(reviewId: number): Promise<Review> {
    const review = await this.reviewRepository.findOne({
      where: { review_id: reviewId },
    });
    if (!review) throw new NotFoundException('Review no encontrada');

    review.helpful_count += 1;
    return this.reviewRepository.save(review);
  }

  /**
   * Get bestseller product IDs based on review count + rating
   */
  async getBestsellerIds(limit = 10): Promise<number[]> {
    const result = await this.reviewRepository
      .createQueryBuilder('review')
      .select('review.product_id', 'product_id')
      .addSelect('COUNT(*)', 'review_count')
      .addSelect('AVG(review.rating)', 'avg_rating')
      .where('review.is_approved = true')
      .groupBy('review.product_id')
      .having('COUNT(*) >= 1')
      .orderBy('review_count', 'DESC')
      .addOrderBy('avg_rating', 'DESC')
      .limit(limit)
      .getRawMany();

    return result.map((r) => Number(r.product_id));
  }
}
