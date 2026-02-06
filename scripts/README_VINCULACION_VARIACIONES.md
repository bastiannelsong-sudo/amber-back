# Por Qué Algunos Productos No Se Vinculan Automáticamente

## Problema

Productos como **PCR0007** y **PCR0008** no aparecen en la validación de stock, aunque están en el inventario local.

### Diagnóstico
```bash
curl http://localhost:3000/mercadolibre/stock/diagnose/PCR0008
```

Resultado:
```json
{
  "product_exists": true,
  "linked_to_ml": false,  // ❌ No tiene secondary_sku
  "has_variation_id": false
}
```

---

## Causa Raíz

El botón **"Vincular con ML"** llama al endpoint `/mercadolibre/images/sync`, que funciona así:

### Flujo de Vinculación Automática

```
1. 📤 Busca en ML Search API: "PCR0007"
   ↓
2. 📦 Si encuentra item, obtiene sus variaciones
   ↓
3. 🔍 Para cada variación, busca el atributo SELLER_SKU
   ↓
4. ✅ Si SELLER_SKU = "PCR0007" → Crea secondary_sku con variation_id
```

**El problema:** Si la variación en ML NO tiene el atributo `SELLER_SKU` configurado, el sync NO puede hacer el match.

---

## Caso: MLC-2845450728 (Pulseras)

Este item tiene 3 variaciones que corresponden a 3 productos locales:

| Variación ML | Descripción | SKU Local | SELLER_SKU esperado |
|--------------|-------------|-----------|---------------------|
| Variación A  | 4MM         | PCR0007   | PCR0007             |
| Variación B  | 6MM         | PCR0008   | PCR0008             |
| Variación C  | 8MM         | PCR0009   | PCR0009             |

**Si PCR0009 se vincula pero PCR0007 y PCR0008 no:**

→ Significa que solo la variación C tiene `SELLER_SKU = "PCR0009"` configurado en ML

→ Las otras dos variaciones NO tienen SELLER_SKU o tienen un valor incorrecto

---

## Solución

### Opción 1: Configurar SELLER_SKU en Mercado Libre (RECOMENDADO)

1. **Entra a Mercado Libre**
   - Ve a "Mis publicaciones"
   - Busca el item MLC-2845450728

2. **Edita las Variaciones**
   - Click en "Editar publicación"
   - Ve a la sección "Variaciones"

3. **Configura SELLER_SKU para cada variación:**
   ```
   Variación 1 (4MM)  → SELLER_SKU: PCR0007
   Variación 2 (6MM)  → SELLER_SKU: PCR0008
   Variación 3 (8MM)  → SELLER_SKU: PCR0009
   ```

4. **Guarda los cambios**

5. **Vuelve al frontend**
   - Click en "Vincular con ML"
   - Ahora debería crear los 3 secondary_skus automáticamente ✅

---

### Opción 2: Script SQL Manual (TEMPORAL)

Si necesitas una solución inmediata mientras configuras ML:

```bash
psql -U postgres -d tu_base_de_datos -f scripts/fix_pcr_secondary_skus.sql
```

⚠️ **Limitación:** Este script crea los links pero NO establece `variation_id`, por lo que:
- Aparecerán en la validación
- Pero el stock se sumará de todas las variaciones (no ideal)

---

## Verificación

### 1. Ejecutar Diagnóstico

```bash
cd amber-back
node scripts/diagnose_ml_variations.js
```

Este script te dirá:
- ✅ Si la búsqueda por SKU funciona
- ✅ Si cada variación tiene SELLER_SKU configurado
- ❌ Qué falta para que el sync funcione

### 2. Probar Vinculación

Después de configurar SELLER_SKU en ML:

1. Frontend → Click "Vincular con ML"
2. Verificar en base de datos:
```sql
SELECT
  p.internal_sku,
  ss.secondary_sku,
  ss.variation_id,
  ss.logistic_type
FROM secondary_skus ss
JOIN products p ON p.product_id = ss."productProductId"
WHERE p.internal_sku IN ('PCR0007', 'PCR0008', 'PCR0009')
ORDER BY p.internal_sku;
```

Deberías ver:
```
internal_sku | secondary_sku | variation_id | logistic_type
-------------|---------------|--------------|---------------
PCR0007      | 2845450728    | 123456       | cross_docking
PCR0008      | 2845450728    | 789012       | cross_docking
PCR0009      | 2845450728    | 345678       | cross_docking
```

✅ Cada producto con su **variation_id único**

---

## Código Relevante

### Backend: `/mercadolibre/images/sync`
**Archivo:** `amber-back/src/mercadolibre/mercadolibre.controller.ts:938-1260`

**Lógica clave:**
```typescript
// Línea 1106-1120: Match por SELLER_SKU
for (const variation of mlItem.variations) {
  const fullDetails = variationDetailsMap.get(variation.id);
  const varSku = fullDetails ? getSellerSkuFromVariation(fullDetails) : null;

  if (varSku && varSku.toUpperCase() === product.internal_sku.toUpperCase()) {
    matchedVariationId = variation.id; // ✅ Match encontrado
    stockToUse = variation.available_quantity ?? 0;
    break;
  }
}

// Línea 1152-1161: Crear secondary_sku con variation_id
linksToCreate.push({
  secondary_sku: mlItem.id,
  stock_quantity: stockToUse,
  logistic_type: logisticType,
  variation_id: matchedVariationId, // 🔑 Clave para variaciones
  product: { product_id: product.product_id },
  platform: { platform_id: 1 },
});
```

### Frontend: Botón "Vincular con ML"
**Archivo:** `amber-front/src/hooks/useMercadoLibre.ts:210-257`

```typescript
export function useSyncImagesFromML(sellerId: number = SELLER_ID) {
  return useMutation<FullSyncResult, Error, Record<string, never>>({
    mutationFn: async () => {
      const response = await api.post(
        `/mercadolibre/images/sync?seller_id=${sellerId}`,
        {}
      );
      return response.data;
    },
    // ...
  });
}
```

---

## Checklist

- [ ] Verificar que el item existe en ML
- [ ] Confirmar que tiene variaciones
- [ ] Cada variación tiene SELLER_SKU único configurado
- [ ] SELLER_SKU coincide EXACTAMENTE con internal_sku (case-insensitive)
- [ ] Ejecutar script de diagnóstico para verificar
- [ ] Click "Vincular con ML" en el frontend
- [ ] Verificar en DB que se crearon secondary_skus con variation_id
- [ ] Ejecutar validación de stock para confirmar que aparecen

---

## Referencias

- **Migration:** `migrations/2026-02-05_stock_validation_cache/`
- **Entity:** `src/mercadolibre/entities/stock-validation-snapshot.entity.ts`
- **Endpoint Sync:** `src/mercadolibre/mercadolibre.controller.ts:938` (POST /images/sync)
- **Endpoint Diagnose:** `src/mercadolibre/mercadolibre.controller.ts:267` (GET /stock/diagnose/:sku)
- **SQL Fix (temporal):** `scripts/fix_pcr_secondary_skus.sql`
- **Diagnóstico JS:** `scripts/diagnose_ml_variations.js`
