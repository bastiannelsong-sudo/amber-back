# 🔍 Análisis: Optimización de Validación de Stock

## 📊 Estado Actual

### Datos Disponibles en Base de Datos

#### 1. Tabla `ml_stock_validation_snapshots`
```sql
- snapshot_id (PK)
- seller_id
- created_at           ← ✅ TIMESTAMP de última validación
- total_items
- matching_count
- discrepancy_count
- error_count
- execution_time_ms    ← ⚠️ Última ejecución: 127,672ms (~2.1 min)
- results_data (JSONB) ← ✅ Contiene TODA la información de la última validación
```

**Datos guardados en `results_data` por cada item:**
- ✅ `ml_stock` (available_quantity)
- ✅ `ml_stock_flex` (selling_address)
- ✅ `ml_stock_full` (meli_facility)
- ✅ `ml_variation.id` (variation ID)
- ✅ `ml_variation.sku` (SELLER_SKU)
- ✅ `ml_variation.attributes` (atributos de la variación)
- ✅ `ml_status`, `ml_price`, `ml_pictures`, etc.

#### 2. Tabla `secondary_skus`
```sql
- secondary_sku_id (PK)
- secondary_sku (ML item ID)
- variation_id         ← ✅ Variation ID
- logistic_type        ← ✅ fulfillment/cross_docking/xd_drop_off
- stock_quantity
- ❌ NO tiene created_at / updated_at
```

#### 3. Tabla `products`
```sql
- product_id (PK)
- internal_sku
- stock
- stock_bodega
- ❌ NO tiene updated_at (verificar si existe)
```

---

## 🚨 Llamadas API Actuales (Por Validación)

### Total de llamadas para ~200 productos:

| Endpoint | Cantidad | Tiempo Estimado | Propósito |
|----------|----------|----------------|-----------|
| `/items` (batch) | ~20 batches | ~5-10s | Obtener items de ML |
| `/inventories/{id}` (stock breakdown) | ~150-200 | **~60-90s** | Obtener Flex/Full por variación |
| `/items/{id}/variations/{var_id}` | ~300 | **~15-20s** | Obtener SELLER_SKU |
| **TOTAL** | ~500 llamadas | **~2 minutos** | |

---

## 💡 Análisis de Necesidad Real

### ¿Qué datos REALMENTE necesitan actualizarse en cada validación?

| Dato | Frecuencia de Cambio | Necesidad de Actualización | Cacheable |
|------|---------------------|---------------------------|-----------|
| **available_quantity** | Alta (ventas en tiempo real) | ✅ CRÍTICO - Debe ser en tiempo real | ❌ NO |
| **SELLER_SKU** | Muy Baja (solo si vendedor reconfigura) | ⚠️ BAJO - Cambia <1% del tiempo | ✅ SÍ (24h+) |
| **Stock breakdown (Flex/Full)** | Media (depende de ML) | ⚠️ MEDIO - Importante pero no crítico | ⚠️ PARCIAL |
| **Variation attributes** | Muy Baja | ❌ BAJO - Solo informativo | ✅ SÍ (7 días+) |
| **Status (active/paused)** | Baja | ✅ MEDIO - Importante | ⚠️ PARCIAL |
| **Price** | Baja | ❌ BAJO - Solo informativo | ⚠️ PARCIAL |
| **Pictures** | Muy Baja | ❌ BAJO - Solo informativo | ✅ SÍ (7 días+) |

---

## 🎯 Opciones de Optimización

### **OPCIÓN 1: Cache de SELLER_SKU (Quick Win - 15-20s ahorrados)**

**Problema actual:**
- Se llama `/items/{id}/variations/{var_id}` para CADA variación en CADA validación
- Objetivo: obtener SELLER_SKU
- SELLER_SKU casi NUNCA cambia

**Solución:**
```sql
CREATE TABLE ml_variation_cache (
  variation_id BIGINT PRIMARY KEY,
  item_id VARCHAR(50) NOT NULL,
  seller_sku VARCHAR(50),
  attributes JSONB,
  last_fetched TIMESTAMP DEFAULT NOW(),
  INDEX(item_id),
  INDEX(seller_sku)
);
```

