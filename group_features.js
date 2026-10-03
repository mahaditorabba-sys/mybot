module.exports = function setupGroupFeatures(ctx) {
  const { bot, pool, isOwnerUser, getSetting, setSetting, trackUser, OWNER_USERNAME, TOKEN } = ctx;
  const flood = new Map();
  const ownerSessions = new Map();
  let me = null;

  async function init() {
    await pool.query(
      'CREATE TABLE IF NOT EXISTS group_config (' +
      'chat_id BIGINT PRIMARY KEY, title TEXT, enabled BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT NOW());' +
      'CREATE TABLE IF NOT EXISTS moderation_events (' +
      'id SERIAL PRIMARY KEY, chat_id BIGINT NOT NULL, user_id BIGINT, action TEXT NOT NULL, reason TEXT, created_at TIMESTAMPTZ DEFAULT NOW());' +
      'CREATE TABLE IF NOT EXISTS subscription_plans (' +
      'id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL, title TEXT NOT NULL, price_text TEXT NOT NULL, details TEXT, enabled BOOLEAN DEFAULT TRUE);' +
      'CREATE TABLE IF NOT EXISTS keyword_replies (' +
      'id SERIAL PRIMARY KEY, keyword TEXT UNIQUE NOT NULL, response TEXT NOT NULL, enabled BOOLEAN DEFAULT TRUE);' +
      'CREATE TABLE IF NOT EXISTS support_tickets (' +
      'id SERIAL PRIMARY KEY, user_id BIGINT NOT NULL, username TEXT, chat_id BIGINT NOT NULL, message_id BIGINT, text TEXT NOT NULL, status TEXT DEFAULT \'open\', owner_reply TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), closed_at TIMESTAMPTZ);'
    );
    const defaults = {
      primary_group_id: '', group_link_filter: 'true', group_flood_guard: 'true',
      group_welcome: 'true', group_support: 'true', group_lockdown: 'false',
      bad_words: '', nsfw_guard: 'true',
      contact_telegram: OWNER_USERNAME, contact_whatsapp: ''
    };
    for (const k of Object.keys(defaults)) {
      await pool.query('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING',[k,defaults[k]]);
    }
    const waMigration = await getSetting('migration_whatsapp_18147960771','false');
    if (waMigration !== 'true') {
      await setSetting('contact_whatsapp','18147960771');
      await setSetting('migration_whatsapp_18147960771','true');
    }
    const plans = [
      ['15d','15 Days Premium','50৳','15 দিনের Mahadi Tools Premium access'],
      ['1m','1 Month Premium','100৳','১ মাস Mahadi Tools Premium access'],
      ['2m','2 Months Premium','190৳','২ মাস Mahadi Tools Premium access'],
      ['1y','1 Year Premium','Contact Owner','১ বছরের price Owner থেকে confirm করুন']
    ];
    for (const p of plans) {
      await pool.query('INSERT INTO subscription_plans(code,title,price_text,details) VALUES($1,$2,$3,$4) ON CONFLICT(code) DO NOTHING',p);
    }
    const oneYearPriceMigration = await getSetting('migration_1y_price_1000','false');
    if (oneYearPriceMigration !== 'true') {
      await pool.query("UPDATE subscription_plans SET price_text='1000৳' WHERE code='1y'");
      await setSetting('migration_1y_price_1000','true');
    }
    const replies = [
      ['device change','📱 Device change করতে /devicechange লিখে আপনার account/device details দিন। Password public group-এ দেবেন না।'],
      ['device full','📱 Device Full দেখালে Owner-এর সাথে যোগাযোগ করুন। প্রয়োজন হলে পুরোনো device reset করে নতুন device activate করা হবে।'],
      ['login problem','🔐 Login সমস্যা হলে Gmail/username ঠিক আছে কিনা দেখুন। না হলে /ticket লিখে details পাঠান।'],
      ['password','🔑 Password সমস্যা হলে /ticket লিখে account details দিন। Password public group-এ পাঠাবেন না।']
    ];
    for (const r of replies) {
      await pool.query('INSERT INTO keyword_replies(keyword,response) VALUES($1,$2) ON CONFLICT(keyword) DO NOTHING',r);
    }
    me = await bot.getMe();
    await setMeta();
    console.log('Group/support module ready');
  }

  async function tg(method,payload) {
    try {
      await fetch('https://api.telegram.org/bot'+TOKEN+'/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
    } catch {}
  }
  async function setMeta() {
    await tg('setMyName',{name:'Mahadi Tools Assistant'});
    await tg('setMyShortDescription',{short_description:'Mahadi Tools • Channel • Group • Support'});
    await tg('setMyDescription',{description:'Official Mahadi Tools channel, group security and smart support assistant.'});
    await tg('setMyCommands',{commands:[
      {command:'start',description:'Open Mahadi Tools menu'},
      {command:'plans',description:'View premium plans'},
      {command:'myorders',description:'View your orders'},
      {command:'mysubscription',description:'View subscription and expiry'},
      {command:'renew',description:'Renew premium'},
      {command:'ticket',description:'Open support ticket'},
      {command:'panel',description:'Owner Premium Control Panel'},
      {command:'post',description:'Create channel post'},
      {command:'bindgroup',description:'Owner: connect group'},
      {command:'groupsettings',description:'Owner: group security panel'},
      {command:'analytics',description:'Owner: analytics'},
      {command:'business',description:'Owner: orders and business tools'},
      {command:'orders',description:'Owner: view recent orders'},
      {command:'devicechange',description:'Request a device change'},
      {command:'proof',description:'Submit payment proof for an order'},
      {command:'adminpack',description:'Owner: premium admin tools'},
      {command:'usersearch',description:'Owner: search a tracked user'},
      {command:'backup',description:'Owner: export settings'}
    ]});
  }

  async function saveOwner(user) {
    if (user && isOwnerUser(user)) await setSetting('owner_id',String(user.id));
  }
  async function ownerAlert(text,opts) {
    const id = await getSetting('owner_id','');
    if (!id) return;
    try { await bot.sendMessage(Number(id),text,opts||{}); } catch {}
  }
  async function boundGroup() {
    const v = await getSetting('primary_group_id','');
    return v ? Number(v) : null;
  }
  async function isBound(chatId) {
    const g = await boundGroup();
    return !!g && Number(chatId) === g;
  }
  async function isAdmin(chatId,userId) {
    try {
      const m = await bot.getChatMember(chatId,userId);
      return m.status === 'creator' || m.status === 'administrator';
    } catch { return false; }
  }
  async function plans(chatId,replyId) {
    const r = await pool.query('SELECT id,title,price_text FROM subscription_plans WHERE enabled=TRUE ORDER BY id');
    const kb = r.rows.map(function(x){return [{text:x.title+' — '+x.price_text,callback_data:'pub_plan_'+x.id}];});
    return bot.sendMessage(chatId,'💎 MAHADI TOOLS PREMIUM PLANS\n\nPlan সিলেক্ট করুন:',{reply_to_message_id:replyId,reply_markup:{inline_keyboard:kb}});
  }

  async function plansAdmin(chatId) {
    const r = await pool.query('SELECT id,title,price_text FROM subscription_plans ORDER BY id');
    const rows = r.rows.map(function(x){
      return [
        {text:'✏️ '+x.title+' — '+x.price_text,callback_data:'grp_planedit_'+x.id}
      ];
    });
    rows.push([{text:'👁 Customer Preview',callback_data:'grp_planpreview'}]);
    rows.push([{text:'📱 Set WhatsApp',callback_data:'grp_setwa'},{text:'✈️ Set Telegram',callback_data:'grp_settg'}]);
    const wa=await getSetting('contact_whatsapp','');
    const tg=await getSetting('contact_telegram',OWNER_USERNAME);
    return bot.sendMessage(chatId,
      '💎 PREMIUM SALES SETTINGS\n\n'+
      'এখান থেকে plan-এর price/details edit করতে পারবেন।\n\n'+
      '✈️ Telegram: @'+(tg||OWNER_USERNAME)+'\n'+
      '📱 WhatsApp: '+(wa||'Not set'),
      {reply_markup:{inline_keyboard:rows}}
    );
  }

  async function customerPlan(chatId, plan, user) {
    const wa=(await getSetting('contact_whatsapp','')).replace(/[^0-9]/g,'');
    const kb=[];
    if(wa) kb.push([{text:'📱 WhatsApp',callback_data:'pub_via_whatsapp_'+plan.id}]);
    kb.push([{text:'✈️ Telegram',callback_data:'pub_via_telegram_'+plan.id}]);
    return bot.sendMessage(chatId,
      '💎 '+plan.title+'\n💰 '+plan.price_text+'\n\n'+(plan.details||'')+
      '\n\nকোথায় message দিতে চান?\nতারপর bKash/Nagad সিলেক্ট করলে ready-made message খুলবে।',
      {reply_markup:{inline_keyboard:kb}}
    );
  }

  async function checkoutMethodLinks(chatId, planId, via, user) {
    const r=await pool.query('SELECT * FROM subscription_plans WHERE id=$1',[planId]);
    const p=r.rows[0]; if(!p)return;

    const o=await pool.query(
      'INSERT INTO sales_orders(user_id,username,chat_id,message_id,plan_id,plan_title,price_text,contact_method) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
      [user.id,user.username||null,chatId,null,p.id,p.title,p.price_text,via]
    ).catch(()=>({rows:[]}));
    const oid=o.rows[0]?.id;

    const makeText=(method)=>
      'Assalamu Alaikum 👋\n'+
      'Mahadi Tools Premium নিতে চাই।\n'+
      (oid?'Order ID: #'+oid+'\n':'')+
      'Plan: '+p.title+'\n'+
      'Price: '+p.price_text+'\n'+
      'Payment: '+method+'\n\n'+
      'Payment details দিন।';

    const bkashText=makeText('bKash');
    const nagadText=makeText('Nagad');
    let bkashUrl='',nagadUrl='';

    if(via==='whatsapp'){
      const wa=(await getSetting('contact_whatsapp','')).replace(/[^0-9]/g,'');
      if(!wa)return bot.sendMessage(chatId,'📱 WhatsApp এখন available নয়। Telegram ব্যবহার করুন।');
      bkashUrl='https://wa.me/'+wa+'?text='+encodeURIComponent(bkashText);
      nagadUrl='https://wa.me/'+wa+'?text='+encodeURIComponent(nagadText);
    } else {
      const tg=(await getSetting('contact_telegram',OWNER_USERNAME)).replace(/^@/,'');
      bkashUrl='https://t.me/'+tg+'?text='+encodeURIComponent(bkashText);
      nagadUrl='https://t.me/'+tg+'?text='+encodeURIComponent(nagadText);
    }

    await ownerAlert(
      '🛒 CHECKOUT STARTED'+(oid?' #'+oid:'')+'\n\nUser: '+user.id+' '+(user.username?'@'+user.username:'')+
      '\nPlan: '+p.title+'\nPrice: '+p.price_text+'\nContact: '+(via==='whatsapp'?'WhatsApp':'Telegram')+
      '\nPayment method customer message-এ থাকবে।'
    );

    return bot.sendMessage(chatId,
      (via==='whatsapp'?'📱 WhatsApp':'✈️ Telegram')+' selected'+(oid?' • Order #'+oid:'')+
      '\n\nPayment method সিলেক্ট করুন। Button চাপলেই ready-made message খুলবে—শুধু Send করবেন।',
      {reply_markup:{inline_keyboard:[
        [{text:'💗 bKash',url:bkashUrl},{text:'🟠 Nagad',url:nagadUrl}]
      ]}}
    );
  }

  async function settingsPanel(chatId) {
    const keys = ['group_link_filter','group_flood_guard','group_welcome','group_support','group_lockdown','nsfw_guard'];
    const v = {};
    for (const k of keys) v[k] = await getSetting(k,k==='group_lockdown'?'false':'true');
    const scan = process.env.NSFW_API_URL ? 'CONNECTED' : 'NEEDS AI KEY';
    return bot.sendMessage(chatId,
      '🛡️ GROUP SECURITY PANEL\n\n' +
      '🔗 Link Filter: '+(v.group_link_filter==='true'?'ON':'OFF')+'\n' +
      '🌊 Flood Guard: '+(v.group_flood_guard==='true'?'ON':'OFF')+'\n' +
      '👋 Welcome: '+(v.group_welcome==='true'?'ON':'OFF')+'\n' +
      '🤖 Smart Support: '+(v.group_support==='true'?'ON':'OFF')+'\n' +
      '🚨 Lockdown: '+(v.group_lockdown==='true'?'ON':'OFF')+'\n' +
      '🔞 AI Media Guard: '+(v.nsfw_guard==='true'?scan:'OFF'),
      {reply_markup:{inline_keyboard:[
        [{text:'🔗 Link',callback_data:'grp_link'},{text:'🌊 Flood',callback_data:'grp_flood'}],
        [{text:'👋 Welcome',callback_data:'grp_welcome'},{text:'🤖 Support',callback_data:'grp_support'}],
        [{text:'🚨 Lockdown',callback_data:'grp_lockdown'},{text:'🔞 Media Guard',callback_data:'grp_nsfw'}],
        [{text:'💎 Plans',callback_data:'grp_plans'},{text:'🎫 Tickets',callback_data:'grp_tickets'}],
        [{text:'📊 Analytics',callback_data:'grp_analytics'}]
      ]}}
    );
  }
  async function analytics() {
    const a = await Promise.all([
      pool.query('SELECT COUNT(*)::int n FROM tracked_users'),
      pool.query("SELECT COUNT(*)::int n FROM support_tickets WHERE status='open'"),
      pool.query('SELECT COUNT(*)::int n FROM moderation_events'),
      pool.query('SELECT COUNT(*)::int n FROM post_history'),
      pool.query("SELECT COUNT(*)::int n FROM scheduled_posts WHERE status='pending'")
    ]);
    return '📊 MAHADI TOOLS ANALYTICS\n\n👥 Known Users: '+a[0].rows[0].n+'\n🎫 Open Tickets: '+a[1].rows[0].n+'\n🛡 Moderation Events: '+a[2].rows[0].n+'\n📣 Published Posts: '+a[3].rows[0].n+'\n⏰ Scheduled: '+a[4].rows[0].n;
  }
  function externalLink(text) {
    if (!text) return false;
    const m = text.match(/(?:https?:\/\/|www\.|t\.me\/)[^\s]+/ig) || [];
    return m.some(function(u){
      const s=u.toLowerCase();
      return s.indexOf('t.me/mahaditoolsofficial')<0 && s.indexOf('t.me/'+((me&&me.username)||'').toLowerCase())<0;
    });
  }
  function badWord(text,list) {
    if (!text || !list) return false;
    const s=text.toLowerCase();
    return list.split(',').map(function(x){return x.trim().toLowerCase();}).filter(Boolean).some(function(w){return s.indexOf(w)>=0;});
  }
  async function remove(msg,action,reason) {
    try { await bot.deleteMessage(msg.chat.id,msg.message_id); } catch {}
    await pool.query('INSERT INTO moderation_events(chat_id,user_id,action,reason) VALUES($1,$2,$3,$4)',[msg.chat.id,msg.from?msg.from.id:null,action,reason]).catch(function(){});
    await ownerAlert('🛡️ Security action\nGroup: '+(msg.chat.title||msg.chat.id)+'\nUser: '+(msg.from?msg.from.id:'-')+' '+(msg.from&&msg.from.username?'@'+msg.from.username:'')+'\nAction: '+action+'\nReason: '+reason);
  }
  async function scan(msg) {
    if (await getSetting('nsfw_guard','true') !== 'true' || !process.env.NSFW_API_URL) return null;
    const f = msg.photo&&msg.photo.length ? msg.photo[msg.photo.length-1] : (msg.video||msg.animation);
    if (!f || !f.file_id || (f.file_size && f.file_size>20*1024*1024)) return null;
    try {
      const url = await bot.getFileLink(f.file_id);
      const body = Buffer.from(await fetch(url).then(function(r){return r.arrayBuffer();}));
      const h = {'content-type':'application/octet-stream'};
      if (process.env.NSFW_API_KEY) h.authorization='Bearer '+process.env.NSFW_API_KEY;
      const j = await fetch(process.env.NSFW_API_URL,{method:'POST',headers:h,body:body}).then(function(r){return r.json();});
      const score = Number(j.score||j.nsfw_score||0);
      return {unsafe:!!(j.unsafe||j.nsfw||j.blocked||j.label==='nsfw'||score>=0.8),score:score};
    } catch { return null; }
  }
  async function support(msg) {
    if (await getSetting('group_support','true') !== 'true' || !msg.text) return;
    const t=msg.text.toLowerCase();
    if (/subscription|premium|price|plan|প্যাকেজ|সাবস্ক্রিপশন/i.test(t)) return plans(msg.chat.id,msg.message_id);
    if (/server|website|maintenance|সার্ভার|ওয়েবসাইট|মেইনটেন্যান্স/i.test(t)) {
      const st=await getSetting('service_status','online');
      const note=await getSetting('maintenance_note','মেইনটেন্যান্সের কাজ চলছে।');
      return bot.sendMessage(msg.chat.id,st==='online'?'🟢 Mahadi Tools service status: ONLINE':'🛠 Service Status: '+st.toUpperCase()+'\n\n'+note,{reply_to_message_id:msg.message_id});
    }
    const faq=await pool.query('SELECT question,answer FROM faqs WHERE enabled=TRUE ORDER BY length(question) DESC').catch(()=>({rows:[]}));
    for (const x of faq.rows) if (t.indexOf(String(x.question).toLowerCase())>=0) return bot.sendMessage(msg.chat.id,x.answer,{reply_to_message_id:msg.message_id});
    const r=await pool.query('SELECT keyword,response FROM keyword_replies WHERE enabled=TRUE ORDER BY length(keyword) DESC');
    for (const x of r.rows) if (t.indexOf(x.keyword.toLowerCase())>=0) return bot.sendMessage(msg.chat.id,x.response,{reply_to_message_id:msg.message_id});
    const mention=me&&me.username?'@'+me.username.toLowerCase():'';
    if ((mention&&t.indexOf(mention)>=0) || (msg.reply_to_message&&msg.reply_to_message.from&&me&&msg.reply_to_message.from.id===me.id)) {
      return bot.sendMessage(msg.chat.id,'🤖 Mahadi Tools Support\n\nজিজ্ঞেস করতে পারেন: Premium, Server/Website status, Device change, Login problem.\nTicket: /ticket আপনার সমস্যা',{reply_to_message_id:msg.message_id});
    }
  }

  bot.onText(/^\/bindgroup(?:@\w+)?$/,async function(msg){
    await saveOwner(msg.from); if (!isOwnerUser(msg.from)) return;
    if (msg.chat.type!=='group' && msg.chat.type!=='supergroup') return bot.sendMessage(msg.chat.id,'এই command Group-এর ভিতরে দিন।');
    await setSetting('primary_group_id',String(msg.chat.id));
    await pool.query('INSERT INTO group_config(chat_id,title,enabled) VALUES($1,$2,TRUE) ON CONFLICT(chat_id) DO UPDATE SET title=EXCLUDED.title,enabled=TRUE',[msg.chat.id,msg.chat.title||'Group']);
    return bot.sendMessage(msg.chat.id,'✅ Group connected. /groupsettings দিয়ে security panel খুলুন।');
  });
  bot.onText(/^\/groupsettings(?:@\w+)?$/,async function(msg){await saveOwner(msg.from);if(isOwnerUser(msg.from))return settingsPanel(msg.chat.id);});
  bot.onText(/^\/plans(?:@\w+)?$/,async function(msg){if(msg.chat.type==='private'&&!isOwnerUser(msg.from))return;if((msg.chat.type==='group'||msg.chat.type==='supergroup')&&!(await isBound(msg.chat.id)))return;return plans(msg.chat.id,msg.message_id);});
  bot.onText(/^\/ticket(?:@\w+)?(?:\s+([\s\S]+))?$/,async function(msg,match){
    if ((msg.chat.type==='group'||msg.chat.type==='supergroup')&&!(await isBound(msg.chat.id))) return;
    const text=(match&&match[1]?match[1]:'').trim(); if(!text)return bot.sendMessage(msg.chat.id,'🎫 লিখুন: /ticket আপনার সমস্যাটা');
    const r=await pool.query('INSERT INTO support_tickets(user_id,username,chat_id,message_id,text) VALUES($1,$2,$3,$4,$5) RETURNING id',[msg.from.id,msg.from.username||null,msg.chat.id,msg.message_id,text]);
    const id=r.rows[0].id; await bot.sendMessage(msg.chat.id,'✅ Ticket #'+id+' তৈরি হয়েছে।',{reply_to_message_id:msg.message_id});
    await ownerAlert('🎫 NEW TICKET #'+id+'\nUser: '+msg.from.id+' '+(msg.from.username?'@'+msg.from.username:'')+'\n\n'+text,{reply_markup:{inline_keyboard:[[{text:'💬 Reply',callback_data:'grp_reply_'+id},{text:'✅ Close',callback_data:'grp_close_'+id}]]}});
  });
  bot.onText(/^\/analytics(?:@\w+)?$/,async function(msg){await saveOwner(msg.from);if(isOwnerUser(msg.from))return bot.sendMessage(msg.chat.id,await analytics());});
  bot.onText(/^\/setplan(?:@\w+)?\s+(.+)$/i,async function(msg,match){
    await saveOwner(msg.from);if(!isOwnerUser(msg.from))return;const p=(match[1]||'').split('|').map(function(x){return x.trim();});
    if(p.length<4)return bot.sendMessage(msg.chat.id,'Format: /setplan 1m | 1 Month Premium | 100৳ | Details');
    await pool.query('INSERT INTO subscription_plans(code,title,price_text,details,enabled) VALUES($1,$2,$3,$4,TRUE) ON CONFLICT(code) DO UPDATE SET title=EXCLUDED.title,price_text=EXCLUDED.price_text,details=EXCLUDED.details,enabled=TRUE',[p[0],p[1],p[2],p.slice(3).join(' | ')]);
    return bot.sendMessage(msg.chat.id,'✅ Plan updated.');
  });
  bot.onText(/^\/addreply(?:@\w+)?\s+(.+)$/i,async function(msg,match){
    await saveOwner(msg.from);if(!isOwnerUser(msg.from))return;const p=(match[1]||'').split('|').map(function(x){return x.trim();});if(p.length<2)return bot.sendMessage(msg.chat.id,'Format: /addreply keyword | reply text');
    await pool.query('INSERT INTO keyword_replies(keyword,response,enabled) VALUES($1,$2,TRUE) ON CONFLICT(keyword) DO UPDATE SET response=EXCLUDED.response,enabled=TRUE',[p.shift().toLowerCase(),p.join(' | ')]);return bot.sendMessage(msg.chat.id,'✅ Auto reply saved.');
  });
  bot.onText(/^\/badwords(?:@\w+)?\s+(.+)$/i,async function(msg,match){await saveOwner(msg.from);if(isOwnerUser(msg.from)){await setSetting('bad_words',match[1]||'');return bot.sendMessage(msg.chat.id,'✅ Bad-word list updated.');}});
  bot.onText(/^\/backup(?:@\w+)?$/,async function(msg){
    await saveOwner(msg.from);if(!isOwnerUser(msg.from))return;
    const a=await Promise.all([pool.query('SELECT key,value FROM settings ORDER BY key'),pool.query('SELECT command,response,enabled FROM custom_commands'),pool.query('SELECT code,title,price_text,details,enabled FROM subscription_plans'),pool.query('SELECT keyword,response,enabled FROM keyword_replies')]);
    const data={exported_at:new Date().toISOString(),settings:a[0].rows.filter(function(x){return !/token|password|secret|key/i.test(x.key);}),commands:a[1].rows,plans:a[2].rows,replies:a[3].rows};
    return bot.sendDocument(msg.chat.id,Buffer.from(JSON.stringify(data,null,2)),{}, {filename:'mahadi-tools-backup.json',contentType:'application/json'});
  });

  bot.on('callback_query',async function(q){
    const d=q.data||'';
    if(d.indexOf('pub_')===0){
      await bot.answerCallbackQuery(q.id).catch(function(){});
      if(d.indexOf('pub_plan_')===0){
        const id=Number(d.replace('pub_plan_',''));
        const r=await pool.query('SELECT * FROM subscription_plans WHERE id=$1',[id]);
        const p=r.rows[0];
        if(p)return customerPlan(q.message.chat.id,p,q.from);
      }
      if(d.indexOf('pub_via_')===0){
        const m=d.match(/^pub_via_(whatsapp|telegram)_(\d+)$/);
        if(!m)return;
        return checkoutMethodLinks(q.message.chat.id,Number(m[2]),m[1],q.from);
      }
      if(d.indexOf('pub_pay_')===0){
        const m=d.match(/^pub_pay_(bkash|nagad)_(\d+)$/);
        if(!m)return;
        const r=await pool.query('SELECT * FROM subscription_plans WHERE id=$1',[Number(m[2])]);
        const p=r.rows[0]; if(!p)return;
        return customerPlan(q.message.chat.id,p,q.from);
      }
      if(d.indexOf('pub_contacttg_')===0 || d.indexOf('pub_contactwa_')===0){
        const via=d.indexOf('pub_contacttg_')===0?'telegram':'whatsapp';
        const m=d.match(/^pub_contact(?:tg|wa)_(bkash|nagad)_(\d+)$/);
        if(!m)return;
        const method=m[1],id=Number(m[2]);
        const r=await pool.query('SELECT * FROM subscription_plans WHERE id=$1',[id]);
        const p=r.rows[0]; if(!p)return;
        const o=await pool.query(
          'INSERT INTO sales_orders(user_id,username,chat_id,message_id,plan_id,plan_title,price_text,contact_method) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
          [q.from.id,q.from.username||null,q.message.chat.id,q.message.message_id,p.id,p.title,p.price_text,(method+' via '+via)]
        ).catch(()=>({rows:[]}));
        const oid=o.rows[0]?.id;
        const methodName=method==='bkash'?'bKash':'Nagad';
        await ownerAlert('🛒 NEW ORDER'+(oid?' #'+oid:'')+'\n\nUser: '+q.from.id+' '+(q.from.username?'@'+q.from.username:'')+'\nPlan: '+p.title+'\nPrice: '+p.price_text+'\nPayment: '+methodName+'\nContact: '+(via==='telegram'?'Telegram':'WhatsApp'));
        const msgText='Mahadi Tools Premium order\nPlan: '+p.title+'\nPrice: '+p.price_text+'\nPayment: '+methodName+(oid?'\nOrder ID: #'+oid:'');
        if(via==='telegram'){
          const tg=(await getSetting('contact_telegram',OWNER_USERNAME)).replace(/^@/,'');
          return bot.sendMessage(q.message.chat.id,
            '✅ '+methodName+' selected'+(oid?' • Order #'+oid:'')+'\n\nকোনো payment number এখানে দেখানো হবে না। Owner-এর সাথে Telegram-এ কথা বলে payment details নিন.',
            {reply_markup:{inline_keyboard:[[{text:'✈️ Message Owner on Telegram',url:'https://t.me/'+tg}]]}}
          );
        }
        const wa=(await getSetting('contact_whatsapp','')).replace(/[^0-9]/g,'');
        if(!wa)return bot.sendMessage(q.message.chat.id,'📱 WhatsApp এখন available নয়। Telegram ব্যবহার করুন।');
        return bot.sendMessage(q.message.chat.id,
          '✅ '+methodName+' selected'+(oid?' • Order #'+oid:'')+'\n\nকোনো payment number এখানে দেখানো হবে না। Owner-এর সাথে WhatsApp-এ কথা বলে payment details নিন.',
          {reply_markup:{inline_keyboard:[[{text:'📱 Message Owner on WhatsApp',url:'https://wa.me/'+wa+'?text='+encodeURIComponent(msgText)}]]}}
        );
      }
      if(d.indexOf('pub_tgplan_')===0){
        const id=Number(d.replace('pub_tgplan_',''));
        const r=await pool.query('SELECT * FROM subscription_plans WHERE id=$1',[id]);
        const p=r.rows[0]; if(!p)return;
        const tg=(await getSetting('contact_telegram',OWNER_USERNAME)).replace(/^@/,'');
        const o=await pool.query(
          'INSERT INTO sales_orders(user_id,username,chat_id,message_id,plan_id,plan_title,price_text,contact_method) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
          [q.from.id,q.from.username||null,q.message.chat.id,q.message.message_id,p.id,p.title,p.price_text,'telegram']
        ).catch(()=>({rows:[]}));
        const oid=o.rows[0]?.id;
        await ownerAlert('🛒 NEW ORDER'+(oid?' #'+oid:'')+'\n\nUser: '+q.from.id+' '+(q.from.username?'@'+q.from.username:'')+'\nPlan: '+p.title+'\nPrice: '+p.price_text+'\nContact: Telegram');
        return bot.sendMessage(q.message.chat.id,'✅ Order'+(oid?' #'+oid:'')+' তৈরি হয়েছে।\n'+(oid?'Payment screenshot দিতে: /proof '+oid+'\n':'')+'নিচের button দিয়ে Telegram inbox খুলুন।',{reply_markup:{inline_keyboard:[[{text:'✈️ Open Telegram Inbox',url:'https://t.me/'+tg}]]}});
      }
      if(d.indexOf('pub_waplan_')===0){
        const id=Number(d.replace('pub_waplan_',''));
        const r=await pool.query('SELECT * FROM subscription_plans WHERE id=$1',[id]);
        const p=r.rows[0]; if(!p)return;
        const wa=(await getSetting('contact_whatsapp','')).replace(/[^0-9]/g,'');
        if(!wa)return bot.sendMessage(q.message.chat.id,'📱 WhatsApp number এখনো set করা হয়নি। Telegram ব্যবহার করুন।');
        const o=await pool.query(
          'INSERT INTO sales_orders(user_id,username,chat_id,message_id,plan_id,plan_title,price_text,contact_method) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
          [q.from.id,q.from.username||null,q.message.chat.id,q.message.message_id,p.id,p.title,p.price_text,'whatsapp']
        ).catch(()=>({rows:[]}));
        const oid=o.rows[0]?.id;
        await ownerAlert('🛒 NEW ORDER'+(oid?' #'+oid:'')+'\n\nUser: '+q.from.id+' '+(q.from.username?'@'+q.from.username:'')+'\nPlan: '+p.title+'\nPrice: '+p.price_text+'\nContact: WhatsApp');
        const text=encodeURIComponent('Mahadi Tools Premium order\nPlan: '+p.title+'\nPrice: '+p.price_text+(oid?'\nOrder ID: #'+oid:''));
        return bot.sendMessage(q.message.chat.id,'✅ Order'+(oid?' #'+oid:'')+' তৈরি হয়েছে।\n'+(oid?'Payment screenshot দিতে: /proof '+oid+'\n':'')+'নিচের button দিয়ে WhatsApp খুলুন।',{reply_markup:{inline_keyboard:[[{text:'📱 Open WhatsApp',url:'https://wa.me/'+wa+'?text='+text}]]}});
      }
      if(d==='pub_payment'){
        return bot.sendMessage(q.message.chat.id,'💳 Payment number bot-এ দেখানো হয় না।\n\nPlan আবার select করে 💗 bKash অথবা 🟠 Nagad চাপুন, তারপর WhatsApp/Telegram দিয়ে Owner-কে message দিন.');
      }
      return;
    }
    if(d.indexOf('grp_')!==0)return;if(!isOwnerUser(q.from))return;await saveOwner(q.from);await bot.answerCallbackQuery(q.id).catch(function(){});const chatId=q.message.chat.id;
    const map={grp_link:'group_link_filter',grp_flood:'group_flood_guard',grp_welcome:'group_welcome',grp_support:'group_support',grp_lockdown:'group_lockdown'};
    if(map[d]){const cur=await getSetting(map[d],'false');await setSetting(map[d],cur==='true'?'false':'true');return settingsPanel(chatId);}
    if(d==='grp_security')return settingsPanel(chatId);
    if(d==='grp_nsfw')return bot.sendMessage(chatId,process.env.NSFW_API_URL?'🔞 AI Media Guard connected.':'🔞 18+ media pipeline ready, কিন্তু real AI scan চালাতে moderation API key/endpoint লাগবে।');
    if(d==='grp_plans')return plansAdmin(chatId);
    if(d==='grp_planpreview')return plans(chatId);
    if(d.indexOf('grp_planedit_')===0){
      const id=Number(d.replace('grp_planedit_',''));
      const r=await pool.query('SELECT * FROM subscription_plans WHERE id=$1',[id]);
      const p=r.rows[0]; if(!p)return;
      ownerSessions.set(q.from.id,{mode:'edit_plan',planId:id});
      return bot.sendMessage(chatId,'✏️ Plan edit করুন এই format-এ:\n\nName | Price | Details\n\nCurrent:\n'+p.title+' | '+p.price_text+' | '+(p.details||''));
    }
    if(d==='grp_setwa'){
      ownerSessions.set(q.from.id,{mode:'set_whatsapp'});
      return bot.sendMessage(chatId,'📱 WhatsApp number country code সহ দিন।\nExample: 968XXXXXXXX\n\nবন্ধ করতে: off');
    }
    if(d==='grp_settg'){
      ownerSessions.set(q.from.id,{mode:'set_telegram'});
      return bot.sendMessage(chatId,'✈️ Telegram username দিন।\nExample: @Mahadihasanrony11');
    }
    if(d==='grp_analytics')return bot.sendMessage(chatId,await analytics());
    if(d==='grp_tickets'){const r=await pool.query("SELECT id,user_id,username FROM support_tickets WHERE status='open' ORDER BY id DESC LIMIT 10");if(!r.rows.length)return bot.sendMessage(chatId,'🎫 কোনো open ticket নেই।');return bot.sendMessage(chatId,'🎫 OPEN TICKETS',{reply_markup:{inline_keyboard:r.rows.map(function(x){return [{text:'#'+x.id+' • '+(x.username?'@'+x.username:x.user_id),callback_data:'grp_view_'+x.id}];})}});}
    if(d.indexOf('grp_view_')===0){const id=Number(d.replace('grp_view_',''));const r=await pool.query('SELECT * FROM support_tickets WHERE id=$1',[id]);const t=r.rows[0];if(t)return bot.sendMessage(chatId,'🎫 Ticket #'+t.id+'\nUser: '+t.user_id+' '+(t.username?'@'+t.username:'')+'\n\n'+t.text,{reply_markup:{inline_keyboard:[[{text:'💬 Reply',callback_data:'grp_reply_'+id},{text:'✅ Close',callback_data:'grp_close_'+id}]]}});}
    if(d.indexOf('grp_reply_')===0){const id=Number(d.replace('grp_reply_',''));ownerSessions.set(q.from.id,{ticketId:id});return bot.sendMessage(chatId,'💬 Ticket #'+id+' reply লিখুন।');}
    if(d.indexOf('grp_close_')===0){const id=Number(d.replace('grp_close_',''));await pool.query("UPDATE support_tickets SET status='closed',closed_at=NOW() WHERE id=$1",[id]);return bot.sendMessage(chatId,'✅ Ticket #'+id+' closed.');}
  });

  bot.on('message',async function(msg){
    if(msg.from){await saveOwner(msg.from).catch(function(){});await trackUser(msg.from,{chatId:msg.chat&&msg.chat.id,chatType:msg.chat&&msg.chat.type}).catch(function(){});}
    if(msg.from&&isOwnerUser(msg.from)&&msg.chat.type==='private'&&ownerSessions.has(msg.from.id)&&msg.text&&!msg.text.startsWith('/')){
      const s=ownerSessions.get(msg.from.id);
      if(s.mode==='edit_plan'){
        const p=msg.text.split('|').map(function(x){return x.trim();});
        if(p.length<3)return bot.sendMessage(msg.chat.id,'Format ঠিক দিন: Name | Price | Details');
        await pool.query('UPDATE subscription_plans SET title=$2,price_text=$3,details=$4 WHERE id=$1',[s.planId,p[0],p[1],p.slice(2).join(' | ')]);
        ownerSessions.delete(msg.from.id);
        return bot.sendMessage(msg.chat.id,'✅ Plan updated.');
      }
      if(s.mode==='set_whatsapp'){
        const raw=msg.text.trim();
        await setSetting('contact_whatsapp',raw.toLowerCase()==='off'?'':raw.replace(/[^0-9]/g,''));
        ownerSessions.delete(msg.from.id);
        return bot.sendMessage(msg.chat.id,'✅ WhatsApp contact updated.');
      }
      if(s.mode==='set_telegram'){
        const user=msg.text.trim().replace(/^@/,'');
        await setSetting('contact_telegram',user);
        ownerSessions.delete(msg.from.id);
        return bot.sendMessage(msg.chat.id,'✅ Telegram contact updated: @'+user);
      }
      ownerSessions.delete(msg.from.id);
      const r=await pool.query('SELECT * FROM support_tickets WHERE id=$1',[s.ticketId]);const t=r.rows[0];if(!t)return;
      await pool.query('UPDATE support_tickets SET owner_reply=$2 WHERE id=$1',[t.id,msg.text]);try{await bot.sendMessage(Number(t.chat_id),'💬 Owner reply for Ticket #'+t.id+'\n\n'+msg.text,{reply_to_message_id:t.message_id||undefined});}catch{}return bot.sendMessage(msg.chat.id,'✅ Reply sent.');
    }
    if(!msg.chat|| (msg.chat.type!=='group'&&msg.chat.type!=='supergroup') || !(await isBound(msg.chat.id)))return;
    if(msg.new_chat_members&&msg.new_chat_members.length&&await getSetting('group_welcome','true')==='true'){for(const u of msg.new_chat_members){if(!u.is_bot)await bot.sendMessage(msg.chat.id,'👋 স্বাগতম '+(u.username?'@'+u.username:(u.first_name||''))+'!\n/plans দিয়ে Premium plan দেখতে পারেন।').catch(function(){});}}
    if(!msg.from||msg.from.is_bot||isOwnerUser(msg.from))return;const admin=await isAdmin(msg.chat.id,msg.from.id);
    if(!admin&&await getSetting('group_lockdown','false')==='true')return remove(msg,'lockdown','Group lockdown active');
    if(!admin&&await getSetting('group_flood_guard','true')==='true'){const key=msg.chat.id+':'+msg.from.id;const now=Date.now();const a=(flood.get(key)||[]).filter(function(t){return now-t<8000;});a.push(now);flood.set(key,a);if(a.length>6)return remove(msg,'flood','Too many messages');}
    const text=[msg.text,msg.caption].filter(Boolean).join(' ');
    if(!admin&&await getSetting('group_link_filter','true')==='true'&&externalLink(text))return remove(msg,'link_delete','External link blocked');
    if(!admin&&badWord(text,await getSetting('bad_words','')))return remove(msg,'badword_delete','Blocked word');
    if(!admin&&(msg.photo&&msg.photo.length||msg.video||msg.animation)){const r=await scan(msg);if(r&&r.unsafe)return remove(msg,'nsfw_delete','AI media guard');}
    return support(msg);
  });

  init().catch(function(e){console.error('Group module init error:',e);});
};