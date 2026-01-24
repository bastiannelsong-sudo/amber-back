# Guía de Testing - API de Productos con Historial

## Resumen de Cambios Implementados

Se ha implementado un sistema completo de historial de cambios para productos con los siguientes componentes:

### Nuevas Entidades
- `ProductHistory` - Registra todos los cambios realizados en los productos

### Nuevos Servicios
- `ProductHistoryService` - Gestiona el historial de cambios

### Nuevos DTOs
- `UpdateProductDto` - Para actualizar productos con razón obligatoria
- `AdjustStockDto` - Para ajustes manuales de stock con razón obligatoria

### Nuevos Endpoints

1. **PUT /products/:id** - Actualizar producto (con historial)
2. **DELETE /products/:id** - Eliminar producto (con historial)
3. **POST /products/:id/adjust-stock** - Ajustar stock manualmente
4. **GET /products/:id/history** - Obtener historial de cambios
5. **GET /products/low-stock** - Obtener productos con bajo stock

---

## Endpoints Detallados

### 1. Actualizar Producto
**PUT** `/products/:id`

Actualiza un producto y registra todos los cambios en el historial.

**Headers:**
```
Content-Type: application/json
```

**Body:**
```json
{
  "name": "Collar Perla Blanca Mejorado",
  "stock": 25,
  "category_id": 2,
  "change_reason": "Corrección de inventario físico",
  "changed_by": "admin@amber.com"
}
```

**Campos opcionales en el body:**
- `internal_sku` (string)
- `name` (string)
- `stock` (number)
- `category_id` (number)
- `secondarySkus` (array)

**Campos obligatorios:**
- `change_reason` (string) - Razón del cambio
- `changed_by` (string) - Quién hizo el cambio

**Respuesta exitosa (200):**
```json
{
  "product_id": 1,
  "internal_sku": "COL-001",
  "name": "Collar Perla Blanca Mejorado",
  "stock": 25,
  "category_id": 2,
  "created_at": "2025-01-15T10:00:00.000Z",
  "updated_at": "2025-01-15T11:30:00.000Z"
}
```

**Errores comunes:**
- 400: "Debe proporcionar una razón para el cambio (change_reason)"
- 404: Producto no encontrado
- 409: SKU interno ya existe (si se intenta cambiar a uno existente)

---

### 2. Eliminar Producto
**DELETE** `/products/:id?reason=RAZON&changed_by=USUARIO`

Elimina un producto del sistema y registra la eliminación en el historial.

**Query Parameters:**
- `reason` (required) - Razón de la eliminación
- `changed_by` (required) - Usuario que elimina

**Ejemplo:**
```
DELETE /products/15?reason=Producto%20descontinuado&changed_by=admin@amber.com
```

**Respuesta exitosa (200):**
```json
{
  "message": "Producto eliminado correctamente",
  "product_id": 15
}
```

**Errores comunes:**
- 400: "Debe proporcionar una razón para eliminar el producto"
- 400: "Debe proporcionar quién está eliminando el producto"
- 404: Producto no encontrado

---

### 3. Ajustar Stock Manualmente
**POST** `/products/:id/adjust-stock`

Realiza un ajuste manual de stock (positivo o negativo) con razón obligatoria.

**Headers:**
```
Content-Type: application/json
```

**Body:**
```json
{
  "adjustment": -5,
  "reason": "Producto dañado durante transporte",
  "changed_by": "warehouse@amber.com"
}
```

**Campos:**
- `adjustment` (number, required) - Cantidad a ajustar (positivo para aumentar, negativo para disminuir)
- `reason` (string, required) - Razón del ajuste
- `changed_by` (string, required) - Usuario que realiza el ajuste

