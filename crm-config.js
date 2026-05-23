import axios from 'axios';

const CRM_URL = process.env.CRM_SUPABASE_URL;
const CRM_KEY = process.env.CRM_SUPABASE_KEY;
const CRM_USER_ID = process.env.CRM_USER_ID;

let cachedConfig = null;
let cacheTime = null;
const CACHE_TTL = 30 * 1000; // 30 segundos

export async function getCRMConfig() {
  console.log('getCRMConfig llamada - CRM_URL:', CRM_URL ? 'definida' : 'NO DEFINIDA');
  console.log('getCRMConfig - CRM_USER_ID:', CRM_USER_ID ? CRM_USER_ID : 'NO DEFINIDO');
  if (cachedConfig && Date.now() - cacheTime < CACHE_TTL) {
    return cachedConfig;
  }
  try {
    const res = await axios.get(
      `${CRM_URL}/rest/v1/constructora_config?user_id=eq.${CRM_USER_ID}&select=calc_precio_pb,calc_precio_duplex,calc_precio_cabana,calc_tna_fijo,calc_tna_cac,calc_km_gratis,calc_costo_km`,
      { headers: { apikey: CRM_KEY, Authorization: `Bearer ${CRM_KEY}` } }
    );
    console.log('getCRMConfig response status:', res.status);
    console.log('getCRMConfig data:', JSON.stringify(res.data));
    cachedConfig = res.data?.[0] || null;
    cacheTime = Date.now();
    console.log('Config CRM cargada - precio PB:', cachedConfig?.calc_precio_pb);
    return cachedConfig;
  } catch (err) {
    console.error('getCRMConfig error completo:', err.response?.status, err.response?.data, err.message);
    return null;
  }
}
