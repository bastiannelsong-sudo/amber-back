import { Controller, Get } from '@nestjs/common';
@Controller('orders')
export class OrderController {
    orderService;
    constructor(orderService) {
        this.orderService = orderService;
    }
    @Get()
    async getOrders() {
        return this.orderService.findAll();
    }
}