**Ejemplos de ajustes:**
```json
// Aumentar stock por llegada de mercancía
{
  "adjustment": 50,
  "reason": "Recepción de nueva mercancía - Factura #12345",
  "changed_by": "warehouse@amber.com"
}

// Reducir stock por producto dañado
{
  "adjustment": -3,
  "reason": "Producto dañado - reporte interno",
  "changed_by": "supervisor@amber.com"
}
```

**Respuesta exitosa (200):**
```json
{
  "product_id": 1,
  "internal_sku": "COL-001",
  "name": "Collar Perla Blanca",
  "stock": 20,
  "previous_stock": 25,
  "adjustment": -5,
  "created_at": "2025-01-15T10:00:00.000Z",
  "updated_at": "2025-01-15T12:00:00.000Z"
}
```

**Errores comunes:**
- 400: Validación fallida (campos requeridos faltantes)
- 404: Producto no encontrado

---

### 4. Obtener Historial de Cambios
**GET** `/products/:id/history?limit=50`

Obtiene el historial completo de cambios de un producto.

**Query Parameters:**
- `limit` (optional) - Número máximo de registros (default: 50)

**Ejemplo:**
```
GET /products/1/history?limit=20
```

**Respuesta exitosa (200):**
```json
[
  {
    "history_id": 45,
    "product_id": 1,
    "field_name": "stock",
    "old_value": "25",
    "new_value": "20",
    "changed_by": "warehouse@amber.com",
    "change_type": "adjustment",
    "change_reason": "Producto dañado - reporte interno",
    "created_at": "2025-01-15T12:00:00.000Z"
  },
  {
    "history_id": 44,
    "product_id": 1,
    "field_name": "name",
    "old_value": "Collar Perla Blanca",
    "new_value": "Collar Perla Blanca Mejorado",
    "changed_by": "admin@amber.com",
    "change_type": "manual",
    "change_reason": "Corrección de inventario físico",
    "created_at": "2025-01-15T11:30:00.000Z"
  }
]
```

**Tipos de cambio (change_type):**
- `manual` - Cambio manual directo
- `adjustment` - Ajuste de stock
- `order` - Cambio por orden de ML
- `import` - Importación masiva

**Errores comunes:**
- 404: Producto no encontrado

---

### 5. Productos con Bajo Stock
**GET** `/products/low-stock?threshold=10`

Obtiene todos los productos cuyo stock está por debajo del umbral especificado.

**Query Parameters:**
- `threshold` (optional) - Umbral de stock bajo (default: 10)

**Ejemplo:**
```
GET /products/low-stock?threshold=15
```

**Respuesta exitosa (200):**
```json
[
  {
    "product_id": 5,
    "internal_sku": "ART-005",
    "name": "Aros Plata 925",
    "stock": 8,
    "category_id": 3,
    "category_name": "Aros",
    "created_at": "2025-01-10T10:00:00.000Z",
    "updated_at": "2025-01-15T12:00:00.000Z"
  },
  {
    "product_id": 12,
    "internal_sku": "COL-012",
    "name": "Collar Piedra Luna",
    "stock": 3,
    "category_id": 2,
    "category_name": "Collares",
    "created_at": "2025-01-12T10:00:00.000Z",
    "updated_at": "2025-01-14T15:00:00.000Z"
  }
]
```

---

## Casos de Uso Completos

### Caso 1: Recepción de Nueva Mercancía

**Paso 1:** Revisar productos con bajo stock
```
GET /products/low-stock?threshold=15
```

**Paso 2:** Ajustar stock de productos recibidos
```
POST /products/5/adjust-stock
Body:
{
  "adjustment": 50,
  "reason": "Recepción mercancía - Factura #12345",
  "changed_by": "warehouse@amber.com"
}
```

**Paso 3:** Verificar historial
```
GET /products/5/history?limit=10
```

---

### Caso 2: Producto Dañado

**Paso 1:** Reducir stock
```
POST /products/12/adjust-stock
Body:
{
  "adjustment": -2,
  "reason": "Producto dañado durante empaque - Reporte #789",
  "changed_by": "warehouse@amber.com"
}
```

