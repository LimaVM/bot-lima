import baileys from '@whiskeysockets/baileys';
const {
  makeWASocket,
  useMultiFileAuthState,
  downloadMediaMessage,
  DisconnectReason,
  fetchLatestBaileysVersion
} = baileys;
import qrcode from 'qrcode-terminal';
import Pino from 'pino';
import { Sticker, StickerTypes } from 'wa-sticker-formatter';


const PREFIX = '/';
const STICKER_CMD = 'fig';

let connectedAt = 0;

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('auth');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: Pino({ level: 'silent' }),
    auth: state
  });

  sock.ev.on('connection.update', ({ qr, connection, lastDisconnect }) => {
    if (qr) {
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') {
      connectedAt = Date.now();
      console.log('Conectado');
    } else if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Conexao encerrada', shouldReconnect ? 'tentando reconectar...' : 'nao vai reconectar');
      if (shouldReconnect) {
        start();
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const msg = messages[0];
    if (!msg.message) return;
    if (connectedAt && msg.messageTimestamp * 1000 < connectedAt) return;

    const text = (msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      '').trim();

    if (!text.startsWith(PREFIX + STICKER_CMD)) return;

    const ctx = msg.message.extendedTextMessage?.contextInfo;
    const quoted = ctx?.quotedMessage;
    if (!quoted) return;

    const target = {
      key: {
        remoteJid: msg.key.remoteJid,
        id: ctx.stanzaId,
        fromMe: ctx.participant === sock.user.id
      },
      message: quoted
    };

    const hasImage = !!quoted.imageMessage;
    const hasVideo = !!quoted.videoMessage;
    if (!hasImage && !hasVideo) return;

    try {
      const buffer = await downloadMediaMessage(target, 'buffer', {}, { logger: sock.logger });
      const sticker = new Sticker(buffer, {
        pack: 'Bot',
        author: 'Baileys',
        type: hasVideo ? StickerTypes.CROPPED : StickerTypes.FULL
      });
      await sock.sendMessage(msg.key.remoteJid, await sticker.toMessage(), { quoted: msg });
    } catch (err) {
      console.error('Erro ao criar figurinha:', err);
    }
  });
}

start().catch(err => console.error(err));
