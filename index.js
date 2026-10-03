const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

const TOKEN = process.env.BOT_TOKEN;
const OWNER_USERNAME = (process.env.OWNER_USERNAME || 'Mahadihasanrony11').replace(/^@/, '').toLowerCase();
const CHANNEL = process.env.CHANNEL_USERNAME || '@MahadiToolsOfficial';

if (!TOKEN) throw new Error('BOT_TOKEN is missing');

const bot = new TelegramBot(TOKEN, { polling: true });
const app = express();
const PORT = process.env.PORT || 3000;

let ownerId = null;
const state = new Map();

app.get('/', (_, res) => res.send('Mahadi Tools Assistant is running'));
app.get('/health', (_, res) => res.json({ ok: true, bot: 'Mahadi Tools Assistant' }));
app.listen(PORT, () => console.log('Health server listening on', PORT));

function isOwner(msg) {
  const username = (msg.from?.username || '').toLowerCase();
  if (ownerId && msg.from?.id === ownerId) return true;
  if (username && username === OWNER_USERNAME) {
    ownerId = msg.from.id;
    return true;
  }
  return false;
}

const mainKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '📣 নতুন পোস্ট', callback_data: 'new_post' }, { text: '👁️ চ্যানেল চেক', callback_data: 'check_channel' }],
      [{ text: '📝 Draft / Preview', callback_data: 'draft_info' }, { text: '⏰ Schedule', callback_data: 'schedule_info' }],
      [{ text: '⚙️ Settings', callback_data: 'settings' }, { text: '🆘 Help', callback_data: 'help' }]
    ]
  }
};

async function sendPanel(chatId) {
  return bot.sendMessage(chatId,
    '✨ *MAHADI TOOLS ASSISTANT*\n\n' +
    '👑 Owner Panel\n' +
    '📢 Channel: ' + CHANNEL + '\n\n' +
    'নিচের অপশন থেকে কাজ সিলেক্ট করুন:',
    { parse_mode: 'Markdown', ...mainKeyboard }
  );
}

bot.onText(/^\/start(?:@\w+)?$/, async (msg) => {
  if (!isOwner(msg)) {
    return bot.sendMessage(msg.chat.id, '🔒 এই bot private. Owner ছাড়া ব্যবহার করা যাবে না।');
  }
  await bot.sendMessage(msg.chat.id,
    '✅ *Mahadi Tools Assistant চালু হয়েছে*\n\n' +
    'আপনি Owner হিসেবে verified.\n' +
    'এখন /panel চাপুন অথবা নিচের panel ব্যবহার করুন।',
    { parse_mode: 'Markdown' }
  );
  await sendPanel(msg.chat.id);
});

bot.onText(/^\/panel(?:@\w+)?$/, async (msg) => {
  if (!isOwner(msg)) return;
  await sendPanel(msg.chat.id);
});

bot.onText(/^\/post(?:@\w+)?$/, async (msg) => {
  if (!isOwner(msg)) return;
  state.set(msg.chat.id, { mode: 'await_post' });
  await bot.sendMessage(msg.chat.id, '📣 যে text/photo/video পোস্ট করতে চান, এখন সেটা আমাকে পাঠান।\n\nপাঠানোর আগে আমি Preview দেখাব।');
});

