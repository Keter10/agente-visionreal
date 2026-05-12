import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT } from './knowledge.js';
import { getFinancingPlans } from './financing.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const conversations = new Map();
const HISTORY_TTL_MS = 30 * 60 * 1000;
const MAX_HISTORY_MESSAGES = 20;

function getHistory(userId) {
  const entry = conversations.get(userId);
  if (!entry) return [];
  if (Date.now() - entry.lastActivity > HISTORY_TTL_MS) {
    conversations.delete(userId);
    return [];
  }
  return entry.messages;
}

function updateHistory(userId, messages) {
  const trimmed =
    messages.length > MAX_HISTORY_MESSAGES
      ? messages.slice(messages.length - MAX_HISTORY_MESSAGES)
      : messages;
  conversations.set(userId, { messages: trimmed, lastActivity: Date.now() });
}

function buildSystemBlocks() {
  const blocks = [
    {
      type: 'text',
      text: SYSTEM_PROMPT,
      cache_control: { type: 'ephemeral' },
    },
  ];

  const financingPlans = getFinancingPlans();
  if (financingPlans) {
    blocks.push({
      type: 'text',
      text: `## PLANES DE FINANCIACIÓN DISPONIBLES\nUsá estos datos concretos cuando el cliente pregunte por financiación.\n\n${financingPlans}`,
    });
  }

  return blocks;
}

async function generateResponse(userId, userMessage) {
  const history = getHistory(userId);
  const messages = [...history, { role: 'user', content: userMessage }];

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: buildSystemBlocks(),
    messages,
  });

  const assistantMessage = response.content[0].text;
  updateHistory(userId, [...messages, { role: 'assistant', content: assistantMessage }]);

  return assistantMessage;
}

// Retorna datos estructurados sobre el estado de la conversación para notificar a Martín con contexto útil
async function analyzeConversation(userMessage, historySummary) {
  const prompt = `Analizá este intercambio de WhatsApp de venta de viviendas prefabricadas.

Historial reciente:
${historySummary || '(sin historial previo)'}

Último mensaje del cliente: "${userMessage}"

Respondé SOLO con JSON válido, sin texto extra:
{
  "intent": "ALTA|MEDIA|BAJA|NINGUNA",
  "stage": "saludo|necesidad|presupuesto|presentacion|objecion|cierre|agenda",
  "budget_usd": null,
  "payment_type": "contado|financiacion|desconocido",
  "client_name": null,
  "monthly_payment_usd": null,
  "notes": ""
}

Reglas:
- intent ALTA: quiere comprar, pide presupuesto final, pregunta por plazos/reserva, menciona que ya tiene el terreno o cuándo quiere empezar
- intent MEDIA: muy interesado, pide modelos específicos, compara opciones, pregunta por financiación
- intent BAJA: consulta general o informativa
- intent NINGUNA: queja, off-topic, o sin intención de compra
- budget_usd: número si lo mencionaron, sino null
- monthly_payment_usd: número si mencionaron cuota mensual, sino null
- client_name: nombre si se presentaron, sino null
- notes: frase corta con contexto relevante para el vendedor (máx 20 palabras)`;

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 150,
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
      budget_usd: null,
      payment_type: 'desconocido',
      client_name: null,
      monthly_payment_usd: null,
      notes: '',
    };
  }
}

function buildSellerNotification(userId, userMessage, analysis) {
  const lines = ['🔥 *CLIENTE CON ALTA INTENCIÓN DE COMPRA*', ''];

  if (analysis.client_name) lines.push(`👤 *Nombre:* ${analysis.client_name}`);
  lines.push(`📱 *WhatsApp:* ${userId}`);

  if (analysis.budget_usd) {
    const paymentLabel = analysis.payment_type === 'contado' ? 'contado' : analysis.payment_type;
    lines.push(`💰 *Presupuesto:* $${analysis.budget_usd.toLocaleString('es-AR')} USD (${paymentLabel})`);
  }

  if (analysis.monthly_payment_usd) {
    lines.push(`📅 *Cuota posible:* $${analysis.monthly_payment_usd.toLocaleString('es-AR')} USD/mes`);
  }

  lines.push(`📍 *Etapa:* ${analysis.stage}`);

  if (analysis.notes) lines.push(`📝 *Contexto:* ${analysis.notes}`);

  lines.push('');
  lines.push(`💬 *Último mensaje:* "${userMessage}"`);
  lines.push('');
  lines.push('⚡ Contactalo a la brevedad para no perder la oportunidad.');

  return lines.join('\n');
}

function summarizeHistory(messages) {
  if (!messages.length) return '';
  return messages
    .slice(-8)
    .map((m) => `${m.role === 'user' ? 'Cliente' : 'Visi'}: ${m.content}`)
    .join('\n');
}

export async function processMessage(userId, userMessage) {
  const historySummary = summarizeHistory(getHistory(userId));

  const [reply, analysis] = await Promise.all([
    generateResponse(userId, userMessage),
    analyzeConversation(userMessage, historySummary),
  ]);

  const notifySeller = analysis.intent === 'ALTA';
  const sellerMessage = notifySeller
    ? buildSellerNotification(userId, userMessage, analysis)
    : null;

  return { reply, notifySeller, sellerMessage, analysis };
}
