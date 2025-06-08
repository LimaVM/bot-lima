import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  makeInMemoryStore
} from '@whiskeysockets/baileys';
import Pino from 'pino';
import { Sticker, StickerTypes } from 'wa-sticker-formatter';

const store = makeInMemoryStore({ logger: Pino().child({ level: 'silent', stream: 'store' }) });

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('auth');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: Pino({ level: 'silent' }),
    printQRInTerminal: true,
    auth: state
  });

  store.bind(sock.ev);
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message) return;
    if (msg.key.fromMe) return;
    const hasImage = !!msg.message.imageMessage;
    const hasVideo = !!msg.message.videoMessage;
    if (!hasImage && !hasVideo) return;

    try {
      const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: sock.logger });
      const sticker = new Sticker(buffer, {
        pack: 'Bot',
        author: 'Baileys',
        type: hasVideo ? StickerTypes.CROPPED : StickerTypes.FULL
      });
      await sock.sendMessage(msg.key.remoteJid, await sticker.toMessage(), { quoted: msg });
    } catch (err) {
      console.error('Erro ao processar midia:', err);
    }
  });
}

start().catch(err => console.error(err));
