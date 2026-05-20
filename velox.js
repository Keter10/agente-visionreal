import axios from 'axios';

const SUPABASE_URL = 'https://zwpvpqnrhrvdspfdlwyn.supabase.co';
const ANON_KEY = process.env.VELOX_SUPABASE_KEY;
console.log('VELOX_SUPABASE_KEY:', ANON_KEY ? ANON_KEY.slice(0, 20) + '...' : 'NO DEFINIDA');
const EMPLEADO_ID = '6536bc38-2add-4c97-a158-8c3d72e58e42';
const NEGOCIO_ID = 'fb0b9b4f-97dd-4b91-ac2c-3fe68dc74d75';
const SERVICIO_ID = '3a15d947-2a0f-4596-9701-5abc1a579f24';
const LOCAL_ID = '72e60578-27eb-466b-a930-4fe27f29a262';

const DAY_MAP = { dom: 0, lun: 1, mar: 2, mie: 3, jue: 4, vie: 5, sab: 6 };

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

function getWorkingDays(count, activeDays) {
  const days = [];
  const cursor = getArgentinaDate();
  cursor.setDate(cursor.getDate() + 1);
  cursor.setHours(0, 0, 0, 0);
  while (days.length < count) {
    if (activeDays.has(cursor.getDay())) days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

async function getSchedule() {
  const res = await axios.get(
    `${SUPABASE_URL}/rest/v1/locales?negocio_id=eq.${NEGOCIO_ID}&select=dias_atencion,horario_apertura,horario_cierre`,
    { headers: HEADERS }
  );
  console.log('Locales raw:', JSON.stringify(res.data));
  const local = res.data[0];
  if (!local) throw new Error('No se encontró configuración en tabla locales');
  const diasRaw = local.dias_atencion;
  console.log('dias_atencion tipo:', typeof diasRaw, '| valor:', JSON.stringify(diasRaw));

  let diasArray;
  if (Array.isArray(diasRaw)) {
    diasArray = diasRaw;
  } else if (typeof diasRaw === 'string') {
    try {
      diasArray = JSON.parse(diasRaw);
    } catch {
      diasArray = diasRaw.split(',').map(d => d.trim());
    }
  } else {
    diasArray = [];
  }

  console.log('diasArray resultado:', diasArray, '| isArray:', Array.isArray(diasArray));
  const activeDays = new Set(
    diasArray.map((d) => DAY_MAP[d]).filter((n) => n !== undefined)
  );
  const workStart = parseInt(local.horario_apertura?.slice(0, 2) ?? '9', 10);
  const workEnd = parseInt(local.horario_cierre?.slice(0, 2) ?? '18', 10);
  console.log('Días activos:', [...activeDays]);
  console.log('Horario:', workStart, '-', workEnd);
  return { activeDays, workStart, workEnd };
}

async function getOccupiedHours(fecha) {
  const base = `${SUPABASE_URL}/rest/v1`;
  const [turnosRes, bloqueosRes] = await Promise.all([
    axios.get(
      `${base}/turnos?empleado_id=eq.${EMPLEADO_ID}&fecha=eq.${fecha}&select=hora,estado`,
      { headers: HEADERS }
    ),
    axios.get(
      `${base}/bloqueos?empleado_id=eq.${EMPLEADO_ID}&fecha=eq.${fecha}&select=*`,
      { headers: HEADERS }
    ),
  ]);

  console.log(`Bloqueos para ${fecha}:`, JSON.stringify(bloqueosRes.data));

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
    const { activeDays, workStart, workEnd } = await getSchedule();
    // Look ahead up to 14 days to find 6 available slots
    const days = getWorkingDays(14, activeDays);
    const slots = [];

    for (const day of days) {
      const fechaStr = formatDate(day);
      const occupied = await getOccupiedHours(fechaStr);

      for (let h = workStart; h < workEnd; h++) {
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

    console.log('Slots generados:', slots.length);
    if (slots.length === 0) console.log('Sin slots disponibles: todos los horarios ocupados o bloqueados en los próximos 14 días');
    return slots.length > 0 ? slots : null;
  } catch (err) {
    console.error('Error obteniendo slots de Velox:', err.message);
    console.error('Stack:', err.stack);
    return null;
  }
}

export async function createTurno(clientName, clientPhone, slotFecha, slotHora, email = null, notes = '') {
  try {
    const base = `${SUPABASE_URL}/rest/v1`;
    const postHeaders = { ...HEADERS, Prefer: 'return=representation' };

    // Step 1: buscar cliente existente
    const busqueda = await axios.get(
      `${base}/usuarios?negocio_id=eq.${NEGOCIO_ID}&telefono=eq.${clientPhone}&rol=eq.cliente&select=id`,
      { headers: HEADERS }
    );

    const observaciones = (notes && notes.trim()) ? notes.trim() : null;

    let clienteId;
    if (busqueda.data.length > 0) {
      clienteId = busqueda.data[0].id;
      console.log(`Cliente existente en Velox: ${clienteId}`);
      // Actualizar observaciones con la info nueva de esta conversación
      if (observaciones) {
        const patchUrl = `${base}/usuarios?id=eq.${clienteId}`;
        console.log('PATCH cliente URL:', patchUrl);
        console.log('PATCH cliente body:', JSON.stringify({ observaciones }));
        try {
          const patchRes = await axios.patch(patchUrl, { observaciones }, { headers: HEADERS });
          console.log('PATCH cliente status:', patchRes.status, '| data:', JSON.stringify(patchRes.data));
        } catch (patchErr) {
          console.error('PATCH cliente error:', patchErr.message);
          console.error('PATCH cliente error detail:', JSON.stringify(patchErr.response?.data));
        }
      }
    } else {
      // Step 2: crear cliente con observaciones
      const clienteRes = await axios.post(
        `${base}/usuarios`,
        {
          negocio_id: NEGOCIO_ID,
          nombre: clientName || 'Cliente WhatsApp',
          email: email || `sin-email-${clientPhone}@velox.app`,
          rol: 'cliente',
          telefono: clientPhone,
          activo: true,
          mostrar_como_prof: false,
          ...(observaciones && { observaciones }),
        },
        { headers: postHeaders }
      );
      clienteId = clienteRes.data[0]?.id ?? clienteRes.data?.id;
      console.log(`Cliente creado en Velox: ${clienteId}`);
    }

    // Step 3: crear turno linkeado al cliente
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
      cliente_id: clienteId,
      notas: (notes && notes.trim()) ? notes.trim() : `Turno agendado por WhatsApp - ${clientName} - ${clientPhone}`,
    };
    console.log('Creando turno en Velox - URL:', `${base}/turnos`);
    console.log('Creando turno en Velox - Body:', JSON.stringify(body, null, 2));
    const turnoRes = await axios.post(`${base}/turnos`, body, { headers: postHeaders });
    return turnoRes.data;
  } catch (err) {
    console.error('Error creando turno en Velox:', err.message);
    console.error('Supabase error detail:', JSON.stringify(err.response?.data, null, 2));
    return null;
  }
}

export function isVeloxReady() {
  return true;
}
