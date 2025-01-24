import { Injectable } from '@nestjs/common';
@Injectable()
export class OrderService {
    orderRepository;
    constructor(
    @InjectRepository(Order)
    orderRepository) {
        this.orderRepository = orderRepository;
    }
    async findAll() {
        return this.orderRepository.find({ relations: ['buyer', 'seller', 'items'] });
    }
}