bot.on('callback_query', async (q) => {
  const msg = q.message;
  if (!msg || !isOwner(msg)) {
    return bot.answerCallbackQuery(q.id, { text: 'Owner only', show_alert: true });
  }
  await bot.answerCallbackQuery(q.id);

  if (q.data === 'new_post') {
    state.set(msg.chat.id, { mode: 'await_post' });
    return bot.sendMessage(msg.chat.id, '📣 এখন text/photo/video পাঠান। আমি আগে Preview দেখাব।');
  }

  if (q.data === 'check_channel') {
    try {
      const chat = await bot.getChat(CHANNEL);
      const me = await bot.getMe();
      let membership = 'Unknown';
      try {
        const member = await bot.getChatMember(chat.id, me.id);
        membership = member.status;
      } catch {}
      return bot.sendMessage(msg.chat.id,
        '✅ *Channel Found*\n\n' +
        'Name: ' + (chat.title || CHANNEL) + '\n' +
        'ID: `' + chat.id + '`\n' +
        'Bot status: *' + membership + '*\n\n' +
        (membership === 'administrator' ? '🟢 Posting permission ready.' : '🟡 Bot-কে Channel admin করতে হবে।'),
        { parse_mode: 'Markdown' }
      );
    } catch (e) {
      return bot.sendMessage(msg.chat.id,
        '❌ Channel access পাওয়া যায়নি।\n\nBot-কে ' + CHANNEL + ' Channel-এ *Admin* করে আবার Check করুন.',
        { parse_mode: 'Markdown' }
      );
    }
  }

  if (q.data === 'draft_info') {
    return bot.sendMessage(msg.chat.id, '📝 Draft + Preview system active: /post দিলে আগে preview দেখাবে, তারপর Publish/Cancel করতে পারবেন।');
  }
  if (q.data === 'schedule_info') {
    return bot.sendMessage(msg.chat.id, '⏰ Schedule system পরের update-এ persistent database সহ চালু করব, যাতে restart হলেও schedule হারায় না।');
  }
  if (q.data === 'settings') {
    return bot.sendMessage(msg.chat.id,
      '⚙️ *Settings*\n\n' +
      '• Owner: @' + OWNER_USERNAME + '\n' +
      '• Channel: ' + CHANNEL + '\n' +
      '• Access: Owner Only\n' +
      '• Mode: Channel Mode',
      { parse_mode: 'Markdown' }
    );
  }
  if (q.data === 'help') {
    return bot.sendMessage(msg.chat.id,
      '🆘 *Commands*\n\n/start — bot চালু\n/panel — control panel\n/post — নতুন post\n/status — bot status',
      { parse_mode: 'Markdown' }
    );
  }

  if (q.data === 'publish_pending') {
    const s = state.get(msg.chat.id);
    if (!s?.payload) return bot.sendMessage(msg.chat.id, 'Draft পাওয়া যায়নি। আবার /post দিন।');
    try {
      const p = s.payload;
      if (p.type === 'text') {
        await bot.sendMessage(CHANNEL, p.text, { disable_web_page_preview: false });
      } else if (p.type === 'photo') {
        await bot.sendPhoto(CHANNEL, p.fileId, { caption: p.caption || '' });
      } else if (p.type === 'video') {
        await bot.sendVideo(CHANNEL, p.fileId, { caption: p.caption || '' });
      } else if (p.type === 'document') {
        await bot.sendDocument(CHANNEL, p.fileId, { caption: p.caption || '' });
      }
      state.delete(msg.chat.id);
      return bot.sendMessage(msg.chat.id, '✅ পোস্ট Channel-এ Publish হয়েছে।');
    } catch (e) {
      console.error(e);
      return bot.sendMessage(msg.chat.id, '❌ Publish হয়নি। Bot-কে Channel admin করে Post Messages permission দিন।');
    }
  }

  if (q.data === 'cancel_pending') {
    state.delete(msg.chat.id);
    return bot.sendMessage(msg.chat.id, '🗑️ Draft বাতিল করা হয়েছে।');
  }
});

bot.on('message', async (msg) => {
  if (!isOwner(msg)) return;
  const s = state.get(msg.chat.id);
  if (!s || s.mode !== 'await_post') return;
  if (msg.text?.startsWith('/')) return;

  let payload;
  if (msg.photo?.length) {
    payload = { type: 'photo', fileId: msg.photo[msg.photo.length - 1].file_id, caption: msg.caption || '' };
    await bot.sendPhoto(msg.chat.id, payload.fileId, { caption: '👁️ PREVIEW\n\n' + payload.caption });
  } else if (msg.video) {
    payload = { type: 'video', fileId: msg.video.file_id, caption: msg.caption || '' };
    await bot.sendVideo(msg.chat.id, payload.fileId, { caption: '👁️ PREVIEW\n\n' + payload.caption });
  } else if (msg.document) {
    payload = { type: 'document', fileId: msg.document.file_id, caption: msg.caption || '' };
    await bot.sendDocument(msg.chat.id, payload.fileId, { caption: '👁️ PREVIEW\n\n' + payload.caption });
  } else if (msg.text) {
    payload = { type: 'text', text: msg.text };
    await bot.sendMessage(msg.chat.id, '👁️ *PREVIEW*\n\n' + msg.text, { parse_mode: 'Markdown' });
  } else {
    return bot.sendMessage(msg.chat.id, 'এই ধরনের message এখন support করছে না। Text/Photo/Video/File পাঠান।');
  }

  state.set(msg.chat.id, { mode: 'confirm_post', payload });
  await bot.sendMessage(msg.chat.id, 'এই পোস্ট Publish করবেন?', {
    reply_markup: { inline_keyboard: [[
      { text: '✅ Publish', callback_data: 'publish_pending' },
      { text: '❌ Cancel', callback_data: 'cancel_pending' }
    ]] }
  });
});

bot.onText(/^\/status(?:@\w+)?$/, async (msg) => {
  if (!isOwner(msg)) return;
  await bot.sendMessage(msg.chat.id, '🟢 Mahadi Tools Assistant is online.\n📢 Channel: ' + CHANNEL);
});

bot.on('polling_error', err => console.error('Polling error:', err.message));
console.log('Mahadi Tools Assistant booted');
