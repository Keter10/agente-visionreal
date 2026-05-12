import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

const TOKENS_PATH = path.resolve('.tokens.json');
const SCOPES = ['https://www.googleapis.com/auth/calendar'];

// Argentina is UTC-3, no DST
const TZ = 'America/Argentina/Buenos_Aires';
const WORK_START_HOUR = 9;
const WORK_END_HOUR = 18;
const SLOT_DURATION_MIN = 60;

function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function loadTokens() {
  try {
    return JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function saveTokens(tokens) {
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
}

export function getAuthUrl() {
  const oAuth2Client = createOAuthClient();
  return oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });
}

export async function saveTokensFromCode(code) {
  const oAuth2Client = createOAuthClient();
  const { tokens } = await oAuth2Client.getToken(code);
  saveTokens(tokens);
  return tokens;
}

function getAuthenticatedClient() {
  const tokens = loadTokens();
  if (!tokens) return null;
  const oAuth2Client = createOAuthClient();
  oAuth2Client.setCredentials(tokens);
  oAuth2Client.on('tokens', (newTokens) => {
    const current = loadTokens() || {};
    saveTokens({ ...current, ...newTokens });
  });
  return oAuth2Client;
}

export function isCalendarReady() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return false;
  return loadTokens() !== null;
}

// Returns next N business days (Mon–Sat) starting from tomorrow
function getBusinessDays(count) {
  const days = [];
  // Use Argentina local time
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
  let cursor = new Date(now);
  cursor.setDate(cursor.getDate() + 1);
  cursor.setHours(0, 0, 0, 0);

  while (days.length < count) {
    const dow = cursor.getDay(); // 0=Sun
    if (dow !== 0) days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

// Returns UTC Date for a given local Argentina date + hour
function argToUtc(localDate, hour) {
  const d = new Date(localDate);
  d.setHours(hour, 0, 0, 0);
  // Argentina is UTC-3
  return new Date(d.getTime() + 3 * 60 * 60 * 1000);
}

export async function getAvailableSlots() {
  const auth = getAuthenticatedClient();
  if (!auth) return null;

  try {
    const calendar = google.calendar({ version: 'v3', auth });
    const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';

    const businessDays = getBusinessDays(3);
    const timeMin = argToUtc(businessDays[0], WORK_START_HOUR).toISOString();
    const lastDay = businessDays[businessDays.length - 1];
    const timeMax = argToUtc(lastDay, WORK_END_HOUR).toISOString();

    const freebusy = await calendar.freebusy.query({
      requestBody: {
        timeMin,
        timeMax,
        timeZone: TZ,
        items: [{ id: calendarId }],
      },
    });

    const busy = freebusy.data.calendars[calendarId]?.busy || [];

    const slots = [];
    for (const day of businessDays) {
      for (let h = WORK_START_HOUR; h < WORK_END_HOUR; h += SLOT_DURATION_MIN / 60) {
        const slotStart = argToUtc(day, h);
        const slotEnd = new Date(slotStart.getTime() + SLOT_DURATION_MIN * 60 * 1000);

        const conflict = busy.some((b) => {
          const bStart = new Date(b.start);
          const bEnd = new Date(b.end);
          return slotStart < bEnd && slotEnd > bStart;
        });

        if (!conflict) {
          slots.push({
            start: slotStart.toISOString(),
            end: slotEnd.toISOString(),
            label: formatSlotLabel(slotStart),
          });
        }
        if (slots.length >= 6) break;
      }
      if (slots.length >= 6) break;
    }

    return slots.length > 0 ? slots : null;
  } catch (err) {
    console.error('Error obteniendo slots de Calendar:', err.message);
    return null;
  }
}

function formatSlotLabel(utcDate) {
  // Convert back to Argentina time for display
  const argDate = new Date(utcDate.getTime() - 3 * 60 * 60 * 1000);
  const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const dow = days[argDate.getDay()];
  const day = argDate.getDate();
  const month = months[argDate.getMonth()];
  const hour = argDate.getHours();
  const ampm = hour >= 12 ? 'pm' : 'am';
  const h12 = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return `${dow} ${day} de ${month} a las ${h12}${ampm}`;
}

export async function createEvent(clientName, clientPhone, modelChosen, slotStart, zone) {
  const auth = getAuthenticatedClient();
  if (!auth) return null;

  try {
    const calendar = google.calendar({ version: 'v3', auth });
    const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';

    const start = new Date(slotStart);
    const end = new Date(start.getTime() + SLOT_DURATION_MIN * 60 * 1000);

    const title = `Reunión Visión Real — ${clientName || clientPhone}`;
    const description = [
      `Cliente: ${clientName || 'Sin nombre'}`,
      `WhatsApp: ${clientPhone}`,
      modelChosen ? `Modelo de interés: ${modelChosen}` : null,
      zone ? `Zona del terreno: ${zone}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    const event = await calendar.events.insert({
      calendarId,
      requestBody: {
        summary: title,
        description,
        start: { dateTime: start.toISOString(), timeZone: TZ },
        end: { dateTime: end.toISOString(), timeZone: TZ },
      },
    });

    return event.data;
  } catch (err) {
    console.error('Error creando evento en Calendar:', err.message);
    return null;
  }
}