**Paso 2:** Ver historial de daños
```
GET /products/12/history
```

---

### Caso 3: Corrección de Información del Producto

**Paso 1:** Actualizar información
```
PUT /products/8
Body:
{
  "name": "Aros Plata 925 - Diseño Circular",
  "category_id": 3,
  "change_reason": "Corrección de descripción para mejor categorización",
  "changed_by": "admin@amber.com"
}
```

**Paso 2:** Verificar cambios
```
GET /products/8/history
```

---

### Caso 4: Eliminar Producto Descontinuado

**Paso 1:** Verificar producto
```
GET /products/15
```

**Paso 2:** Eliminar con razón
```
DELETE /products/15?reason=Producto%20descontinuado%20-%20sin%20rotación&changed_by=admin@amber.com
```

---

## Testing con Postman

### Importar Colección

Crea una nueva colección en Postman con las siguientes requests:

**Variables de entorno:**
```
base_url: http://localhost:3000
```

### Request 1: Actualizar Producto
```
PUT {{base_url}}/products/1
Headers:
  Content-Type: application/json
Body (raw JSON):
{
  "name": "Collar Perla Blanca Premium",
  "stock": 30,
  "change_reason": "Actualización de stock post inventario",
  "changed_by": "admin@amber.com"
}
```

### Request 2: Ajustar Stock
```
POST {{base_url}}/products/1/adjust-stock
Headers:
  Content-Type: application/json
Body (raw JSON):
{
  "adjustment": -5,
  "reason": "Producto dañado",
  "changed_by": "warehouse@amber.com"
}
```

### Request 3: Ver Historial
```
GET {{base_url}}/products/1/history?limit=20
```

### Request 4: Productos con Bajo Stock
```
GET {{base_url}}/products/low-stock?threshold=10
```

### Request 5: Eliminar Producto
```
DELETE {{base_url}}/products/15?reason=Producto%20descontinuado&changed_by=admin@amber.com
```

---

## Validaciones Implementadas

### UpdateProductDto
- `change_reason` es obligatorio
- Si se intenta cambiar `internal_sku`, debe ser único
- Todos los demás campos son opcionales

### AdjustStockDto
- `adjustment` debe ser un número (positivo o negativo)
- `reason` es obligatorio
- `changed_by` es obligatorio

### Delete Endpoint
- `reason` query parameter es obligatorio
- `changed_by` query parameter es obligatorio

---

## Esquema de Base de Datos

### Tabla: product_history

```sql
CREATE TABLE product_history (
  history_id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL,
  field_name VARCHAR(100) NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_by VARCHAR(255),
  change_type VARCHAR(50) DEFAULT 'manual',
  change_reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE
);
```

**Índices recomendados:**
```sql
CREATE INDEX idx_product_history_product_id ON product_history(product_id);
CREATE INDEX idx_product_history_change_type ON product_history(change_type);
CREATE INDEX idx_product_history_created_at ON product_history(created_at DESC);
```

---

## Próximos Pasos

1. **Probar todos los endpoints** con Postman o similar
2. **Verificar la creación de la tabla** `product_history` en la base de datos
3. **Implementar el frontend** para conectar con estos nuevos endpoints
4. **Agregar más tipos de reportes** basados en el historial:
   - Productos más modificados
   - Usuarios más activos
   - Tendencias de ajustes de stock
   - Auditoría completa

---

## Errores Comunes y Soluciones

### Error: "Debe proporcionar una razón para el cambio"
**Solución:** Agregar `change_reason` en el body del request

### Error: "El SKU interno ya existe"
**Solución:** Usar un SKU diferente o verificar que el producto existente no esté activo

### Error: 404 Not Found
**Solución:** Verificar que el product_id existe en la base de datos

### Error: TypeORM entity not found
**Solución:** Verificar que ProductHistory esté registrado en ProductsModule
