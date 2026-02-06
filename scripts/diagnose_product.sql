-- Script de Diagnóstico: Por qué un producto no aparece en validación de stock
-- Uso: psql -U postgres -d tu_base_de_datos -f scripts/diagnose_product.sql
-- Cambia 'PCR0008' por el SKU que quieres investigar

\set sku 'PCR0008'

\echo '═══════════════════════════════════════════════════════════'
\echo '🔍 DIAGNÓSTICO DE PRODUCTO'
\echo '═══════════════════════════════════════════════════════════'
\echo ''

-- 1. Verificar si el producto existe
\echo '1️⃣  ¿Existe el producto?'
SELECT
  CASE
    WHEN COUNT(*) > 0 THEN '✅ SÍ - Producto encontrado'
    ELSE '❌ NO - Producto no existe en la base de datos'
  END AS resultado,
  COUNT(*) as cantidad
FROM products
WHERE internal_sku = :'sku';

\echo ''

-- 2. Ver datos completos del producto
\echo '2️⃣  Datos del Producto:'
SELECT
  product_id,
  internal_sku,
  name,
  stock,
  stock_bodega,
  (stock + stock_bodega) as stock_total,
  cost,
  price
FROM products
WHERE internal_sku = :'sku';

\echo ''

-- 3. Verificar si tiene secondary SKU vinculado a Mercado Libre
\echo '3️⃣  ¿Tiene SKU vinculado a Mercado Libre?'
SELECT
  CASE
    WHEN COUNT(*) > 0 THEN '✅ SÍ - Vinculado a ML'
    ELSE '❌ NO - No está vinculado a Mercado Libre (platform_id = 1)'
  END AS resultado,
  COUNT(*) as cantidad
FROM secondary_skus ss
JOIN products p ON p.product_id = ss."productProductId"
WHERE p.internal_sku = :'sku'
  AND ss."platformPlatformId" = 1;

\echo ''

-- 4. Ver detalles del secondary SKU
\echo '4️⃣  Detalles del Secondary SKU en ML:'
SELECT
  ss.secondary_sku_id,
  ss.secondary_sku as ml_item_id,
  ss.stock_quantity,
  ss.publication_link,
  ss.logistic_type,
  ss.variation_id,
  ss.user_product_id
FROM secondary_skus ss
JOIN products p ON p.product_id = ss."productProductId"
WHERE p.internal_sku = :'sku'
  AND ss."platformPlatformId" = 1;

\echo ''

-- 5. Verificar si está en los snapshots de validación
\echo '5️⃣  ¿Aparece en validaciones recientes?'
SELECT
  snapshot_id,
  created_at,
  total_items,
  matching_count,
  discrepancy_count,
  error_count
FROM ml_stock_validation_snapshots
ORDER BY created_at DESC
LIMIT 3;

\echo ''

-- 6. Buscar en los resultados JSON del último snapshot
\echo '6️⃣  ¿Aparece en el último snapshot? (buscando en JSON)'
WITH latest_snapshot AS (
  SELECT
    snapshot_id,
    created_at,
    results_data
  FROM ml_stock_validation_snapshots
  ORDER BY created_at DESC
  LIMIT 1
)
SELECT
  'Matching' as tipo,
  COUNT(*) as encontrado
FROM latest_snapshot,
     jsonb_array_elements(results_data->'matching') as item
WHERE item->>'internal_sku' = :'sku'
UNION ALL
SELECT
  'Discrepancies' as tipo,
  COUNT(*) as encontrado
FROM latest_snapshot,
     jsonb_array_elements(results_data->'discrepancies') as item
WHERE item->>'internal_sku' = :'sku'
UNION ALL
SELECT
  'Errors' as tipo,
  COUNT(*) as encontrado
FROM latest_snapshot,
     jsonb_array_elements(results_data->'errors') as item
WHERE item->>'internal_sku' = :'sku';

\echo ''

-- 7. Verificar en product_mappings (si existe)
\echo '7️⃣  Product Mappings:'
SELECT
  pm.mapping_id,
  pm.platform_sku,
  plat.name as platform_name,
  pm.quantity,
  pm.is_active
FROM product_mappings pm
JOIN products p ON p.product_id = pm.product_id
JOIN platforms plat ON plat.platform_id = pm.platform_id
WHERE p.internal_sku = :'sku';

\echo ''
\echo '═══════════════════════════════════════════════════════════'
\echo '💡 POSIBLES RAZONES POR LAS QUE NO APARECE:'
\echo '═══════════════════════════════════════════════════════════'
\echo '1. Item pausado en ML (se omiten automáticamente)'
\echo '2. No tiene user_product_id válido en variaciones'
\echo '3. Error al consultar API de ML para este item'
\echo '4. Logistic type = xd_drop_off sin variaciones válidas'
\echo '5. Item sin variaciones y sin inventory_id'
\echo ''
\echo 'Ejecuta este query para verificar manualmente en ML:'
\echo '  curl "https://api.mercadolibre.com/items/MLC-{secondary_sku}"'
\echo '═══════════════════════════════════════════════════════════'
