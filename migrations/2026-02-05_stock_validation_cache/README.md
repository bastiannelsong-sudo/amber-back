# Migración: Stock Validation Cache

**Fecha:** 2026-02-05
**Tipo:** Nueva funcionalidad
**Estado:** ✅ Lista para aplicar

## Propósito

Crea una tabla para almacenar en caché los resultados de la validación de stock entre el inventario local y Mercado Libre. Esto evita que los usuarios tengan que esperar 2-3 minutos cada vez que consultan el estado del stock.

## Problema que Resuelve

Actualmente, cada vez que un usuario entra a la página de validación de stock, el sistema:
1. Consulta todos los productos locales con SKUs de Mercado Libre (~214 productos)
2. Itera sobre cada producto y sus variaciones
3. Hace llamadas a la API de Mercado Libre (con rate limiting)
4. Procesa y retorna los resultados

Este proceso tarda **2-3 minutos**, lo cual es una mala experiencia de usuario si el usuario solo quiere consultar datos recientes.

## Solución

La tabla `ml_stock_validation_snapshots` almacena:
- Resultados completos de cada validación
- Metadata (fecha, tiempo de ejecución, contadores)
- Datos en formato JSONB para consultas eficientes

### Comportamiento después de la migración:

**Primera vez (sin caché):**
- Usuario entra → Backend ejecuta validación (2-3 min) → Guarda resultado → Muestra datos

**Siguientes veces (con caché):**
- Usuario entra → Backend busca último snapshot → Retorna instantáneamente
- Banner muestra: "Datos en caché - Última validación: hace 2 horas"
- Usuario puede forzar actualización con botón "Actualizar Ahora"

---

## Cambios en la Base de Datos

### Nueva Tabla: `ml_stock_validation_snapshots`

```sql
CREATE TABLE ml_stock_validation_snapshots (
  snapshot_id SERIAL PRIMARY KEY,
  seller_id BIGINT NOT NULL,
  total_items INTEGER DEFAULT 0,
  matching_count INTEGER DEFAULT 0,
  discrepancy_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  results_data JSONB NOT NULL,
  execution_time_ms INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Índices Creados

1. **idx_ml_stock_validation_seller_date**: `(seller_id, created_at DESC)`
   - Optimiza la consulta del último snapshot por vendedor
   - Usado en cada carga de página

2. **idx_ml_stock_validation_seller**: `(seller_id)`
   - Índice secundario para consultas por vendedor

---

## Impacto

### Rendimiento
- ✅ Primera carga: Sin cambios (2-3 min)
- ✅ Cargas subsecuentes: < 100ms (99% más rápido)
- ✅ Tamaño estimado: ~50-100 KB por snapshot

### Aplicación
- ✅ Backend: Código ya implementado y listo
- ✅ Frontend: Código ya implementado y listo
- ⚠️ Base de datos: **Requiere esta migración**

### Compatibilidad
- ✅ Backward compatible (no rompe funcionalidad existente)
- ✅ Forward compatible (funciona sin cambios en el código)

---

## Cómo Aplicar

### Paso 1: Aplicar Migración

```bash
# Opción A: Desde terminal
psql -U postgres -d tu_base_de_datos -f migrations/2026-02-05_stock_validation_cache/up.sql

# Opción B: Desde pgAdmin
# 1. Abre up.sql
# 2. Copia el contenido
# 3. Ejecuta en query editor
```

### Paso 2: Verificar

```bash
psql -U postgres -d tu_base_de_datos -f migrations/2026-02-05_stock_validation_cache/verify.sql
```

Deberías ver:
- ✅ Table exists
- ✅ JSONB column configured correctly
- Lista de 9 columnas
- Lista de 2 índices

### Paso 3: Probar

1. Inicia el backend: `npm run start:dev`
2. Entra a http://localhost:5173/stock-validation
3. La primera vez tardará 2-3 minutos
4. Recarga la página → Verás datos instantáneamente con banner amarillo
5. Click "Actualizar Ahora" → Nueva validación con banner verde

---

## Rollback

Si necesitas revertir esta migración:

```bash
psql -U postgres -d tu_base_de_datos -f migrations/2026-02-05_stock_validation_cache/down.sql
```

**⚠️ ADVERTENCIA:** Esto eliminará todos los snapshots guardados. Los usuarios volverán a esperar 2-3 minutos en cada consulta.

---

## Mantenimiento

### Limpieza de datos antiguos (opcional)

Para evitar que la tabla crezca indefinidamente, puedes programar una tarea cron que elimine snapshots antiguos:

```sql
-- Eliminar snapshots más antiguos de 30 días
DELETE FROM ml_stock_validation_snapshots
WHERE created_at < NOW() - INTERVAL '30 days';

-- O mantener solo los últimos 10 snapshots por vendedor
DELETE FROM ml_stock_validation_snapshots
WHERE snapshot_id NOT IN (
  SELECT snapshot_id
  FROM (
    SELECT snapshot_id,
           ROW_NUMBER() OVER (PARTITION BY seller_id ORDER BY created_at DESC) as rn
    FROM ml_stock_validation_snapshots
  ) t
  WHERE rn <= 10
);
```

### Monitoreo

```sql
-- Ver tamaño de la tabla
SELECT pg_size_pretty(pg_total_relation_size('ml_stock_validation_snapshots'));

-- Ver estadísticas por vendedor
SELECT
  seller_id,
  COUNT(*) as total_snapshots,
  MAX(created_at) as last_validation,
  AVG(execution_time_ms)/1000.0 as avg_execution_seconds
FROM ml_stock_validation_snapshots
GROUP BY seller_id;
```

---

## Archivos en Esta Migración

- **up.sql**: Script de migración (crea tabla e índices)
- **down.sql**: Script de rollback (elimina tabla e índices)
- **verify.sql**: Script de verificación (confirma que todo funciona)
- **README.md**: Este archivo (documentación completa)

---

## Dependencias

- PostgreSQL 9.4+ (requiere soporte para JSONB)
- TypeORM 0.3+ (para entity StockValidationSnapshot)
- NestJS 10+ (para controller y service)

---

## Referencias

- Entity: `amber-back/src/mercadolibre/entities/stock-validation-snapshot.entity.ts`
- Controller: `amber-back/src/mercadolibre/mercadolibre.controller.ts` (línea 121)
- Frontend: `amber-front/src/pages/StockValidationPage.tsx` (banner en línea 514)
- Hook: `amber-front/src/hooks/useMercadoLibre.ts` (línea 63)
