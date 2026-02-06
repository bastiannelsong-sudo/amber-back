-- Verificar secondary_skus para PCR0007, PCR0008, PCR0009

\echo '🔍 Verificando secondary_skus...'
\echo ''

SELECT
    p.internal_sku,
    p.stock,
    p.stock_bodega,
    p.stock + COALESCE(p.stock_bodega, 0) as total_local,
    ss.secondary_sku_id,
    ss.secondary_sku as ml_item_id,
    ss.variation_id,
    ss.logistic_type,
    TO_CHAR(ss.created_at, 'YYYY-MM-DD HH24:MI:SS') as created_at
FROM secondary_skus ss
JOIN products p ON p.product_id = ss."productProductId"
WHERE p.internal_sku IN ('PCR0007', 'PCR0008', 'PCR0009')
  AND ss."platformPlatformId" = 1
ORDER BY p.internal_sku, ss.created_at;

\echo ''
\echo '📊 Conteo por SKU:'
SELECT
    p.internal_sku,
    COUNT(*) as num_secondary_skus
FROM secondary_skus ss
JOIN products p ON p.product_id = ss."productProductId"
WHERE p.internal_sku IN ('PCR0007', 'PCR0008', 'PCR0009')
  AND ss."platformPlatformId" = 1
GROUP BY p.internal_sku
ORDER BY p.internal_sku;
