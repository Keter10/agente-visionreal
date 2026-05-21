import axios from 'axios';

const CRM_URL = process.env.CRM_SUPABASE_URL;
const CRM_KEY = process.env.CRM_SUPABASE_KEY;

export async function upsertLeadCRM(data) {
  // data: { nombre, telefono, modelo, zona, presupuesto, notas, origen }
  try {
    // Buscar si ya existe un lead con ese teléfono
    const search = await axios.get(
      `${CRM_URL}/rest/v1/constructora_leads?telefono=eq.${data.telefono}&select=id`,
      { headers: { apikey: CRM_KEY, Authorization: `Bearer ${CRM_KEY}` } }
    );

    const existing = search.data?.[0];

    const payload = {
      nombre: data.nombre || 'Cliente WhatsApp',
      telefono: data.telefono,
      proyecto: data.modelo || null,
      zona: data.zona || null,
      presupuesto_estimado: data.presupuesto || null,
      notas: data.notas || null,
      origen: 'WhatsApp',
      estado: 'Nuevo',
      user_id: process.env.CRM_USER_ID
    };

    if (existing) {
      // Actualizar lead existente
      await axios.patch(
        `${CRM_URL}/rest/v1/constructora_leads?id=eq.${existing.id}`,
        payload,
        { headers: { apikey: CRM_KEY, Authorization: `Bearer ${CRM_KEY}`, 'Content-Type': 'application/json' } }
      );
    } else {
      // Crear lead nuevo
      await axios.post(
        `${CRM_URL}/rest/v1/constructora_leads`,
        payload,
        { headers: { apikey: CRM_KEY, Authorization: `Bearer ${CRM_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' } }
      );
    }
    console.log(`Lead CRM actualizado: ${data.telefono}`);
  } catch (err) {
    console.error('Error actualizando lead CRM:', err.message);
  }
}
