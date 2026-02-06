-- ⚠️  FIX TEMPORAL: Insertar secondary_skus faltantes para PCR0007, PCR0008, PCR0009
-- Estos 3 productos son variaciones del mismo item en ML: MLC-2845450728
--
-- IMPORTANTE: Esta es una solución temporal. La solución correcta es:
-- 1. Configurar SELLER_SKU en cada variación del item en Mercado Libre
-- 2. Usar el botón "Vincular con ML" que creará los links automáticamente
--
-- ⚠️  LIMITACIÓN: Este script NO establece variation_id, por lo que
-- el stock se sumará de todas las variaciones en lugar de mostrar individual
--
-- Para la solución correcta, ver: scripts/README_VINCULACION_VARIACIONES.md

-- Verificar productos existentes
SELECT
    p.product_id,
    p.internal_sku,
    p.name,
    p.stock
FROM products p
WHERE p.internal_sku IN ('PCR0007', 'PCR0008', 'PCR0009')
ORDER BY p.internal_sku;

-- Verificar secondary_skus actuales
SELECT
    p.internal_sku,
    ss.secondary_sku,
    ss."platformPlatformId",
    plat.name as platform_name
FROM products p
LEFT JOIN secondary_skus ss ON p.product_id = ss."productProductId"
LEFT JOIN platforms plat ON ss."platformPlatformId" = plat.platform_id
WHERE p.internal_sku IN ('PCR0007', 'PCR0008', 'PCR0009')
ORDER BY p.internal_sku;

-- Insertar secondary_skus para Mercado Libre (platform_id = 1)
-- IMPORTANTE: Los 3 productos comparten el mismo item de ML (2845450728)
-- porque son variaciones del mismo producto

-- PCR0007 - Variación 4MM
INSERT INTO secondary_skus (
    secondary_sku,
    stock_quantity,
    "productProductId",
    "platformPlatformId",
    publication_link,
    logistic_type
)
SELECT
    '2845450728',
    0,
    product_id,
    1,
    'https://articulo.mercadolibre.cl/MLC-2845450728',
    'cross_docking'
FROM products
WHERE internal_sku = 'PCR0007'
ON CONFLICT DO NOTHING;

-- PCR0008 - Variación 6MM
INSERT INTO secondary_skus (
    secondary_sku,
    stock_quantity,
    "productProductId",
    "platformPlatformId",
    publication_link,
    logistic_type
)
SELECT
    '2845450728',
    0,
    product_id,
    1,
    'https://articulo.mercadolibre.cl/MLC-2845450728',
    'cross_docking'
FROM products
WHERE internal_sku = 'PCR0008'
ON CONFLICT DO NOTHING;

-- PCR0009 - Variación 8MM (Rojo grueso)
INSERT INTO secondary_skus (
    secondary_sku,
    stock_quantity,
    "productProductId",
    "platformPlatformId",
    publication_link,
    logistic_type
)
SELECT
    '2845450728',
    0,
    product_id,
    1,
    'https://articulo.mercadolibre.cl/MLC-2845450728',
    'cross_docking'
FROM products
WHERE internal_sku = 'PCR0009'
ON CONFLICT DO NOTHING;

-- Verificar que se insertaron correctamente
SELECT
    p.internal_sku,
    p.name,
    ss.secondary_sku,
    ss.logistic_type,
    plat.name as platform_name,
    ss.publication_link
FROM products p
JOIN secondary_skus ss ON p.product_id = ss."productProductId"
JOIN platforms plat ON ss."platformPlatformId" = plat.platform_id
WHERE p.internal_sku IN ('PCR0007', 'PCR0008', 'PCR0009')
  AND plat.platform_id = 1
ORDER BY p.internal_sku;

-- Mensaje final
\echo ''
\echo '✅ Secondary SKUs insertados correctamente'
\echo '📝 Los 3 productos ahora están vinculados al mismo item de ML: MLC-2845450728'
\echo ''
\echo 'Siguiente paso: Ejecutar nueva validación de stock para verificar'