**Lógica:**
```typescript
// En validateStockWithML
if (needsVariationDetails) {
  // 1. Buscar en cache primero
  const cachedVariations = await variationCacheRepo.find({
    where: {
      variation_id: In(variationIds),
      last_fetched: MoreThan(subDays(new Date(), 7)) // Cache válido 7 días
    }
  });

  // 2. Solo fetch las que NO están en cache o están viejas
  const missingIds = variationIds.filter(id =>
    !cachedVariations.find(v => v.variation_id === id)
  );

  if (missingIds.length > 0) {
    // Fetch solo las faltantes
    const newDetails = await fetchVariationDetails(missingIds);
    // Guardar en cache
    await variationCacheRepo.save(newDetails);
  }
}
```

**Ganancia:**
- Primera validación: ~2 minutos (igual que ahora)
- Validaciones subsecuentes (dentro de 7 días): **~90-100 segundos** (ahorro de 15-20s)
- Cache hit rate estimado: >95% después de primera validación

---

### **OPCIÓN 2: Skip Stock Breakdown si `available_quantity` no cambió (Medio - 30-40s ahorrados)**

**Problema actual:**
- Se llama `/inventories/{id}` para obtener Flex/Full de CADA variación
- Si `available_quantity` no cambió desde última validación → Flex/Full probablemente tampoco cambiaron

**Solución:**
```typescript
// En validateStockWithML
for (const product of localProducts) {
  const mlItem = mlItemsMap.get(product.ml_item_id);

  // 1. Buscar en último snapshot
  const lastSnapshot = await snapshotRepo.findOne({
    where: { seller_id },
    order: { created_at: 'DESC' }
  });

  const lastItemData = lastSnapshot?.results_data.matching
    .concat(lastSnapshot.results_data.discrepancies)
    .find(item => item.internal_sku === product.internal_sku);

  // 2. Si available_quantity no cambió, usar breakdown del snapshot
  if (lastItemData && lastItemData.ml_stock === mlItem.available_quantity) {
    mlStockFlex = lastItemData.ml_stock_flex;
    mlStockFull = lastItemData.ml_stock_full;
    // ✅ Skip llamada a getStockByLocation
  } else {
    // ❌ Stock cambió, fetch breakdown actualizado
    const stockData = await getStockByLocation(...);
  }
}
```

**Ganancia:**
- Asumiendo 60% de items sin cambios en stock: **ahorro de ~30-40 segundos**
- Validación total: **~80-90 segundos**

**Limitación:**
- Si `available_quantity` cambió pero Flex/Full cambiaron de forma diferente, el breakdown será incorrecto
- Riesgo: BAJO (en la práctica, si total no cambió, breakdown tampoco)

---

### **OPCIÓN 3: Smart Incremental Updates (Avanzado - 50-60s ahorrados)**

**Concepto:**
- Solo validar items que "probablemente" cambiaron
- Basado en heurísticas

**Criterios para decidir si validar un item:**
```typescript
function needsRevalidation(product, lastSnapshot) {
  const lastData = findInSnapshot(lastSnapshot, product.sku);

  // Siempre validar si:
  // 1. Es la primera vez
  if (!lastData) return true;

  // 2. Última validación hace >2 horas
  if (isAfter(new Date(), addHours(lastSnapshot.created_at, 2))) return true;

  // 3. Había discrepancia en última validación
  if (lastData.category === 'discrepancy') return true;

  // 4. Stock local cambió desde última validación
  if (product.local_stock !== lastData.local_stock) return true;

  // 5. Es un producto "activo" (muchas ventas)
  // (requiere campo sales_velocity en products)
  if (product.sales_velocity === 'high') return true;

  // Caso contrario: usar datos del snapshot
  return false;
}
```

**Flujo:**
```
1. Fetch solo items básicos (sin stock breakdown, sin variation details)
2. Comparar con snapshot anterior
3. Full validation solo para items que cambiaron
4. Usar datos del snapshot para items estables
```

