import 'dotenv/config';
import { DataSource } from 'typeorm';
import { User } from './src/orders/entities/user.entity';
import { Order } from './src/orders/entities/order.entity';
import { OrderItem } from './src/orders/entities/order-item.entity';
import { Payment } from './src/orders/entities/payment.entity';
import { Notification } from './src/notification/entities/notification.entity';
import { Session } from './src/auth/entities/session.entity';
import { Product } from './src/products/entities/product.entity';
import { Platform } from './src/products/entities/platform.entity';
import { SecondarySku } from './src/products/entities/secondary-sku.entity';
import { Category } from './src/products/entities/category.entity';
import { ProductAudit } from './src/notification/entities/product-audit.entity';
import { ProductHistory } from './src/products/entities/product-history.entity';
import { ProductMapping } from './src/products/entities/product-mapping.entity';
import { PendingSale } from './src/notification/entities/pending-sale.entity';
import { MonthlyFlexCost } from './src/orders/entities/monthly-flex-cost.entity';
import { FaztConfiguration } from './src/orders/entities/fazt-configuration.entity';
import { MonthlyConfiguration } from './src/orders/entities/monthly-configuration.entity';
import { StockValidationSnapshot } from './src/mercadolibre/entities/stock-validation-snapshot.entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE || 'amber',
  entities: [
    User, Order, OrderItem, Payment, Notification, Session,
    Product, Platform, SecondarySku, Category, ProductAudit,
    ProductHistory, ProductMapping, PendingSale, MonthlyFlexCost,
    FaztConfiguration, MonthlyConfiguration, StockValidationSnapshot,
  ],
  synchronize: false,
  logging: process.env.NODE_ENV !== 'production',
});
