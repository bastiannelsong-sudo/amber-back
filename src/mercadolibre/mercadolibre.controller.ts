import { Controller, Get, ParseIntPipe, Query } from '@nestjs/common';
import { MercadoLibreService } from './mercadolibre.service';

@Controller('mercadolibre')
export class MercadoLibreController {
  constructor(private readonly mercadoLibreService: MercadoLibreService) {}

  @Get('orders')
  async getOrders(
    @Query('date') date: string,
    @Query('seller_id',ParseIntPipe) seller_id: number
  ) {
    // Validamos la fecha
    if (!date) {
      throw new Error('La fecha es obligatoria');
    }

    // Llamamos al servicio para obtener las órdenes
    return this.mercadoLibreService.getOrdersByDate(date, seller_id);
  }
}