**Ganancia:**
- Asumiendo 40% de items necesitan validación real: **ahorro de ~50-60 segundos**
- Validación total: **~60-70 segundos**

**Limitación:**
- Requiere lógica compleja
- Puede tener falsos negativos (items que cambiaron pero no se detectaron)

---

### **OPCIÓN 4: Background Jobs + Polling (UX - Percepción de velocidad)**

**Concepto:**
- Validación corre en background (job queue)
- Frontend hace polling cada 2 segundos para ver si terminó
- Usuario puede seguir trabajando mientras corre

**Arquitectura:**
```
Frontend                Backend
   |                       |
   |--- POST /validate --->|
   |<-- { job_id: 123 } ---|
   |                       |
   |                    [Queue Job]
   |                       |
   |-- GET /job/123/status |
   |<-- { progress: 30% } -|
   |                       |
   |-- GET /job/123/status |
   |<-- { progress: 100% }-|
   |<-- { result: {...} } -|
```

**Implementación:**
```typescript
// Backend (NestJS + Bull)
@Post('stock/validate')
async queueValidation(@Query('seller_id') sellerId: string) {
  const job = await this.validationQueue.add('validate-stock', {
    sellerId: parseInt(sellerId)
  });

  return { job_id: job.id, status: 'queued' };
}

@Get('stock/validate/job/:jobId')
async getJobStatus(@Param('jobId') jobId: string) {
  const job = await this.validationQueue.getJob(jobId);

  return {
    status: job.progress < 100 ? 'processing' : 'completed',
    progress: job.progress,
    result: job.progress === 100 ? job.returnvalue : null
  };
}
```

**Frontend:**
```typescript
const handleValidate = async () => {
  const { job_id } = await startValidation();

  // Polling
  const interval = setInterval(async () => {
    const status = await getJobStatus(job_id);
    setProgress(status.progress);

    if (status.status === 'completed') {
      clearInterval(interval);
      setData(status.result);
      toast.success('Validación completa');
    }
  }, 2000);
};
```

**Ganancia:**
- **Tiempo real:** Igual (~2 min)
- **Percepción:** Usuario ve progreso real, puede seguir trabajando
- **UX:** Mucho mejor

---

### **OPCIÓN 5: Hybrid - Cache + Skip + Background (Óptimo)**

**Combina:**
1. Cache de SELLER_SKU (Opción 1)
2. Skip stock breakdown si no cambió (Opción 2)
3. Background job con progreso real (Opción 4)

**Ganancia total:**
- Primera validación: ~2 min (background, no bloquea)
- Validaciones subsecuentes: **~40-60 segundos** (background, con cache + skip)
- UX: Excelente (progreso real, no bloquea)

---

## 📈 Comparación de Opciones

| Opción | Complejidad | Tiempo Ahorrado | Cache Hit | Riesgo | Esfuerzo |
|--------|------------|----------------|-----------|--------|----------|
| **1. Cache SELLER_SKU** | Baja | 15-20s | 95%+ | Muy Bajo | 2-3h |
| **2. Skip Breakdown** | Media | 30-40s | 60%+ | Bajo | 3-4h |
| **3. Incremental** | Alta | 50-60s | 40%+ | Medio | 1-2 días |
| **4. Background Jobs** | Alta | 0s (percepción) | N/A | Bajo | 1-2 días |
| **5. Hybrid (1+2+4)** | Alta | 60-80s + UX | 80%+ | Bajo | 2-3 días |

---

## 🎯 Recomendación por Fases

### **Fase 1 (Inmediata - 2-3 horas):**
✅ Implementar **Opción 1: Cache de SELLER_SKU**
- Ganancia: 15-20 segundos
- Riesgo: Muy bajo
- Effort: 2-3 horas

**Resultado:** 2 min → 90-100 segundos

---

### **Fase 2 (Esta semana - 3-4 horas):**
✅ Implementar **Opción 2: Skip Stock Breakdown**
- Ganancia: +30-40 segundos
- Riesgo: Bajo
- Effort: 3-4 horas

