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
import Jimp from 'jimp';
import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import si from 'systeminformation';
import util from 'util';


const PREFIX = '/';
const STICKER_CMD = 'fig';
const STICKER_FULL_CMD = 'figfull';
const YT_CMD = 'yt';
const MENU_CMD = 'menu';

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

    if (!text.startsWith(PREFIX)) return;
    const [command, ...rest] = text.slice(PREFIX.length).split(/\s+/);
    const args = rest.join(' ');

    const ctx = msg.message.extendedTextMessage?.contextInfo;
    const quoted = ctx?.quotedMessage;

    if (command === STICKER_CMD || command === STICKER_FULL_CMD) {
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
        let buffer = await downloadMediaMessage(target, 'buffer', {}, { logger: sock.logger });
        let type = hasVideo ? StickerTypes.CROPPED : StickerTypes.FULL;
        if (command === STICKER_FULL_CMD && hasImage) {
          const img = await Jimp.read(buffer);
          img.resize(1024, 1024);
          buffer = await img.getBufferAsync(Jimp.MIME_JPEG);
          type = StickerTypes.FULL;
        }

        const sticker = new Sticker(buffer, {
          pack: 'devlima',
          author: 'by devlima',
          type
        });
        await sock.sendMessage(msg.key.remoteJid, await sticker.toMessage(), { quoted: msg });
      } catch (err) {
        console.error('Erro ao criar figurinha:', err);
      }
    } else if (command === YT_CMD && args) {
      try {
        const { stdout } = await util.promisify(execFile)('python3', ['yt_downloader.py', args]);
        const result = JSON.parse(stdout.trim());
        if (result.error) throw new Error(result.error);
        await sock.sendMessage(msg.key.remoteJid, { text: `Baixando: ${result.title}` }, { quoted: msg });
        const audioBuffer = fs.readFileSync(result.path);
        await sock.sendMessage(msg.key.remoteJid, { audio: audioBuffer, mimetype: 'audio/mpeg' }, { quoted: msg });
        fs.unlinkSync(result.path);
      } catch (err) {
        console.error('Erro ao baixar audio:', err);
        const log = `Erro ao baixar audio:\n${err.stack}`;
        const logPath = 'yt_error.log';
        fs.writeFileSync(logPath, log);
        await sock.sendMessage(msg.key.remoteJid, { text: `Deu um problema: ${err.message}` }, { quoted: msg });
        await sock.sendMessage(
          msg.key.remoteJid,
          { document: fs.readFileSync(logPath), fileName: 'yt_error.log', mimetype: 'text/plain' },
          { quoted: msg }
        );
        fs.unlinkSync(logPath);
      }
    } else if (command === MENU_CMD) {
      const now = new Date().toLocaleString('pt-BR');
      const cpu = os.cpus()[0].model.trim();
      const total = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);
      const free = (os.freemem() / 1024 / 1024 / 1024).toFixed(2);
      const board = await si.baseboard();
      const textMsg = `Hora: ${now}\nCPU: ${cpu}\nRAM livre/total: ${free}/${total} GB\nPlaca-mae: ${board.manufacturer} ${board.model}`;
      await sock.sendMessage(msg.key.remoteJid, { text: textMsg }, { quoted: msg });
    }
});
}

start().catch(err => console.error(err));
