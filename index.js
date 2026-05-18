import 'dotenv/config';
import express from 'express';
import twilio from 'twilio';
import axios from 'axios';
import { processMessage } from './agent.js';
import { getAuthUrl, saveTokensFromCode, isCalendarReady } from './calendar.js';

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use('/catalogos', express.static('catalogos'));

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

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

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'Visión Real WhatsApp Agent',
    calendar: isCalendarReady() ? 'autorizado' : 'no autorizado',
  });
});

app.get('/auth/google', (_req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(500).send('Variables GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET no configuradas.');
  }
  res.redirect(getAuthUrl());
});

app.get('/oauth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Falta el código de autorización.');
  try {
    await saveTokensFromCode(code);
    res.send('✅ Google Calendar autorizado correctamente. Ya podés cerrar esta ventana.');
    console.log('Google Calendar autorizado y tokens guardados.');
  } catch (err) {
    console.error('Error en OAuth callback:', err.message);
    res.status(500).send('Error al autorizar Google Calendar: ' + err.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Agente Visión Real escuchando en puerto ${PORT}`);
});
