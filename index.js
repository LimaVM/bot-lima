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
import ytSearch from 'yt-search';
import ytdl from 'ytdl-core';


const PREFIX = '/';
const STICKER_CMD = 'fig';
const YT_CMD = 'yt';

let connectedAt = 0;

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', err => reject(err));
  });
}

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

    if (!text.startsWith(PREFIX)) return;
    const [command, ...rest] = text.slice(PREFIX.length).split(/\s+/);
    const args = rest.join(' ');

    const ctx = msg.message.extendedTextMessage?.contextInfo;
    const quoted = ctx?.quotedMessage;

    if (command === STICKER_CMD) {
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
          pack: 'devlima',
          author: 'by devlima',
          type: hasVideo ? StickerTypes.CROPPED : StickerTypes.FULL
        });
        await sock.sendMessage(msg.key.remoteJid, await sticker.toMessage(), { quoted: msg });
      } catch (err) {
        console.error('Erro ao criar figurinha:', err);
      }
    } else if (command === YT_CMD && args) {
      try {
        let url = args;
        let info;
        if (!/youtu\.be|youtube\.com/.test(args)) {
          const search = await ytSearch(args);
          if (!search.videos.length) {
            await sock.sendMessage(msg.key.remoteJid, { text: 'Nenhum resultado encontrado.' }, { quoted: msg });
            return;
          }
          url = search.videos[0].url;
          info = { videoDetails: { title: search.videos[0].title } };
        } else {
          info = await ytdl.getInfo(url);
        }

        const title = info.videoDetails.title;
        await sock.sendMessage(msg.key.remoteJid, { text: `Baixando: ${title}` }, { quoted: msg });

        const stream = ytdl(url, { filter: 'audioonly', quality: 'highestaudio' });
        const audioBuffer = await streamToBuffer(stream);
        await sock.sendMessage(msg.key.remoteJid, { audio: audioBuffer, mimetype: 'audio/mpeg' }, { quoted: msg });
      } catch (err) {
        console.error('Erro ao baixar audio:', err);
        await sock.sendMessage(msg.key.remoteJid, { text: `Deu um problema: ${err.message}` }, { quoted: msg });
      }
    }
  });
}

start().catch(err => console.error(err));
