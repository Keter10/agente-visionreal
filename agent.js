import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT } from './knowledge.js';
import { getFinancingPlans } from './financing.js';
import { getAvailableSlots, createEvent, isCalendarReady } from './calendar.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const conversations = new Map();
const HISTORY_TTL_MS = 30 * 60 * 1000;
const MAX_HISTORY_MESSAGES = 20;

function getEntry(userId) {
  const entry = conversations.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.lastActivity > HISTORY_TTL_MS) {
    conversations.delete(userId);
    return null;
  }
  return entry;
}

function getHistory(userId) {
  return getEntry(userId)?.messages || [];
}

function getOfferedSlots(userId) {
  return getEntry(userId)?.offeredSlots ?? null;
}

function updateHistory(userId, messages) {
  const trimmed =
    messages.length > MAX_HISTORY_MESSAGES
      ? messages.slice(messages.length - MAX_HISTORY_MESSAGES)
      : messages;
  const current = conversations.get(userId);
  conversations.set(userId, {
    messages: trimmed,
    lastActivity: Date.now(),
    offeredSlots: current?.offeredSlots ?? null,
  });
}

function setOfferedSlots(userId, slots) {
  const entry = conversations.get(userId);
  if (entry) entry.offeredSlots = slots;
}

function formatSlotsBlock(slots) {
  if (!slots?.length) return null;
  const lines = [
    '## HORARIOS DISPONIBLES PARA REUNIÓN CON MARTÍN',
    'Ofrecé estas opciones exactas cuando el cliente quiera agendar. Si el cliente elige una, confirmá el horario elegido.',
    '',
  ];
  slots.forEach((s, i) => lines.push(`Opción ${i + 1}: ${s.label}`));
  return lines.join('\n');
}

function buildSystemBlocks(availableSlots = null) {
  const blocks = [
    { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
  ];

  const financingPlans = getFinancingPlans();
  if (financingPlans) {
    blocks.push({
      type: 'text',
      text: `## PLANES DE FINANCIACIÓN DISPONIBLES\nUsá estos datos concretos cuando el cliente pregunte por financiación.\n\n${financingPlans}`,
    });
  }

  const slotsText = formatSlotsBlock(availableSlots);
  if (slotsText) {
    blocks.push({ type: 'text', text: slotsText });
  }

  return blocks;
}

async function generateResponse(userId, userMessage, availableSlots = null) {
  const history = getHistory(userId);
  const messages = [...history, { role: 'user', content: userMessage }];

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: buildSystemBlocks(availableSlots),
    messages,
  });

  const assistantMessage = response.content[0].text;
  updateHistory(userId, [...messages, { role: 'assistant', content: assistantMessage }]);

  return assistantMessage;
}

async function analyzeConversation(userMessage, historySummary) {
  const prompt = `Analizá este intercambio de WhatsApp de venta de viviendas prefabricadas en Argentina. Precios en PESOS ARGENTINOS.

Historial reciente:
${historySummary || '(sin historial previo)'}

Último mensaje del cliente: "${userMessage}"

Respondé SOLO con JSON válido, sin texto extra:
{
  "intent": "ALTA|MEDIA|BAJA|NINGUNA",
  "stage": "saludo|necesidad|presupuesto|presentacion|objecion|cierre|agenda",
  "wants_meeting": false,
  "confirmed_slot_index": null,
  "budget_ars": null,
  "payment_type": "contado|financiacion|desconocido",
  "client_name": null,
  "monthly_payment_ars": null,
  "model_chosen": null,
  "zone": null,
  "preferred_time": null,
  "notes": ""
}

Reglas:
- intent ALTA: quiere comprar, pide presupuesto final, menciona que tiene terreno, pregunta cuándo pueden empezar, pide reunión con Martín
- intent MEDIA: muy interesado, pide modelos específicos, compara opciones, pregunta por financiación
- intent BAJA: consulta general o informativa
- intent NINGUNA: queja, off-topic, sin terreno propio, o sin intención real de compra
- wants_meeting: true si el cliente quiere reunirse, hablar con Martín, agendar o confirmar una fecha/hora
- confirmed_slot_index: número entero (1-6) SOLO si el cliente eligió una de las opciones de horario ya ofrecidas en el historial ("la opción 2", "el martes", "ese horario", etc.), sino null
- budget_ars: número en pesos si lo mencionaron, sino null
- monthly_payment_ars: número en pesos si mencionaron cuota mensual, sino null
- model_chosen: nombre exacto del modelo si lo eligieron (ej: "VR 47m²"), sino null
- zone: provincia o ciudad del terreno si la mencionaron, sino null
- preferred_time: horario preferido para que Martín llame si lo mencionaron, sino null
- client_name: nombre si se presentaron, sino null
- notes: frase corta con contexto clave para el vendedor (máx 20 palabras)`;

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 250,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found');
    return JSON.parse(jsonMatch[0]);
  } catch {
    return {
      intent: 'NINGUNA',
      stage: 'saludo',
      wants_meeting: false,
      confirmed_slot_index: null,
      budget_ars: null,
      payment_type: 'desconocido',
      client_name: null,
      monthly_payment_ars: null,
      model_chosen: null,
      zone: null,
      preferred_time: null,
      notes: '',
    };
  }
}

