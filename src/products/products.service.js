import { Injectable } from '@nestjs/common';
@Injectable()
export class ProductsService {
    productRepository;
    constructor(
    @InjectRepository(Product)
    productRepository) {
        this.productRepository = productRepository;
    }
    create(createProductDto) {
        const product = this.productRepository.create(createProductDto);
        return this.productRepository.save(product);
    }
    findAll() {
        return this.productRepository.find({ relations: ['secondarySkus'] });
    }
    findOne(id) {
        return this.productRepository.findOne({ where: { product_id: id }, relations: ['secondarySkus'] });
    }
    update(id, updateProductDto) {
        return this.productRepository.update(id, updateProductDto);
    }
    remove(id) {
        return this.productRepository.delete(id);
    }
}
