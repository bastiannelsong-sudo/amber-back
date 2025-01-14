import { DataSource } from 'typeorm';
import { User } from './src/orders/entities/user.entity';
import { Order } from './src/orders/entities/order.entity';
import { OrderItem } from './src/orders/entities/order-item.entity';
import { Payment } from './src/orders/entities/payment.entity';

// Configuración de la conexión a PostgreSQL
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: 'localhost',       // Cambiar por el host de tu base de datos
  port: 5432,              // Puerto de PostgreSQL
  username: 'postgres',    // Usuario de PostgreSQL
  password: '123456', // Contraseña de PostgreSQL
  database: 'amber', // Nombre de la base de datos
  entities: [User, Order, OrderItem, Payment],
  synchronize: true,       // Auto genera tablas en la base de datos (usar solo en desarrollo)
  logging: true
});

// Inicializa la conexión
AppDataSource.initialize()
  .then(() => {
    console.log('Database connected successfully');
  })
  .catch((error) => {
    console.error('Error connecting to database:', error);
  });