function buildSellerNotification(userId, userMessage, analysis) {
  const lines = ['🔥 *CLIENTE LISTO PARA REUNIÓN CON MARTÍN*', ''];

  if (analysis.client_name) lines.push(`👤 *Nombre:* ${analysis.client_name}`);
  lines.push(`📱 *WhatsApp:* ${userId}`);

  if (analysis.model_chosen) lines.push(`🏠 *Modelo elegido:* ${analysis.model_chosen}`);

  if (analysis.budget_ars) {
    const paymentLabel =
      analysis.payment_type === 'contado'
        ? 'contado'
        : analysis.payment_type === 'financiacion'
          ? 'financiado'
          : analysis.payment_type;
    lines.push(`💰 *Presupuesto:* $${analysis.budget_ars.toLocaleString('es-AR')} ARS (${paymentLabel})`);
  }

  if (analysis.monthly_payment_ars) {
    lines.push(`📅 *Cuota posible:* $${analysis.monthly_payment_ars.toLocaleString('es-AR')} ARS/mes`);
  }

  if (analysis.zone) lines.push(`📍 *Zona del terreno:* ${analysis.zone}`);
  if (analysis.preferred_time) lines.push(`🕐 *Horario preferido:* ${analysis.preferred_time}`);

  lines.push(`📊 *Etapa:* ${analysis.stage}`);
  if (analysis.notes) lines.push(`📝 *Contexto:* ${analysis.notes}`);

  lines.push('');
  lines.push(`💬 *Último mensaje:* "${userMessage}"`);
  lines.push('');
  lines.push('⚡ Agendá la reunión a la brevedad — el cliente está listo para avanzar.');

  return lines.join('\n');
}

function summarizeHistory(messages) {
  if (!messages.length) return '';
  return messages
    .slice(-8)
    .map((m) => `${m.role === 'user' ? 'Cliente' : 'Sol'}: ${m.content}`)
    .join('\n');
}

export async function processMessage(userId, userMessage) {
  const historySummary = summarizeHistory(getHistory(userId));

  // Step 1: fast analysis with Haiku (determines intent and whether scheduling is needed)
  const analysis = await analyzeConversation(userMessage, historySummary);

  // Step 2: resolve slots — either use stored ones (client confirming) or fetch fresh ones
  let availableSlots = null;
  const needsSlots =
    analysis.wants_meeting || analysis.stage === 'cierre' || analysis.stage === 'agenda';

  if (analysis.confirmed_slot_index) {
    // Client is picking from a list already shown — reuse stored slots
    availableSlots = getOfferedSlots(userId);
  } else if (needsSlots && isCalendarReady()) {
    availableSlots = await getAvailableSlots();
  }

  // Step 3: generate Sol's response (slots injected as extra system block, not in history)
  const reply = await generateResponse(userId, userMessage, availableSlots);

  // Step 4: persist fresh slots so the next turn can reference by index
  if (availableSlots && !analysis.confirmed_slot_index) {
    setOfferedSlots(userId, availableSlots);
  }

  // Step 5: if client confirmed a slot, create the Calendar event
  let eventCreated = false;
  if (analysis.confirmed_slot_index) {
    const storedSlots = getOfferedSlots(userId);
    const chosenSlot = storedSlots?.[analysis.confirmed_slot_index - 1];
    if (chosenSlot) {
      const event = await createEvent(
        analysis.client_name,
        userId,
        analysis.model_chosen,
        chosenSlot.start,
        analysis.zone
      );
      if (event) {
        eventCreated = true;
        setOfferedSlots(userId, null);
        console.log(`Evento Calendar creado — cliente: ${userId} | slot: ${chosenSlot.label}`);
      }
    }
  }

  const notifySeller = analysis.intent === 'ALTA';
  const sellerMessage = notifySeller
    ? buildSellerNotification(userId, userMessage, analysis)
    : null;

  return { reply, notifySeller, sellerMessage, analysis, eventCreated };
}
