const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const { Pool } = require('pg');
const setupGroupFeatures = require('./group_features');
const setupBusinessFeatures = require('./business_features');

const TOKEN = process.env.BOT_TOKEN;
const OWNER_USERNAME = (process.env.OWNER_USERNAME || 'Mahadihasanrony11').replace(/^@/, '').toLowerCase();
const CHANNEL = process.env.CHANNEL_USERNAME || '@MahadiToolsOfficial';
const DATABASE_URL = process.env.DATABASE_URL;

if (!TOKEN) throw new Error('BOT_TOKEN is missing');
if (!DATABASE_URL) throw new Error('DATABASE_URL is missing');

const bot = new TelegramBot(TOKEN, { polling: true });
const app = express();
const PORT = process.env.PORT || 3000;
const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

const sessions = new Map();
let ownerId = null;


app.get('/', (_, res) => res.send('Mahadi Tools Assistant v3 is running'));
app.get('/health', (_, res) => res.json({ ok: true, bot: 'Mahadi Tools Assistant', version: '3.0.0' }));
app.listen(PORT, () => console.log('Health server listening on', PORT));

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS drafts (
      id SERIAL PRIMARY KEY,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS scheduled_posts (
      id SERIAL PRIMARY KEY,
      payload JSONB NOT NULL,
      schedule_at TIMESTAMPTZ NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      published_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS post_history (
      id SERIAL PRIMARY KEY,
      telegram_message_id BIGINT,
      payload JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS custom_commands (
      command TEXT PRIMARY KEY,
      response TEXT NOT NULL,
      enabled BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS activity_logs (
      id SERIAL PRIMARY KEY,
      action TEXT NOT NULL,
      details TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS tracked_users (
      telegram_id BIGINT PRIMARY KEY,
      first_username TEXT,
      current_username TEXT,
      first_name TEXT,
      last_name TEXT,
      is_bot BOOLEAN DEFAULT FALSE,
      first_seen TIMESTAMPTZ DEFAULT NOW(),
      last_seen TIMESTAMPTZ DEFAULT NOW(),
      last_chat_id BIGINT,
      last_chat_type TEXT
    );
    CREATE TABLE IF NOT EXISTS identity_history (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT NOT NULL,
      field TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      chat_id BIGINT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  const defaults = {
    auto_pin: 'false',
    silent_post: 'false',
    link_preview: 'true',
    signature: '',
    service_status: 'online',
    maintenance_note: 'মেইনটেন্যান্সের কাজ চলছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।'
  };
  for (const [k,v] of Object.entries(defaults)) {
    await pool.query('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING',[k,v]);
  }
}
initDb().then(()=>console.log('Database ready')).catch(e=>console.error('DB init error',e));

function isOwnerUser(user) {
  const username = (user?.username || '').toLowerCase();
  if (ownerId && user?.id === ownerId) return true;
  if (username && username === OWNER_USERNAME) {
    ownerId = user.id;
    return true;
  }
  return false;
}
function isOwnerMsg(msg) { return isOwnerUser(msg?.from); }

async function getSetting(key, fallback='') {
  const r=await pool.query('SELECT value FROM settings WHERE key=$1',[key]);
  return r.rows[0]?.value ?? fallback;
}
async function setSetting(key,value) {
  await pool.query(`INSERT INTO settings(key,value,updated_at) VALUES($1,$2,NOW())
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`,[key,String(value)]);
}
async function logAction(action,details='') {
  try { await pool.query('INSERT INTO activity_logs(action,details) VALUES($1,$2)',[action,details]); } catch {}
}

async function trackUser(user, ctx={}) {
  if (!user?.id) return;
  const telegramId = user.id;
  const username = user.username || null;
  const firstName = user.first_name || null;
  const lastName = user.last_name || null;
  const chatId = ctx.chatId || null;
  const chatType = ctx.chatType || null;

  try {
    const existing = await pool.query(
      'SELECT * FROM tracked_users WHERE telegram_id=$1',
      [telegramId]
    );

    if (!existing.rows[0]) {
      await pool.query(
        `INSERT INTO tracked_users
        (telegram_id, first_username, current_username, first_name, last_name, is_bot, last_chat_id, last_chat_type)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [telegramId, username, username, firstName, lastName, !!user.is_bot, chatId, chatType]
      );
      await logAction('user_first_seen', String(telegramId) + (username ? ' @'+username : ''));
      return;
    }

    const old = existing.rows[0];
    const changes = [
      ['username', old.current_username, username],
      ['first_name', old.first_name, firstName],
      ['last_name', old.last_name, lastName]
    ];

    for (const [field, oldValue, newValue] of changes) {
      if ((oldValue || null) !== (newValue || null)) {
        await pool.query(
          'INSERT INTO identity_history(telegram_id,field,old_value,new_value,chat_id) VALUES($1,$2,$3,$4,$5)',
          [telegramId, field, oldValue, newValue, chatId]
        );
        await logAction(
          'identity_change',
          telegramId + ' ' + field + ': ' + (oldValue || 'none') + ' -> ' + (newValue || 'none')
        );
      }
    }

    await pool.query(
      `UPDATE tracked_users
       SET current_username=$2, first_name=$3, last_name=$4, is_bot=$5,
           last_seen=NOW(), last_chat_id=$6, last_chat_type=$7
       WHERE telegram_id=$1`,
      [telegramId, username, firstName, lastName, !!user.is_bot, chatId, chatType]
    );
  } catch (e) {
    console.error('User tracking error:', e.message);
  }
}

const mainKeyboard = {
  reply_markup: { inline_keyboard: [
    [{text:'📣 নতুন পোস্ট',callback_data:'new_post'},{text:'⚡ Quick Post',callback_data:'quick_post'}],
    [{text:'⏰ Schedule',callback_data:'scheduled_menu'},{text:'🗂 Drafts',callback_data:'drafts_menu'}],
    [{text:'🧩 Inline Buttons',callback_data:'buttons_info'},{text:'📌 Auto Pin',callback_data:'toggle_autopin'}],
    [{text:'🛠 Post Tools',callback_data:'post_tools'},{text:'📊 History',callback_data:'history'}],
    [{text:'🤖 Custom Commands',callback_data:'commands_menu'},{text:'💬 Support Setup',callback_data:'support_menu'}],
    [{text:'🛡 Group Security',callback_data:'grp_security'},{text:'💎 Premium Plans',callback_data:'grp_plans'}],
    [{text:'🎫 Support Tickets',callback_data:'grp_tickets'},{text:'📊 Analytics',callback_data:'grp_analytics'}],
    [{text:'💼 Business Tools',callback_data:'biz_menu'},{text:'👥 User Tracker',callback_data:'user_tracker'}],
    [{text:'🆔 Owner Identity',callback_data:'owner_identity'},{text:'⚙️ Settings',callback_data:'settings_menu'}],
    [{text:'📡 Channel Status',callback_data:'check_channel'},{text:'🧾 Activity Logs',callback_data:'logs'}],
    [{text:'❓ Help',callback_data:'help'}]
  ]}
};

async function sendPanel(chatId) {
  const autoPin = await getSetting('auto_pin','false');
  const status = await getSetting('service_status','online');
  await bot.sendMessage(chatId,
    '✨ MAHADI TOOLS ASSISTANT — PREMIUM PANEL\n\n' +
    '👑 Owner: @' + OWNER_USERNAME + '\n' +
    '📢 Channel: ' + CHANNEL + '\n' +
    '📌 Auto Pin: ' + (autoPin==='true'?'ON':'OFF') + '\n' +
    '🟢 Service: ' + status.toUpperCase() + '\n\n' +
    'নিচের যেকোনো অপশন ব্যবহার করুন:',
    mainKeyboard
  );
}

async function showSettings(chatId) {
  const [autoPin,silent,preview,signature,status] = await Promise.all([
    getSetting('auto_pin','false'),getSetting('silent_post','false'),getSetting('link_preview','true'),
    getSetting('signature',''),getSetting('service_status','online')
  ]);
  await bot.sendMessage(chatId,
    '⚙️ SETTINGS\n\n' +
    '📌 Auto Pin: '+(autoPin==='true'?'ON':'OFF')+'\n' +
    '🔕 Silent Post: '+(silent==='true'?'ON':'OFF')+'\n' +
    '🔗 Link Preview: '+(preview==='true'?'ON':'OFF')+'\n' +
    '✍️ Signature: '+(signature||'Not set')+'\n' +
    '🟢 Service Status: '+status.toUpperCase(),
    {reply_markup:{inline_keyboard:[
      [{text:'📌 Toggle Auto Pin',callback_data:'toggle_autopin'},{text:'🔕 Toggle Silent',callback_data:'toggle_silent'}],
      [{text:'🔗 Toggle Link Preview',callback_data:'toggle_preview'},{text:'✍️ Set Signature',callback_data:'set_signature'}],
      [{text:'🟢 Service Status',callback_data:'support_menu'},{text:'⬅️ Main Panel',callback_data:'main_panel'}]
    ]}}
  );
}

async function previewPayload(chatId,payload) {
  if (payload.type==='text') {
    await bot.sendMessage(chatId,'👁️ PREVIEW\n\n'+payload.text);
  } else if (payload.type==='photo') {
    await bot.sendPhoto(chatId,payload.fileId,{caption:'👁️ PREVIEW\n\n'+(payload.caption||'')});
  } else if (payload.type==='video') {
    await bot.sendVideo(chatId,payload.fileId,{caption:'👁️ PREVIEW\n\n'+(payload.caption||'')});
  } else if (payload.type==='document') {
    await bot.sendDocument(chatId,payload.fileId,{caption:'👁️ PREVIEW\n\n'+(payload.caption||'')});
  }
  await bot.sendMessage(chatId,'পোস্টের জন্য কী করবেন?',{
    reply_markup:{inline_keyboard:[
      [{text:'✅ Publish Now',callback_data:'publish_pending'},{text:'⏰ Schedule',callback_data:'schedule_pending'}],
      [{text:'🗂 Save Draft',callback_data:'save_draft'},{text:'➕ Add Button',callback_data:'add_button'}],
      [{text:'❌ Cancel',callback_data:'cancel_pending'}]
    ]}
  });
}

async function sendToChannel(payload) {
  const [autoPin,silent,preview,signature] = await Promise.all([
    getSetting('auto_pin','false'),getSetting('silent_post','false'),
    getSetting('link_preview','true'),getSetting('signature','')
  ]);
  const buttons = payload.buttons || [];
  const reply_markup = buttons.length ? {inline_keyboard:buttons.map(b=>[{text:b.text,url:b.url}])} : undefined;
  let sent;
  const appendSig = txt => signature ? (txt ? txt+'\n\n'+signature : signature) : (txt||'');
  const opts = { disable_notification: silent==='true' };
  if (reply_markup) opts.reply_markup=reply_markup;

  if (payload.type==='text') {
    sent=await bot.sendMessage(CHANNEL,appendSig(payload.text),{
      ...opts,
      disable_web_page_preview: preview!=='true'
    });
  } else if (payload.type==='photo') {
    sent=await bot.sendPhoto(CHANNEL,payload.fileId,{...opts,caption:appendSig(payload.caption)});
  } else if (payload.type==='video') {
    sent=await bot.sendVideo(CHANNEL,payload.fileId,{...opts,caption:appendSig(payload.caption)});
  } else if (payload.type==='document') {
    sent=await bot.sendDocument(CHANNEL,payload.fileId,{...opts,caption:appendSig(payload.caption)});
  }
  if (!sent) throw new Error('Unsupported payload');
  await pool.query('INSERT INTO post_history(telegram_message_id,payload) VALUES($1,$2)',[sent.message_id,payload]);
  if (autoPin==='true') {
    try { await bot.pinChatMessage(CHANNEL,sent.message_id,{disable_notification:true}); } catch {}
  }
  await logAction('publish','message_id='+sent.message_id);
  return sent;
}

function parseOmanSchedule(input) {
  const s=(input||'').trim();
  let dateStr,timeStr;
  if (/^\d{1,2}:\d{2}$/.test(s)) {
    const nowOman=new Date(Date.now()+4*3600000);
    dateStr=nowOman.toISOString().slice(0,10);
    timeStr=s.padStart(5,'0');
    let d=new Date(dateStr+'T'+timeStr+':00+04:00');
    if (d.getTime()<=Date.now()) {
      const nextOman=new Date(nowOman.getTime()+24*3600000);
      dateStr=nextOman.toISOString().slice(0,10);
      d=new Date(dateStr+'T'+timeStr+':00+04:00');
    }
    return d;
  }
  const m=s.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})$/);
  if (m) return new Date(m[1]+'T'+m[2].padStart(5,'0')+':00+04:00');
  return null;
}

bot.onText(/^\/start(?:@\w+)?$/, async msg=>{
  if (!isOwnerMsg(msg)) return bot.sendMessage(msg.chat.id,'🔒 Private bot — Owner only.');
  await bot.sendMessage(msg.chat.id,'✅ Mahadi Tools Assistant Premium চালু হয়েছে।\n\n/panel দিয়ে Control Panel খুলুন।');
  await sendPanel(msg.chat.id);
});
bot.onText(/^\/panel(?:@\w+)?$/, async msg=>{ if(isOwnerMsg(msg)) await sendPanel(msg.chat.id); });
bot.onText(/^\/post(?:@\w+)?$/, async msg=>{
  if(!isOwnerMsg(msg)) return;
  sessions.set(msg.chat.id,{mode:'await_post'});
  await bot.sendMessage(msg.chat.id,'📣 Text / Photo / Video / File পাঠান। এরপর Preview দেখাব।');
});
bot.onText(/^\/status(?:@\w+)?$/, async msg=>{
  if(!isOwnerMsg(msg)) return;
  const status=await getSetting('service_status','online');
  await bot.sendMessage(msg.chat.id,'🟢 Bot Online\n📢 '+CHANNEL+'\n🛠 Service: '+status.toUpperCase());
});

bot.on('callback_query', async q=>{
  if (q.data && (q.data.startsWith('pub_') || q.data.startsWith('biz_'))) return;
  const msg=q.message;
  if (q.from) await trackUser(q.from,{chatId:msg?.chat?.id,chatType:msg?.chat?.type});
  if(!msg || !isOwnerUser(q.from)) return bot.answerCallbackQuery(q.id,{text:'Owner only',show_alert:true});
  await bot.answerCallbackQuery(q.id).catch(()=>{});
  const chatId=msg.chat.id;

  if(q.data==='main_panel') return sendPanel(chatId);
  if(q.data==='new_post' || q.data==='quick_post') {
    sessions.set(chatId,{mode:'await_post'});
    return bot.sendMessage(chatId,'📣 এখন Text / Photo / Video / File পাঠান।');
  }
  if(q.data==='check_channel') {
    try {
      const chat=await bot.getChat(CHANNEL); const me=await bot.getMe();
      const member=await bot.getChatMember(chat.id,me.id);
      return bot.sendMessage(chatId,
        '✅ CHANNEL READY\n\nName: '+(chat.title||CHANNEL)+'\nID: '+chat.id+'\nBot: '+member.status+
        '\n\n'+(member.status==='administrator'?'🟢 Posting permission ready.':'🟡 Bot-কে Admin করুন.')
      );
    } catch(e) { return bot.sendMessage(chatId,'❌ Channel access পাওয়া যায়নি। Bot-কে Channel Admin করুন।'); }
  }
  if(q.data==='settings_menu') return showSettings(chatId);

  if(q.data==='owner_identity') {
    const u=q.from;
    return bot.sendMessage(chatId,
      '🆔 OWNER IDENTITY\n\n' +
      'Telegram ID: ' + u.id + '\n' +
      'Username: ' + (u.username ? '@'+u.username : 'None') + '\n' +
      'First name: ' + (u.first_name || '-') + '\n' +
      'Last name: ' + (u.last_name || '-')
    );
  }

  if(q.data==='user_tracker') {
    const [countRes,recentRes,changesRes] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM tracked_users'),
      pool.query(`SELECT telegram_id,current_username,first_name,last_name,last_seen
                  FROM tracked_users ORDER BY last_seen DESC LIMIT 8`),
      pool.query(`SELECT telegram_id,field,old_value,new_value,created_at
                  FROM identity_history ORDER BY id DESC LIMIT 8`)
    ]);
    const recent = recentRes.rows.length
      ? recentRes.rows.map(x =>
          '• ' + x.telegram_id + ' | ' +
          (x.current_username ? '@'+x.current_username : (x.first_name || 'No username'))
        ).join('\n')
      : 'No users tracked yet.';
    const changes = changesRes.rows.length
      ? changesRes.rows.map(x =>
          '• ' + x.telegram_id + ' ' + x.field + ': ' +
          (x.old_value || 'none') + ' → ' + (x.new_value || 'none')
        ).join('\n')
      : 'No identity changes yet.';
    return bot.sendMessage(chatId,
      '👥 USER TRACKER\n\n' +
      'Known users: ' + countRes.rows[0].count + '\n\n' +
      'Recently seen:\n' + recent + '\n\n' +
      'Recent identity changes:\n' + changes
    );
  }

  if(q.data==='toggle_autopin' || q.data==='toggle_silent' || q.data==='toggle_preview') {
    const key=q.data==='toggle_autopin'?'auto_pin':q.data==='toggle_silent'?'silent_post':'link_preview';
    const cur=await getSetting(key,'false'); await setSetting(key,cur==='true'?'false':'true');
    await logAction('setting',key+' toggled');
    return showSettings(chatId);
  }
  if(q.data==='set_signature') {
    sessions.set(chatId,{mode:'set_signature'});
    return bot.sendMessage(chatId,'✍️ প্রতিটি পোস্টের শেষে যে Signature যাবে সেটা লিখুন।\nRemove করতে শুধু: off');
  }
  if(q.data==='buttons_info') {
    return bot.sendMessage(chatId,'🧩 Inline Button পোস্ট বানানোর সময় ➕ Add Button চাপুন।\nএক পোস্টে একাধিক button যোগ করা যাবে।');
  }
  if(q.data==='add_button') {
    const s=sessions.get(chatId);
    if(!s?.payload) return bot.sendMessage(chatId,'আগে একটি পোস্ট তৈরি করুন।');
    s.mode='button_label'; s.tempButton={}; sessions.set(chatId,s);
    return bot.sendMessage(chatId,'🧩 Button-এর নাম লিখুন। যেমন: Buy Now');
  }
  if(q.data==='publish_pending') {
    const s=sessions.get(chatId); if(!s?.payload) return bot.sendMessage(chatId,'Draft পাওয়া যায়নি।');
    try { const sent=await sendToChannel(s.payload); sessions.delete(chatId); return bot.sendMessage(chatId,'✅ Published! Message ID: '+sent.message_id); }
    catch(e){ console.error(e); return bot.sendMessage(chatId,'❌ Publish হয়নি। Channel permission/check করুন।'); }
  }
  if(q.data==='save_draft') {
    const s=sessions.get(chatId); if(!s?.payload) return bot.sendMessage(chatId,'Draft পাওয়া যায়নি।');
    const r=await pool.query('INSERT INTO drafts(payload) VALUES($1) RETURNING id',[s.payload]);
    sessions.delete(chatId); await logAction('draft_saved','id='+r.rows[0].id);
    return bot.sendMessage(chatId,'🗂 Draft #'+r.rows[0].id+' Saved.');
  }
  if(q.data==='drafts_menu') {
    const r=await pool.query('SELECT id,payload,created_at FROM drafts ORDER BY id DESC LIMIT 10');
    if(!r.rows.length) return bot.sendMessage(chatId,'🗂 কোনো saved draft নেই।');
    return bot.sendMessage(chatId,'🗂 SAVED DRAFTS',{
      reply_markup:{inline_keyboard:r.rows.map(x=>[
        {text:'#'+x.id+' Preview',callback_data:'draft_load_'+x.id},
        {text:'🗑 Delete',callback_data:'draft_del_'+x.id}
      ])}
    });
  }
  if(q.data.startsWith('draft_load_')) {
    const id=Number(q.data.split('_').pop());
    const r=await pool.query('SELECT payload FROM drafts WHERE id=$1',[id]);
    if(!r.rows[0]) return bot.sendMessage(chatId,'Draft পাওয়া যায়নি।');
    sessions.set(chatId,{mode:'confirm_post',payload:r.rows[0].payload,draftId:id});
    return previewPayload(chatId,r.rows[0].payload);
  }
  if(q.data.startsWith('draft_del_')) {
    const id=Number(q.data.split('_').pop()); await pool.query('DELETE FROM drafts WHERE id=$1',[id]);
    return bot.sendMessage(chatId,'🗑 Draft #'+id+' deleted.');
  }
  if(q.data==='schedule_pending') {
    const s=sessions.get(chatId); if(!s?.payload) return bot.sendMessage(chatId,'Post পাওয়া যায়নি।');
    s.mode='await_schedule_time'; sessions.set(chatId,s);
    return bot.sendMessage(chatId,'⏰ Oman time দিন।\nExample: 18:30\nঅথবা: 2026-10-04 18:30');
  }
  if(q.data==='scheduled_menu') {
    const r=await pool.query("SELECT id,schedule_at,status FROM scheduled_posts WHERE status='pending' ORDER BY schedule_at LIMIT 10");
    if(!r.rows.length) return bot.sendMessage(chatId,'⏰ কোনো scheduled post নেই।');
    const rows=r.rows.map(x=>[{text:'#'+x.id+' • '+new Date(x.schedule_at).toLocaleString('en-GB',{timeZone:'Asia/Muscat'}),callback_data:'sched_noop_'+x.id},{text:'❌',callback_data:'sched_del_'+x.id}]);
    return bot.sendMessage(chatId,'⏰ SCHEDULED POSTS',{reply_markup:{inline_keyboard:rows}});
  }
  if(q.data.startsWith('sched_del_')) {
    const id=Number(q.data.split('_').pop()); await pool.query("UPDATE scheduled_posts SET status='cancelled' WHERE id=$1",[id]);
    return bot.sendMessage(chatId,'❌ Scheduled post #'+id+' cancelled.');
  }
  if(q.data==='post_tools') {
    return bot.sendMessage(chatId,'🛠 POST TOOLS',{
      reply_markup:{inline_keyboard:[
        [{text:'🗑 Delete Last',callback_data:'delete_last'},{text:'📌 Pin Last',callback_data:'pin_last'}],
        [{text:'📍 Unpin All',callback_data:'unpin_all'},{text:'✏️ Edit Last',callback_data:'edit_last'}],
        [{text:'⬅️ Main Panel',callback_data:'main_panel'}]
      ]}
    });
  }
  if(['delete_last','pin_last','unpin_all','edit_last'].includes(q.data)) {
    if(q.data==='unpin_all') { try{await bot.unpinAllChatMessages(CHANNEL); return bot.sendMessage(chatId,'📍 সব pinned message unpin হয়েছে।');}catch{return bot.sendMessage(chatId,'❌ Unpin হয়নি।');}}
    const r=await pool.query('SELECT telegram_message_id,payload FROM post_history ORDER BY id DESC LIMIT 1');
    const last=r.rows[0]; if(!last) return bot.sendMessage(chatId,'History খালি।');
    if(q.data==='delete_last') { try{await bot.deleteMessage(CHANNEL,last.telegram_message_id); return bot.sendMessage(chatId,'🗑 Last post deleted.');}catch{return bot.sendMessage(chatId,'❌ Delete হয়নি।');}}
    if(q.data==='pin_last') { try{await bot.pinChatMessage(CHANNEL,last.telegram_message_id,{disable_notification:true}); return bot.sendMessage(chatId,'📌 Last post pinned.');}catch{return bot.sendMessage(chatId,'❌ Pin হয়নি।');}}
    if(q.data==='edit_last') {
      sessions.set(chatId,{mode:'edit_last',last});
      return bot.sendMessage(chatId,'✏️ নতুন text/caption লিখুন।');
    }
  }
  if(q.data==='history') {
    const r=await pool.query('SELECT id,telegram_message_id,created_at FROM post_history ORDER BY id DESC LIMIT 10');
    if(!r.rows.length) return bot.sendMessage(chatId,'📊 এখনো কোনো publish history নেই।');
    return bot.sendMessage(chatId,'📊 LAST POSTS\n\n'+r.rows.map(x=>'#'+x.id+' • Message '+x.telegram_message_id+' • '+new Date(x.created_at).toLocaleString('en-GB',{timeZone:'Asia/Muscat'})).join('\n'));
  }
  if(q.data==='commands_menu') {
    const r=await pool.query('SELECT command FROM custom_commands WHERE enabled=TRUE ORDER BY command');
    return bot.sendMessage(chatId,'🤖 CUSTOM COMMANDS\n\n'+(r.rows.length?r.rows.map(x=>'/'+x.command).join('\n'):'কোনো custom command নেই।'),{
      reply_markup:{inline_keyboard:[
        [{text:'➕ Add Command',callback_data:'cmd_add'},{text:'🗑 Delete Command',callback_data:'cmd_delete'}],
        [{text:'⬅️ Main Panel',callback_data:'main_panel'}]
      ]}
    });
  }
  if(q.data==='cmd_add') { sessions.set(chatId,{mode:'cmd_name'}); return bot.sendMessage(chatId,'Command name লিখুন। যেমন: price'); }
  if(q.data==='cmd_delete') { sessions.set(chatId,{mode:'cmd_delete'}); return bot.sendMessage(chatId,'যে command delete করবেন তার নাম লিখুন। যেমন: price'); }

  if(q.data==='support_menu') {
    const status=await getSetting('service_status','online');
    return bot.sendMessage(chatId,'💬 SUPPORT SETUP\n\nCurrent Service Status: '+status.toUpperCase(),{
      reply_markup:{inline_keyboard:[
        [{text:'🟢 Online',callback_data:'status_online'},{text:'🟠 Maintenance',callback_data:'status_maintenance'}],
        [{text:'🔴 Issue',callback_data:'status_issue'},{text:'📝 Maintenance Note',callback_data:'maintenance_note'}],
        [{text:'⬅️ Main Panel',callback_data:'main_panel'}]
      ]}
    });
  }
  if(q.data.startsWith('status_')) {
    const status=q.data.replace('status_',''); await setSetting('service_status',status); await logAction('service_status',status);
    return bot.sendMessage(chatId,'✅ Service status set: '+status.toUpperCase());
  }
  if(q.data==='maintenance_note') { sessions.set(chatId,{mode:'maintenance_note'}); return bot.sendMessage(chatId,'📝 Maintenance reply লিখুন।'); }

  if(q.data==='logs') {
    const r=await pool.query('SELECT action,details,created_at FROM activity_logs ORDER BY id DESC LIMIT 12');
    return bot.sendMessage(chatId,'🧾 ACTIVITY LOGS\n\n'+(r.rows.length?r.rows.map(x=>'• '+x.action+' — '+(x.details||'')+' — '+new Date(x.created_at).toLocaleString('en-GB',{timeZone:'Asia/Muscat'})).join('\n'):'No logs yet.'));
  }
  if(q.data==='help') {
    return bot.sendMessage(chatId,'❓ HELP\n\n/start — Start\n/panel — Premium Panel\n/post — New Post\n/status — Status\n\nসব বড় feature button দিয়েই control করা যাবে।');
  }
  if(q.data==='cancel_pending') { sessions.delete(chatId); return bot.sendMessage(chatId,'❌ Cancelled.'); }
});

bot.on('message', async msg=>{
  if (msg.from) await trackUser(msg.from,{chatId:msg.chat?.id,chatType:msg.chat?.type});
  if (Array.isArray(msg.new_chat_members)) {
    for (const u of msg.new_chat_members) {
      await trackUser(u,{chatId:msg.chat?.id,chatType:msg.chat?.type});
      await logAction('group_join', String(u.id) + (u.username ? ' @'+u.username : ''));
    }
  }
  if (msg.left_chat_member) {
    await trackUser(msg.left_chat_member,{chatId:msg.chat?.id,chatType:msg.chat?.type});
    await logAction('group_leave', String(msg.left_chat_member.id) + (msg.left_chat_member.username ? ' @'+msg.left_chat_member.username : ''));
  }
});

bot.on('message', async msg=>{
  if(!isOwnerMsg(msg)) return;
  if(msg.text?.startsWith('/')) {
    const cmd=msg.text.split(/\s+/)[0].slice(1).split('@')[0].toLowerCase();
    if(['start','panel','post','status'].includes(cmd)) return;
    const r=await pool.query('SELECT response FROM custom_commands WHERE command=$1 AND enabled=TRUE',[cmd]);
    if(r.rows[0]) return bot.sendMessage(msg.chat.id,r.rows[0].response);
  }

  const chatId=msg.chat.id, s=sessions.get(chatId);
  if(!s) return;

  if(s.mode==='await_post') {
    let payload;
    if(msg.photo?.length) payload={type:'photo',fileId:msg.photo[msg.photo.length-1].file_id,caption:msg.caption||'',buttons:[]};
    else if(msg.video) payload={type:'video',fileId:msg.video.file_id,caption:msg.caption||'',buttons:[]};
    else if(msg.document) payload={type:'document',fileId:msg.document.file_id,caption:msg.caption||'',buttons:[]};
    else if(msg.text) payload={type:'text',text:msg.text,buttons:[]};
    else return bot.sendMessage(chatId,'Text / Photo / Video / File পাঠান।');
    sessions.set(chatId,{mode:'confirm_post',payload});
    return previewPayload(chatId,payload);
  }
  if(s.mode==='button_label') {
    s.tempButton.text=msg.text||'Button'; s.mode='button_url'; sessions.set(chatId,s);
    return bot.sendMessage(chatId,'🔗 Button URL দিন। Example: https://t.me/Mahadihasanrony11');
  }
  if(s.mode==='button_url') {
    const url=(msg.text||'').trim();
    if(!/^(https?:\/\/|tg:\/\/)/i.test(url)) return bot.sendMessage(chatId,'Valid http/https/tg URL দিন।');
    s.payload.buttons=s.payload.buttons||[]; s.payload.buttons.push({text:s.tempButton.text,url});
    s.mode='confirm_post'; delete s.tempButton; sessions.set(chatId,s);
    await bot.sendMessage(chatId,'✅ Button added: '+s.payload.buttons[s.payload.buttons.length-1].text);
    return previewPayload(chatId,s.payload);
  }
  if(s.mode==='await_schedule_time') {
    const d=parseOmanSchedule(msg.text);
    if(!d || isNaN(d.getTime())) return bot.sendMessage(chatId,'সময় বুঝিনি। Example: 18:30 অথবা 2026-10-04 18:30');
    const r=await pool.query('INSERT INTO scheduled_posts(payload,schedule_at) VALUES($1,$2) RETURNING id',[s.payload,d]);
    sessions.delete(chatId); await logAction('scheduled','id='+r.rows[0].id);
    return bot.sendMessage(chatId,'⏰ Scheduled #'+r.rows[0].id+'\nOman time: '+d.toLocaleString('en-GB',{timeZone:'Asia/Muscat'}));
  }
  if(s.mode==='set_signature') {
    await setSetting('signature',(msg.text||'').trim().toLowerCase()==='off'?'':msg.text||'');
    sessions.delete(chatId); return bot.sendMessage(chatId,'✅ Signature updated.');
  }
  if(s.mode==='maintenance_note') {
    await setSetting('maintenance_note',msg.text||''); sessions.delete(chatId);
    return bot.sendMessage(chatId,'✅ Maintenance note updated.');
  }
  if(s.mode==='cmd_name') {
    const cmd=(msg.text||'').trim().replace(/^\//,'').toLowerCase().replace(/[^a-z0-9_]/g,'');
    if(!cmd) return bot.sendMessage(chatId,'Valid command name দিন। English letters/numbers/_ ব্যবহার করুন।');
    s.command=cmd; s.mode='cmd_response'; sessions.set(chatId,s);
    return bot.sendMessage(chatId,'/'+cmd+' দিলে bot কী reply দেবে সেটা লিখুন।');
  }
  if(s.mode==='cmd_response') {
    await pool.query(`INSERT INTO custom_commands(command,response,enabled) VALUES($1,$2,TRUE)
      ON CONFLICT(command) DO UPDATE SET response=EXCLUDED.response,enabled=TRUE`,[s.command,msg.text||'']);
    await logAction('custom_command','/'+s.command); sessions.delete(chatId);
    return bot.sendMessage(chatId,'✅ /'+s.command+' command saved.');
  }
  if(s.mode==='cmd_delete') {
    const cmd=(msg.text||'').trim().replace(/^\//,'').toLowerCase();
    await pool.query('DELETE FROM custom_commands WHERE command=$1',[cmd]); sessions.delete(chatId);
    return bot.sendMessage(chatId,'🗑 /'+cmd+' deleted.');
  }
  if(s.mode==='edit_last') {
    const p=s.last.payload; const id=s.last.telegram_message_id;
    try {
      if(p.type==='text') await bot.editMessageText(msg.text||'',{chat_id:CHANNEL,message_id:id});
      else await bot.editMessageCaption(msg.text||'',{chat_id:CHANNEL,message_id:id});
      sessions.delete(chatId); await logAction('edit_last','message_id='+id);
      return bot.sendMessage(chatId,'✅ Last post edited.');
    } catch(e) { console.error(e); return bot.sendMessage(chatId,'❌ Edit হয়নি।'); }
  }
});

setInterval(async ()=>{
  try {
    const r=await pool.query("SELECT id,payload FROM scheduled_posts WHERE status='pending' AND schedule_at<=NOW() ORDER BY schedule_at LIMIT 5");
    for(const row of r.rows) {
      try {
        await sendToChannel(row.payload);
        await pool.query("UPDATE scheduled_posts SET status='published',published_at=NOW() WHERE id=$1",[row.id]);
        await logAction('scheduled_publish','id='+row.id);
      } catch(e) { console.error('Scheduled publish failed',row.id,e.message); }
    }
  } catch(e){ console.error('Schedule poll error',e.message); }
},30000);

setupGroupFeatures({
  bot, pool, isOwnerUser, getSetting, setSetting, logAction, trackUser,
  OWNER_USERNAME, CHANNEL, TOKEN
});

setupBusinessFeatures({
  bot, pool, isOwnerUser, getSetting, setSetting,
  OWNER_USERNAME, CHANNEL
});

bot.on('polling_error',err=>console.error('Polling error:',err.message));
console.log('Mahadi Tools Assistant v3 booted');
