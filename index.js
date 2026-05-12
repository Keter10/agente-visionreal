import 'dotenv/config';
import express from 'express';
import twilio from 'twilio';
import { processMessage } from './agent.js';

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

app.post('/webhook', async (req, res) => {
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

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'Visión Real WhatsApp Agent' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Agente Visión Real escuchando en puerto ${PORT}`);
});
