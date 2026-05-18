import axios from 'axios';

const SUPABASE_URL = 'https://zwpvpqnrhrvdspfdlwyn.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp3cHZwcW5yaHJ2ZHNwZmRsd3luIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMjEzNTQsImV4cCI6MjA4ODU5NzM1NH0.4LJnkwAIB9KUhzfe5KN3p_ZZWQD0rUhJS679KP0kAEU';
const EMPLEADO_ID = '6536bc38-2add-4c97-a158-8c3d72e58e42';
const NEGOCIO_ID = 'fb0b9b4f-97dd-4b91-ac2c-3fe68dc74d75';
const SERVICIO_ID = '3a15d947-2a0f-4596-9701-5abc1a579f24';
const LOCAL_ID = '72e60578-27eb-466b-a930-4fe27f29a262';

const WORK_START = 9;
const WORK_END = 18;

const supabaseHeaders = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
};

function getArgentinaDate() {
  // Argentina is UTC-3, no DST
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc - 3 * 3600000);
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
  const h12 = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  const ampm = hour >= 12 ? 'pm' : 'am';
  return `${days[date.getDay()]} ${date.getDate()} de ${months[date.getMonth()]} a las ${h12}${ampm}`;
}

function getBusinessDays(count) {
  const days = [];
  const cursor = getArgentinaDate();
  cursor.setDate(cursor.getDate() + 1);
  cursor.setHours(0, 0, 0, 0);
  while (days.length < count) {
    if (cursor.getDay() !== 0) days.push(new Date(cursor)); // skip Sunday
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

export async function getAvailableSlots() {
  try {
    const days = getBusinessDays(7);
    const startDate = formatDate(days[0]);
    const endDate = formatDate(days[days.length - 1]);

    const [turnosRes, bloqueosRes] = await Promise.all([
      axios.get(`${SUPABASE_URL}/rest/v1/turnos`, {
        headers: supabaseHeaders,
        params: {
          select: 'fecha,hora',
          empleado_id: `eq.${EMPLEADO_ID}`,
          fecha: `gte.${startDate}`,
          'fecha.lte': endDate,
          estado: 'neq.cancelado',
        },
      }),
      axios.get(`${SUPABASE_URL}/rest/v1/bloqueos`, {
        headers: supabaseHeaders,
        params: {
          select: 'fecha,hora_inicio,hora_fin',
          empleado_id: `eq.${EMPLEADO_ID}`,
          fecha: `gte.${startDate}`,
          'fecha.lte': endDate,
        },
      }),
    ]);

    const booked = new Set(
      turnosRes.data.map((t) => `${t.fecha}|${t.hora.slice(0, 5)}`)
    );
    const bloqueos = bloqueosRes.data;

    const slots = [];
    for (const day of days) {
      const fechaStr = formatDate(day);
      for (let h = WORK_START; h < WORK_END; h++) {
        const horaKey = `${String(h).padStart(2, '0')}:00`;
        if (booked.has(`${fechaStr}|${horaKey}`)) continue;

        const bloqueado = bloqueos.some((b) => {
          if (b.fecha !== fechaStr) return false;
          const ini = parseInt(b.hora_inicio.slice(0, 2), 10);
          const fin = parseInt(b.hora_fin.slice(0, 2), 10);
          return h >= ini && h < fin;
        });
        if (bloqueado) continue;

        slots.push({
          fecha: fechaStr,
          hora: `${horaKey}:00`,
          label: formatLabel(day, h),
          start: `${fechaStr}T${horaKey}:00`,
          end: `${fechaStr}T${String(h + 1).padStart(2, '0')}:00:00`,
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
  try {
    const res = await axios.post(
      `${SUPABASE_URL}/rest/v1/turnos`,
      {
        negocio_id: NEGOCIO_ID,
        empleado_id: EMPLEADO_ID,
        servicio_id: SERVICIO_ID,
        local_id: LOCAL_ID,
        fecha: slotFecha,
        hora: slotHora,
        cliente_nombre: clientName,
        cliente_telefono: clientPhone,
        estado: 'pendiente',
        origen: 'whatsapp',
      },
      { headers: { ...supabaseHeaders, Prefer: 'return=representation' } }
    );
    return res.data;
  } catch (err) {
    console.error('Error creando turno en Velox:', err.message);
    return null;
  }
}

export function isVeloxReady() {
  return true;
}
