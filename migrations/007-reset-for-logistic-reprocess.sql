  -- 007-reset-for-logistic-reprocess.sql
  -- Limpia la BD para reprocesar notificaciones con la nueva logica de logistic_type en metadata.
  -- Solo reprocesa notificaciones recibidas desde 2026-02-02 en adelante.
  -- IMPORTANTE: Ejecutar ANTES de reiniciar el backend.

  -- Paso 1: Revertir stock de productos afectados por ordenes DESDE 2026-02-02
  -- adjustment_amount negativo = deduccion, positivo = restauracion
  -- Restar el adjustment_amount total revierte al stock original
  UPDATE products p
  SET stock = p.stock - COALESCE(sub.total_adj, 0)
  FROM (
    SELECT product_id, SUM(adjustment_amount) AS total_adj
    FROM product_history
    WHERE change_type = 'order'
      AND created_at >= '2026-02-02'
    GROUP BY product_id
  ) sub
  WHERE p.product_id = sub.product_id;

  -- Paso 2: Eliminar historial de cambios por ordenes desde 2026-02-02
  DELETE FROM product_history
  WHERE change_type = 'order'
    AND created_at >= '2026-02-02';

  -- Paso 3: Eliminar auditorias desde 2026-02-02
  DELETE FROM product_audits
  WHERE created_at >= '2026-02-02';

  -- Paso 4: Eliminar TODAS las ventas pendientes
  -- Las de antes de 2026-02-02 son del sistema viejo y no deben aparecer
  -- Las de desde 2026-02-02 se recrearán cuando se reprocesen las notificaciones
  DELETE FROM pending_sales;

  -- Paso 5: Marcar notificaciones desde 2026-02-02 como no procesadas y limpiar campos enriquecidos
  UPDATE notifications
  SET processed = false,
      event_type = NULL,
      summary = NULL,
      product_name = NULL,
      seller_sku = NULL,
      total_amount = NULL,
      currency_id = NULL,
      order_id = NULL,
      order_status = NULL,
      read = false,
      read_at = NULL
  WHERE topic = 'orders_v2'
    AND received >= '2026-02-02';
