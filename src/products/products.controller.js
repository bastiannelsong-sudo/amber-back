import { Controller, Get, Post, Delete, Put } from '@nestjs/common';
@Controller('products')
export class ProductsController {
    productsService;
    constructor(productsService) {
        this.productsService = productsService;
    }
    @Post()
    create(
    @Body()
    createProductDto) {
        return this.productsService.create(createProductDto);
    }
    @Get()
    findAll() {
        return this.productsService.findAll();
    }
    @Get(':id')
    findOne(
    @Param('id')
    id) {
        return this.productsService.findOne(id);
    }
    @Put(':id')
    update(
    @Param('id')
    id, 
    @Body()
    updateProductDto) {
        return this.productsService.update(id, updateProductDto);
    }
    @Delete(':id')
    remove(
    @Param('id')
    id) {
        return this.productsService.remove(id);
    }
}
