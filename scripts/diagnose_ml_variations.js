/**
 * Script para diagnosticar por qué PCR0007 y PCR0008 no se vinculan automáticamente
 *
 * Verifica:
 * 1. Si el search API encuentra el item al buscar por SKU
 * 2. Si las variaciones tienen el atributo SELLER_SKU correcto
 * 3. Si existe user_product_id en las variaciones
 */

const axios = require('axios');

const SELLER_ID = 241710025;
const ML_ITEM_ID = 'MLC2845450728';
const ACCESS_TOKEN = process.env.ML_ACCESS_TOKEN || 'TU_TOKEN_AQUI';

const SKUS_TO_TEST = ['PCR0007', 'PCR0008', 'PCR0009'];

async function searchBySku(sku) {
  try {
    const response = await axios.get(
      `https://api.mercadolibre.com/sites/MLC/search`,
      {
        params: {
          seller_id: SELLER_ID,
          q: sku,
        },
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
      }
    );
    return response.data.results || [];
  } catch (error) {
    return { error: error.message };
  }
}

async function getItemDetails(itemId) {
  try {
    const response = await axios.get(
      `https://api.mercadolibre.com/items/${itemId}`,
      {
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
      }
    );
    return response.data;
  } catch (error) {
    return { error: error.message };
  }
}

async function getVariationDetails(itemId, variationId) {
  try {
    const response = await axios.get(
      `https://api.mercadolibre.com/items/${itemId}/variations/${variationId}`,
      {
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
      }
    );
    return response.data;
  } catch (error) {
    return { error: error.message };
  }
}

function extractSellerSku(variation) {
  if (!variation.attributes) return null;
  const skuAttr = variation.attributes.find(a => a.id === 'SELLER_SKU');
  return skuAttr?.value_name || null;
}

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('🔍 DIAGNÓSTICO DE VINCULACIÓN AUTOMÁTICA ML');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Paso 1: Obtener detalles del item
  console.log('📦 Paso 1: Obteniendo detalles del item MLC-2845450728...\n');
  const itemData = await getItemDetails(ML_ITEM_ID);

  if (itemData.error) {
    console.error('❌ Error al obtener item:', itemData.error);
    return;
  }

  console.log(`✅ Item encontrado: ${itemData.title}`);
  console.log(`   Status: ${itemData.status}`);
  console.log(`   Variaciones: ${itemData.variations?.length || 0}`);
  console.log('');

  // Paso 2: Verificar cada SKU
  for (const sku of SKUS_TO_TEST) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`🔍 Analizando SKU: ${sku}`);
    console.log('─'.repeat(60));

    // 2a. Búsqueda por SKU
    console.log('\n1️⃣  Búsqueda en ML Search API:');
    const searchResults = await searchBySku(sku);

    if (searchResults.error) {
      console.log(`   ❌ Error: ${searchResults.error}`);
    } else if (searchResults.length === 0) {
      console.log(`   ❌ NO encontrado - La búsqueda por "${sku}" no devuelve resultados`);
      console.log(`   ⚠️  PROBLEMA: El sync no podrá vincular este producto automáticamente`);
    } else {
      console.log(`   ✅ Encontrado: ${searchResults.length} resultado(s)`);
      searchResults.forEach(item => {
        console.log(`      - ${item.id} (${item.title})`);
      });
    }

    // 2b. Verificar variaciones
    console.log('\n2️⃣  Variaciones con SELLER_SKU:');

    let matchFound = false;

    for (const variation of itemData.variations || []) {
      const fullDetails = await getVariationDetails(ML_ITEM_ID, variation.id);

      if (fullDetails.error) {
        console.log(`   ⚠️  Variación ${variation.id}: Error al obtener detalles`);
        continue;
      }

      const sellerSku = extractSellerSku(fullDetails);
      const matches = sellerSku?.toUpperCase() === sku.toUpperCase();

      if (matches) {
        matchFound = true;
        console.log(`   ✅ Variación ${variation.id}: SELLER_SKU = "${sellerSku}" ✓ MATCH`);
        console.log(`      - Stock: ${variation.available_quantity}`);
        console.log(`      - user_product_id: ${fullDetails.catalog_listing ? 'Sí' : fullDetails.seller_custom_field || 'No'}`);
      } else if (sellerSku) {
        console.log(`   ⚪ Variación ${variation.id}: SELLER_SKU = "${sellerSku}"`);
      } else {
        console.log(`   ❌ Variación ${variation.id}: Sin SELLER_SKU`);
      }
    }

    // Resumen
    console.log('\n3️⃣  Resultado:');
    const searchOk = !searchResults.error && searchResults.length > 0;
    const variationOk = matchFound;

    if (searchOk && variationOk) {
      console.log(`   ✅ El sync DEBERÍA vincular correctamente`);
    } else {
      console.log(`   ❌ El sync NO puede vincular automáticamente:`);
      if (!searchOk) {
        console.log(`      - ❌ La búsqueda por SKU no encuentra el item`);
      }
      if (!variationOk) {
        console.log(`      - ❌ Ninguna variación tiene SELLER_SKU = "${sku}"`);
      }
    }
  }

  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('💡 RECOMENDACIONES');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log('Si algún SKU no se vincula automáticamente, verifica:');
  console.log('');
  console.log('1. ❌ Búsqueda falla:');
  console.log('   → Verifica que el atributo SELLER_SKU esté configurado en ML');
  console.log('   → Edita el item en ML y asegúrate de guardar el SELLER_SKU');
  console.log('');
  console.log('2. ❌ Variación sin SELLER_SKU:');
  console.log('   → Entra a ML → Edita el producto → Sección "Variaciones"');
  console.log('   → Cada variación debe tener su SELLER_SKU único:');
  console.log('      • Variación 4MM  → SELLER_SKU: PCR0007');
  console.log('      • Variación 6MM  → SELLER_SKU: PCR0008');
  console.log('      • Variación 8MM  → SELLER_SKU: PCR0009');
  console.log('');
  console.log('3. ✅ Después de actualizar en ML:');
  console.log('   → Vuelve al frontend');
  console.log('   → Click en "Vincular con ML"');
  console.log('   → Debería crear los secondary_skus automáticamente');
  console.log('');
  console.log('═══════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
