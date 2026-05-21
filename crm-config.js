import axios from 'axios';

const CRM_URL = process.env.CRM_SUPABASE_URL;
const CRM_KEY = process.env.CRM_SUPABASE_KEY;
const CRM_USER_ID = process.env.CRM_USER_ID;

let cachedConfig = null;
let cacheTime = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

export async function getCRMConfig() {
  if (cachedConfig && Date.now() - cacheTime < CACHE_TTL) {
    return cachedConfig;
  }
  try {
    const res = await axios.get(
      `${CRM_URL}/rest/v1/constructora_config?user_id=eq.${CRM_USER_ID}&select=calc_precio_pb,calc_precio_duplex,calc_precio_cabana,calc_tna_fijo,calc_tna_cac,calc_km_gratis,calc_costo_km`,
      { headers: { apikey: CRM_KEY, Authorization: `Bearer ${CRM_KEY}` } }
    );
    cachedConfig = res.data?.[0] || null;
    cacheTime = Date.now();
    return cachedConfig;
  } catch (err) {
    console.error('Error leyendo config CRM:', err.message);
    return null;
  }
}
