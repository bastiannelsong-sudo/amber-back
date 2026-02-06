# Propuestas de Optimización - Validación de Stock

## Situación Actual
- **Tiempo actual:** 2-3 minutos para ~200 productos
- **Problema:** Demasiadas llamadas secuenciales a la API de ML

## Cuellos de Botella Identificados

### 1. Stock Breakdown por Variación (CRÍTICO)
- **Ubicación:** `mercadolibre.service.ts` líneas 1053-1077
- **Problema:** Una llamada `getStockByLocation` por cada variación con 150ms delay
- **Impacto:** 200 variaciones = 90 segundos

### 2. Fetching de SELLER_SKU (MODERADO)
- **Ubicación:** `mercadolibre.service.ts` líneas 1123-1141
- **Problema:** Una llamada `getVariationById` por variación
- **Impacto:** 300 variaciones = 15 segundos

### 3. Procesamiento Secuencial (MODERADO)
- **Ubicación:** `mercadolibre.service.ts` líneas 1042-1102
- **Problema:** Batches procesados secuencialmente

---

## OPCIÓN A: Quick Wins (Implementación Inmediata)

### A1. Reducir Delay entre Llamadas
**Cambio:** `DELAY_BETWEEN_CALLS` de 150ms → 100ms
**Ganancia:** ~20-30 segundos
**Riesgo:** Bajo (ML tolera hasta 3 req/seg según docs)

```typescript
const DELAY_BETWEEN_CALLS = 100; // Reducir de 150ms
```

### A2. Aumentar Concurrency de Variations
**Cambio:** `CONCURRENCY` de 10 → 20
**Ganancia:** ~7-10 segundos
**Riesgo:** Bajo

```typescript
const CONCURRENCY = 20; // Aumentar de 10
```

### A3. Paralelizar Llamadas de Stock Breakdown
**Cambio:** Usar `Promise.allSettled` en lugar de loop secuencial
**Ganancia:** ~40-50 segundos
**Riesgo:** Medio (puede triggear rate limiting)

```typescript
// Dentro del batch, en lugar de:
for (const variation of variationsWithUserProductId) {
  await getStockByLocation(...);
  await delay(150);
}

// Usar:
await Promise.allSettled(
  variationsWithUserProductId.map(async (variation, idx) => {
    await delay(idx * 50); // Stagger las llamadas
    return this.getStockByLocation(...);
  })
);
```

**Ganancia Total Opción A:** 60-90 segundos → **Tiempo final: 30-60 segundos**

---

## OPCIÓN B: Caché de Variation Details (Mediano Plazo)

### B1. Cachear SELLER_SKU por Variación
**Problema:** SELLER_SKU no cambia frecuentemente
**Solución:** Guardar en tabla `ml_variation_cache`

**Tabla:**
```sql
CREATE TABLE ml_variation_cache (
  variation_id BIGINT PRIMARY KEY,
  item_id VARCHAR(50) NOT NULL,
  seller_sku VARCHAR(50),
  attributes JSONB,
  last_updated TIMESTAMP DEFAULT NOW(),
  INDEX(item_id),
  INDEX(seller_sku)
);
```

**Lógica:**
1. En primera validación, fetch y guardar en cache
2. En siguientes validaciones, usar cache (skip API call)
3. Refresh cache cada 24 horas o manual

**Ganancia:** ~15 segundos en validaciones subsecuentes
**Esfuerzo:** Medio (migración + modificar servicio)

---

## OPCIÓN C: Skip Stock Breakdown para Items Sin Cambios (Avanzado)

### C1. Solo Fetch Breakdown si Stock Cambió
**Idea:** Si `available_quantity` no cambió desde última validación, skip el stock breakdown

**Lógica:**
```typescript
// En el snapshot, guardar también available_quantity por item
// En siguiente validación:
const needsStockBreakdown = mlItem.available_quantity !== lastSnapshot.items[itemId].available_quantity;

if (needsStockBreakdown) {
  // Fetch stock breakdown
} else {
  // Usar breakdown del snapshot anterior
}
```

**Ganancia:** ~40-60 segundos (asumiendo 60% de items sin cambios)
**Esfuerzo:** Alto (modificar snapshot para incluir breakdown)

---

## OPCIÓN D: Progressive Loading en Frontend

### D1. Streaming de Resultados
**Idea:** Enviar resultados conforme se procesan, en lugar de esperar al final

**Backend:**
- Usar Server-Sent Events (SSE) o WebSockets
- Enviar items procesados en tiempo real

**Frontend:**
- Mostrar items conforme llegan
- Progress bar con % completado

**Ganancia:** Percepción de velocidad (UX)
**Tiempo real:** Igual, pero usuario ve progreso
**Esfuerzo:** Alto

---

## OPCIÓN E: Background Job con Notificaciones

### E1. Ejecutar Validación en Background
**Idea:** Validación corre en background, notifica cuando termina

**Implementación:**
- Bull Queue o similar
- Frontend inicia job y muestra "En progreso..."
- Backend envía notificación cuando termina (WebSocket/Polling)

**Ganancia:** Usuario no espera, puede seguir trabajando
**Esfuerzo:** Alto

---

## RECOMENDACIÓN INMEDIATA

**Implementar OPCIÓN A (Quick Wins):**
1. ✅ Reducir delay a 100ms
2. ✅ Aumentar concurrency a 20
3. ✅ Paralelizar stock breakdown dentro de batches

**Ganancia esperada:** De 2-3 min → **30-60 segundos**
**Esfuerzo:** 15-20 minutos de código
**Riesgo:** Bajo

---

## Roadmap de Optimizaciones

### Fase 1 (Ahora - 20 min)
- [ ] Implementar Quick Wins (Opción A)
- [ ] Testing con productos reales

### Fase 2 (Esta semana - 2-3 horas)
- [ ] Implementar cache de variations (Opción B)
- [ ] Migración de tabla ml_variation_cache

### Fase 3 (Opcional - 1-2 días)
- [ ] Progressive loading (Opción D)
- [ ] Background jobs (Opción E)

---

## Métricas a Medir

Después de Fase 1:
- Tiempo total de validación
- Número de rate limits (429 errors)
- Éxito rate de API calls

Después de Fase 2:
- Cache hit rate
- Tiempo de validación con cache caliente