**Resultado acumulado:** 2 min → 50-70 segundos

---

### **Fase 3 (Opcional - 1-2 días):**
✅ Implementar **Opción 4: Background Jobs**
- Ganancia: UX mucho mejor
- Usuario no espera
- Progreso real del backend

**Resultado final:** 50-70 segundos en background, con progreso real

---

## 🔑 Variables Clave Disponibles

```typescript
// Ya disponibles en el código:
const lastSnapshot = await snapshotRepo.findOne({
  where: { seller_id },
  order: { created_at: 'DESC' }
});

// ✅ Timestamp de última validación
lastSnapshot.created_at

// ✅ Datos completos de última validación
lastSnapshot.results_data.matching[]
lastSnapshot.results_data.discrepancies[]

// Para cada item en el snapshot:
item.ml_stock              // available_quantity anterior
item.ml_stock_flex         // Flex anterior
item.ml_stock_full         // Full anterior
item.ml_variation.id       // Variation ID
item.ml_variation.sku      // SELLER_SKU
item.internal_sku          // SKU local
item.local_stock           // Stock local en ese momento

// ✅ Tiempo de ejecución anterior
lastSnapshot.execution_time_ms
```

---

## 💾 Datos Faltantes que Ayudarían

1. **`secondary_skus.created_at`** - Para saber cuándo se vinculó
2. **`secondary_skus.updated_at`** - Para detectar cambios en la vinculación
3. **`products.updated_at`** - Para saber cuándo cambió stock local
4. **`products.sales_velocity`** - Para priorizar validación de items "activos"

**Si se agregan estos campos:**
- Opción 3 (Incremental) se vuelve mucho más precisa
- Reduce riesgo de falsos negativos

---

## 🧪 Métricas a Medir (Post-Implementación)

### Fase 1 (Cache SELLER_SKU):
- Cache hit rate: Debería ser >95% después de primera validación
- Tiempo de validación: Debería reducirse de ~120s a ~90-100s
- Errores 429 (rate limit): Deberían reducirse ~30%

### Fase 2 (Skip Breakdown):
- Items skipped: % de items que usaron breakdown del snapshot
- Tiempo de validación: Debería reducirse a ~50-70s
- Precisión: Comparar resultados con/sin skip

### Fase 3 (Background):
- UX: Satisfacción del usuario (ya no espera bloqueado)
- Throughput: Más validaciones por hora
- CPU/Memory: Uso del worker queue

---

## ⚠️ Consideraciones Importantes

### 1. **Datos del Snapshot son Solo Referencia**
- El snapshot NO se usa para decisiones críticas de inventario
- Solo para validación y detección de discrepancias
- Si hay duda, siempre fetch datos frescos

### 2. **Cache Invalidation**
- El cache de SELLER_SKU debe invalidarse si:
  - Vendedor manualmente "refresca" la vinculación
  - Ha pasado >7 días desde última actualización
  - Hay un error 404 al buscar el variation_id

### 3. **Progreso Real vs Estimado**
- Opción 4 (Background) permite reportar progreso REAL desde backend
- Requiere WebSocket o Server-Sent Events
- Alternativa: Polling cada 2 segundos

---

## 📝 Conclusión

**Sin cambios:** ~120 segundos (100%)
**Con Fase 1:** ~90-100 segundos (25% mejora)
**Con Fase 1+2:** ~50-70 segundos (50%+ mejora)
**Con Fase 1+2+3:** ~50-70 segundos en background (UX 10x mejor)

**Roadmap recomendado:**
1. ✅ **Ahora:** Implementar cache de SELLER_SKU (2-3h)
2. ✅ **Esta semana:** Implementar skip de stock breakdown (3-4h)
3. ⚠️ **Opcional:** Background jobs si UX es crítica (1-2 días)

---

**Fecha de análisis:** 2026-02-06
**Última validación analizada:** 127,672ms (~2.1 min) con 291 items
