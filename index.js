import baileys from '@whiskeysockets/baileys';
const {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadMediaMessage
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

  sock.ev.on('connection.update', ({ qr, connection }) => {
    if (qr) {
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') {
      connectedAt = Date.now();
      console.log('Conectado');
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;
    if (connectedAt && msg.messageTimestamp * 1000 < connectedAt) return;

    const text = (msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.imageMessage?.caption ||
      msg.message.videoMessage?.caption ||
      '').trim();

    if (!text.startsWith(PREFIX + STICKER_CMD)) return;

    let target = msg;
    let hasImage = !!msg.message.imageMessage;
    let hasVideo = !!msg.message.videoMessage;

    if (!hasImage && !hasVideo) {
      const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
      if (quoted?.imageMessage || quoted?.videoMessage) {
        const ctx = msg.message.extendedTextMessage.contextInfo;
        target = {
          key: {
            remoteJid: msg.key.remoteJid,
            id: ctx.stanzaId,
            fromMe: false
          },
          message: quoted
        };
        hasImage = !!quoted.imageMessage;
        hasVideo = !!quoted.videoMessage;
      } else {
        return;
      }
    }

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
