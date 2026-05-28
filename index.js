import 'dotenv/config';
import express from 'express';
import twilio from 'twilio';
import axios from 'axios';
import Anthropic from '@anthropic-ai/sdk';
import { processMessage, getFollowUpCandidates, markFollowUpSent, followUpTracking } from './agent.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

process.on('uncaughtException', (err) => {
  console.error('CRASH — uncaughtException:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('CRASH — unhandledRejection:', reason);
  process.exit(1);
});

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use('/catalogos', express.static('catalogos'));

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const processedMessageIds = new Set();

function addWithTTL(id) {
  processedMessageIds.add(id);
  setTimeout(() => processedMessageIds.delete(id), 10 * 60 * 1000);
}

async function sendMetaMessage(to, text) {
  await axios.post(
    `https://graph.facebook.com/v20.0/${process.env.META_PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    },
    { headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` } }
  );
}

app.post('/webhook/twilio', async (req, res) => {
  // Responde 200 de inmediato para evitar timeout de Twilio (15s)
  res.status(200).send('OK');

  const from = req.body.From;
  const body = req.body.Body;

  if (!from || !body) return;

  const userId = from.replace('whatsapp:', '');

  try {
    const { reply, notifySeller, sellerMessage, analysis } = await processMessage(userId, body);

    await twilioClient.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: from,
      body: reply,
    });

    if (notifySeller && sellerMessage) {
      await twilioClient.messages.create({
        from: process.env.TWILIO_WHATSAPP_NUMBER,
        to: `whatsapp:${process.env.SELLER_WHATSAPP}`,
        body: sellerMessage,
      });
      console.log(`Notificación enviada a Martín — cliente: ${userId} | etapa: ${analysis.stage}`);
    }

    console.log(`[${userId}] intent=${analysis.intent} stage=${analysis.stage}`);
  } catch (err) {
    console.error(`Error procesando mensaje de ${userId}:`, err.message);
  }
});

// Meta WhatsApp Business API — verificación del webhook
app.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

// Meta WhatsApp Business API — recepción de mensajes
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  const entry = req.body?.entry?.[0];
  const change = entry?.changes?.[0]?.value;
  const message = change?.messages?.[0];

  if (!message || message.type !== 'text') return;

  if (processedMessageIds.has(message.id)) return;
  addWithTTL(message.id);

  const userId = message.from;
  const body = message.text?.body;

  if (!body) return;

  try {
    const { reply, notifySeller, sellerMessage, analysis } = await processMessage(userId, body);

    await sendMetaMessage(userId, reply);

    if (notifySeller && sellerMessage) {
      await sendMetaMessage(process.env.SELLER_WHATSAPP.replace('+', ''), sellerMessage);
      console.log(`Notificación enviada a Martín — cliente: ${userId} | etapa: ${analysis.stage}`);
    }

    console.log(`[${userId}] intent=${analysis.intent} stage=${analysis.stage}`);
  } catch (err) {
    console.error(`Error procesando mensaje Meta de ${userId}:`, err.message);
  }
});

app.get('/seguimiento', async (_req, res) => {
  const candidates = getFollowUpCandidates();
  const results = [];

  for (const { userId } of candidates) {
    const contextData = followUpTracking.get(userId);
    const prompt = `Sos Sol, asesora de Visión Real Viviendas. Escribí UN mensaje corto de seguimiento (máximo 2 líneas, tono cálido y sin presión, sin asumir nada sobre la situación personal del cliente) para retomar una conversación de WhatsApp.

Contexto:
- Nombre: ${contextData?.clientName || 'desconocido'}
- Etapa donde quedó: ${contextData?.stage || 'desconocida'}
- Nivel de interés: ${contextData?.intent || 'desconocido'}

Según la etapa:
- saludo/necesidad: invitar a retomar la consulta
- presupuesto: recordar que quedó pendiente ver opciones
- presentacion: preguntar si pudo ver la info que le mandaste
- objecion: retomar sin presión desde la duda que tenía
- cierre/agenda: recordar que quedó pendiente coordinar el llamado con Martín

IMPORTANTE: No menciones familia, pareja ni ningún tercero. El mensaje es para el cliente directamente.

Respondé SOLO con el mensaje, sin comillas ni explicaciones.`;

    try {
      const response = await client.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 150,
        messages: [{ role: 'user', content: prompt }],
      });
      const message = response.content[0].text.trim();
      await sendMetaMessage(userId, message);
      markFollowUpSent(userId);
      results.push({ userId, status: 'sent' });
      console.log(`[seguimiento] Mensaje enviado a ${userId}`);
    } catch (err) {
      results.push({ userId, status: 'error', error: err.message });
      console.error(`[seguimiento] Error enviando a ${userId}:`, err.message);
    }
  }

  res.json({ checked: new Date().toISOString(), sent: results.length, results });
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'Visión Real WhatsApp Agent',
    scheduling: 'velox',
  });
});

const PORT = process.env.PORT || 8080;
try {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Agente Visión Real escuchando en puerto ${PORT}`);
  });
} catch (err) {
  console.error('CRASH — error al iniciar servidor:', err);
  process.exit(1);
}
