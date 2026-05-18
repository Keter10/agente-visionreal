import axios from 'axios';

const SUPABASE_URL = 'https://zwpvpqnrhrvdspfdlwyn.supabase.co';
const ANON_KEY = process.env.VELOX_SUPABASE_KEY;
console.log('VELOX_SUPABASE_KEY:', ANON_KEY ? ANON_KEY.slice(0, 20) + '...' : 'NO DEFINIDA');
const EMPLEADO_ID = '6536bc38-2add-4c97-a158-8c3d72e58e42';
const NEGOCIO_ID = 'fb0b9b4f-97dd-4b91-ac2c-3fe68dc74d75';
const SERVICIO_ID = '3a15d947-2a0f-4596-9701-5abc1a579f24';
const LOCAL_ID = '72e60578-27eb-466b-a930-4fe27f29a262';

const WORK_START = 9;
const WORK_END = 18;

const HEADERS = {
  apikey: ANON_KEY,
  Authorization: `Bearer ${ANON_KEY}`,
  'Content-Type': 'application/json',
};

function getArgentinaDate() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatLabel(date, hour) {
  const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const h12 = hour > 12 ? hour - 12 : hour;
  const ampm = hour >= 12 ? 'pm' : 'am';
  return `${days[date.getDay()]} ${date.getDate()} de ${months[date.getMonth()]} a las ${h12}${ampm}`;
}

function getBusinessDays(count) {
  const days = [];
  const cursor = getArgentinaDate();
  cursor.setDate(cursor.getDate() + 1);
  cursor.setHours(0, 0, 0, 0);
  while (days.length < count) {
    if (cursor.getDay() !== 0) days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

async function getOccupiedHours(fecha) {
  const base = `${SUPABASE_URL}/rest/v1`;
  const [turnosRes, bloqueosRes] = await Promise.all([
    axios.get(
      `${base}/turnos?empleado_id=eq.${EMPLEADO_ID}&fecha=eq.${fecha}&select=hora,estado`,
      { headers: HEADERS }
    ),
    axios.get(
      `${base}/bloqueos?empleado_id=eq.${EMPLEADO_ID}&fecha=eq.${fecha}&select=hora`,
      { headers: HEADERS }
    ),
  ]);

  const occupied = new Set();
  for (const t of turnosRes.data) {
    if (t.estado !== 'cancelado') occupied.add(t.hora.slice(0, 5));
  }
  for (const b of bloqueosRes.data) {
    occupied.add(b.hora.slice(0, 5));
  }
  return occupied;
}

export async function getAvailableSlots() {
  try {
    const days = getBusinessDays(6);
    const slots = [];

    for (const day of days) {
      const fechaStr = formatDate(day);
      const occupied = await getOccupiedHours(fechaStr);

      for (let h = WORK_START; h < WORK_END; h++) {
        const horaStr = `${String(h).padStart(2, '0')}:00`;
        if (occupied.has(horaStr)) continue;

        slots.push({
          fecha: fechaStr,
          hora: horaStr,
          label: formatLabel(day, h),
        });

        if (slots.length >= 6) break;
      }
      if (slots.length >= 6) break;
    }

    return slots.length > 0 ? slots : null;
  } catch (err) {
    console.error('Error obteniendo slots de Velox:', err.message);
    return null;
  }
}

export async function createTurno(clientName, clientPhone, slotFecha, slotHora) {
  const body = {
    negocio_id: NEGOCIO_ID,
    empleado_id: EMPLEADO_ID,
    servicio_id: SERVICIO_ID,
    local_id: LOCAL_ID,
    fecha: slotFecha,
    hora: slotHora,
    estado: 'pendiente',
    monto_sena: 0,
    monto_total: 0,
    notas: `Turno agendado por WhatsApp - ${clientName} - ${clientPhone}`,
  };
  const headers = { ...HEADERS, Prefer: 'return=representation' };
  console.log('Creando turno en Velox - URL:', `${SUPABASE_URL}/rest/v1/turnos`);
  console.log('Creando turno en Velox - Body:', JSON.stringify(body, null, 2));
  try {
    const res = await axios.post(
      `${SUPABASE_URL}/rest/v1/turnos`,
      body,
      { headers }
    );
    return res.data;
  } catch (err) {
    console.error('Error creando turno en Velox:', err.message);
    console.error('Supabase error detail:', JSON.stringify(err.response?.data, null, 2));
    return null;
  }
}

export function isVeloxReady() {
  return true;
}
