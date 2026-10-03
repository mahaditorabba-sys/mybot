module.exports = function setupAdvancedFeatures(ctx) {
  const { bot, pool, isOwnerUser, getSetting, setSetting } = ctx;
  const sessions = new Map();

  async function groupId() {
    const v=await getSetting('primary_group_id','');
    return v ? Number(v) : null;
  }

  async function resolveUser(query) {
    const q=String(query||'').trim();
    if(/^\d+$/.test(q)){
      const r=await pool.query("SELECT telegram_id FROM tracked_users WHERE telegram_id=$1",[Number(q)]);
      return r.rows[0]?.telegram_id || null;
    }
    const username=q.replace(/^@/,'').toLowerCase();
    if(!username) return null;
    const r=await pool.query(
      "SELECT telegram_id FROM tracked_users WHERE lower(current_username)=$1 OR lower(first_username)=$1 ORDER BY last_seen DESC LIMIT 1",
      [username]
    );
    return r.rows[0]?.telegram_id || null;
  }

  async function memberState(userId) {
    const gid=await groupId();
    if(!gid) return 'Group not connected';
    try {
      const m=await bot.getChatMember(gid,userId);
      return String(m.status||'unknown').toUpperCase();
    } catch { return 'Not found / unavailable'; }
  }

  async function userControl(chatId,userId) {
    const u=await pool.query("SELECT * FROM tracked_users WHERE telegram_id=$1",[userId]);
    const row=u.rows[0];
    if(!row) return bot.sendMessage(chatId,'User পাওয়া যায়নি।');
    const [mods,state]=await Promise.all([
      pool.query("SELECT COUNT(*)::int n FROM moderation_events WHERE user_id=$1",[userId]).catch(()=>({rows:[{n:0}]})),
      memberState(userId)
    ]);
    return bot.sendMessage(chatId,
      '👮 QUICK USER CONTROL\n\n'+
      'ID: '+row.telegram_id+'\n'+
      'Username: '+(row.current_username?'@'+row.current_username:'None')+'\n'+
      'Name: '+[row.first_name,row.last_name].filter(Boolean).join(' ')+'\n'+
      'Group Status: '+state+'\n'+
      'Moderation Events: '+mods.rows[0].n,
      {reply_markup:{inline_keyboard:[
        [{text:'⚠️ Warn',callback_data:'adv_warn_'+userId},{text:'🔇 10m',callback_data:'adv_mute10m_'+userId},{text:'🔇 30m',callback_data:'adv_mute30m_'+userId}],
        [{text:'🔇 1h',callback_data:'adv_mute1h_'+userId},{text:'🔇 1d',callback_data:'adv_mute1d_'+userId},{text:'🔇 7d',callback_data:'adv_mute7d_'+userId}],
        [{text:'⏱ Custom Mute',callback_data:'adv_custommute_'+userId}],
        [{text:'⛔ Ban',callback_data:'adv_ban_'+userId},{text:'✅ Unban',callback_data:'adv_unban_'+userId}],
        [{text:'🔄 Refresh User',callback_data:'adv_user_'+userId},{text:'⬅️ Dashboard',callback_data:'dash_home'}]
      ]}}
    );
  }

  async function warnUser(userId) {
    const gid=await groupId();
    if(!gid) return 'আগে Group bind করতে হবে।';
    await pool.query(
      "INSERT INTO moderation_events(chat_id,user_id,action,reason) VALUES($1,$2,'warn','Owner warning')",
      [gid,userId]
    ).catch(()=>{});
    try { await bot.sendMessage(gid,'⚠️ Warning for user ID '+userId+'. Group rules follow করুন।'); } catch {}
    return '⚠️ Warning saved.';
  }

  async function muteUser(userId,seconds,label) {
    const gid=await groupId();
    if(!gid) return 'আগে Group bind করতে হবে।';
    const until=Math.floor(Date.now()/1000)+seconds;
    try {
      await bot.restrictChatMember(gid,userId,{
        permissions:{
          can_send_messages:false,
          can_send_audios:false,
          can_send_documents:false,
          can_send_photos:false,
          can_send_videos:false,
          can_send_video_notes:false,
          can_send_voice_notes:false,
          can_send_polls:false,
          can_send_other_messages:false,
          can_add_web_page_previews:false,
          can_change_info:false,
          can_invite_users:false,
          can_pin_messages:false,
          can_manage_topics:false
        },
        until_date:until
      });
      await pool.query(
        "INSERT INTO moderation_events(chat_id,user_id,action,reason) VALUES($1,$2,'mute',$3)",
        [gid,userId,'Owner mute '+label]
      ).catch(()=>{});
      return '🔇 User muted for '+label+'.';
    } catch {
      return 'Mute হয়নি। Bot-এর Restrict Members permission check করুন।';
    }
  }

  async function banUser(userId) {
    const gid=await groupId();
    if(!gid) return 'আগে Group bind করতে হবে।';
    try {
      await bot.banChatMember(gid,userId);
      await pool.query("INSERT INTO moderation_events(chat_id,user_id,action,reason) VALUES($1,$2,'ban','Owner action')",[gid,userId]).catch(()=>{});
      return '⛔ User banned.';
    } catch { return 'Ban হয়নি। Bot-এর Ban Users permission check করুন।'; }
  }

  async function unbanUser(userId) {
    const gid=await groupId();
    if(!gid) return 'আগে Group bind করতে হবে।';
    try {
      await bot.unbanChatMember(gid,userId,{only_if_banned:true});
      await pool.query("INSERT INTO moderation_events(chat_id,user_id,action,reason) VALUES($1,$2,'unban','Owner action')",[gid,userId]).catch(()=>{});
      return '✅ User unbanned.';
    } catch { return 'Unban হয়নি।'; }
  }

  function parseDuration(text) {
    const m=String(text||'').trim().toLowerCase().match(/^(\d+)\s*(m|h|d)$/);
    if(!m) return null;
    const n=Number(m[1]);
    if(!Number.isFinite(n)||n<1) return null;
    const mult=m[2]==='m'?60:m[2]==='h'?3600:86400;
    const sec=n*mult;
    if(sec>366*86400) return null;
    return {seconds:sec,label:n+m[2]};
  }

  async function salesReport(chatId) {
    const r=await pool.query(
      "SELECT "+
      "COUNT(*)::int total,"+
      "COUNT(*) FILTER (WHERE (created_at AT TIME ZONE 'Asia/Muscat')::date=(NOW() AT TIME ZONE 'Asia/Muscat')::date)::int today,"+
      "COUNT(*) FILTER (WHERE created_at>=NOW()-INTERVAL '7 days')::int d7,"+
      "COUNT(*) FILTER (WHERE created_at>=NOW()-INTERVAL '30 days')::int d30,"+
      "COUNT(*) FILTER (WHERE status='pending')::int pending,"+
      "COUNT(*) FILTER (WHERE status='paid')::int paid,"+
      "COUNT(*) FILTER (WHERE status='activated')::int activated,"+
      "COALESCE(SUM(CASE WHEN status='activated' THEN COALESCE(NULLIF(regexp_replace(price_text,'[^0-9.]','','g'),''),'0')::numeric ELSE 0 END),0) revenue,"+
      "COALESCE(SUM(CASE WHEN status='activated' AND created_at>=NOW()-INTERVAL '30 days' THEN COALESCE(NULLIF(regexp_replace(price_text,'[^0-9.]','','g'),''),'0')::numeric ELSE 0 END),0) revenue30 "+
      "FROM sales_orders"
    ).catch(()=>({rows:[{}]}));
    const x=r.rows[0]||{};
    return bot.sendMessage(chatId,
      '💰 SALES REPORT\n\n'+
      '🛒 Total Orders: '+Number(x.total||0)+'\n'+
      '☀️ Today: '+Number(x.today||0)+'\n'+
      '📅 Last 7 Days: '+Number(x.d7||0)+'\n'+
      '🗓 Last 30 Days: '+Number(x.d30||0)+'\n\n'+
      '⏳ Pending: '+Number(x.pending||0)+'\n'+
      '💳 Paid: '+Number(x.paid||0)+'\n'+
      '✅ Activated: '+Number(x.activated||0)+'\n\n'+
      '💵 Activated Revenue: '+Number(x.revenue||0)+'৳\n'+
      '📈 Last 30 Days Revenue: '+Number(x.revenue30||0)+'৳',
      {reply_markup:{inline_keyboard:[
        [{text:'🔄 Refresh',callback_data:'adv_sales'}],
        [{text:'⬅️ Owner Dashboard',callback_data:'dash_home'}]
      ]}}
    );
  }

  function remain(expiresAt) {
    const ms=new Date(expiresAt).getTime()-Date.now();
    if(ms<=0) return 'expired';
    const d=Math.floor(ms/86400000);
    const h=Math.floor((ms%86400000)/3600000);
    return d>0?d+'d '+h+'h':h+'h';
  }

  async function expiryCenter(chatId) {
    const [soon,expired] = await Promise.all([
      pool.query(
        "SELECT s.id,s.user_id,s.username,s.plan_title,s.expires_at,t.current_username "+
        "FROM subscriptions s LEFT JOIN tracked_users t ON t.telegram_id=s.user_id "+
        "WHERE s.status='active' AND s.expires_at>NOW() AND s.expires_at<=NOW()+INTERVAL '7 days' "+
        "ORDER BY s.expires_at LIMIT 15"
      ).catch(()=>({rows:[]})),
      pool.query("SELECT COUNT(*)::int n FROM subscriptions WHERE status='expired' OR expires_at<=NOW()").catch(()=>({rows:[{n:0}]}))
    ]);
    if(!soon.rows.length){
      return bot.sendMessage(chatId,'⏳ EXPIRY CENTER\n\nআগামী 7 দিনের মধ্যে কোনো active subscription expire হচ্ছে না।\nExpired records: '+expired.rows[0].n,{
        reply_markup:{inline_keyboard:[[{text:'⬅️ Owner Dashboard',callback_data:'dash_home'}]]}
      });
    }
    const info=soon.rows.map(x=>'• '+(x.current_username?'@'+x.current_username:x.user_id)+' — '+(x.plan_title||'Premium')+' — '+remain(x.expires_at)).join('\n');
    const rows=soon.rows.slice(0,10).map(x=>[{text:'👤 '+(x.current_username?'@'+x.current_username:x.user_id),callback_data:'adv_user_'+x.user_id}]);
    rows.push([{text:'🔄 Refresh',callback_data:'adv_expiry'},{text:'⬅️ Dashboard',callback_data:'dash_home'}]);
    return bot.sendMessage(chatId,'⏳ EXPIRY CENTER — NEXT 7 DAYS\n\n'+info+'\n\nExpired records: '+expired.rows[0].n,{reply_markup:{inline_keyboard:rows}});
  }

  bot.onText(/^\/usercontrol(?:@\w+)?$/,async msg=>{
    if(!isOwnerUser(msg.from)) return;
    sessions.set(msg.from.id,{mode:'user_search'});
    return bot.sendMessage(msg.chat.id,'👮 User ID অথবা @username লিখুন।');
  });
  bot.onText(/^\/salesreport(?:@\w+)?$/,async msg=>{if(isOwnerUser(msg.from))return salesReport(msg.chat.id);});
  bot.onText(/^\/expiry(?:@\w+)?$/,async msg=>{if(isOwnerUser(msg.from))return expiryCenter(msg.chat.id);});

  bot.on('callback_query',async q=>{
    const d=q.data||'';
    if(!d.startsWith('adv_')) return;
    if(!isOwnerUser(q.from)) return bot.answerCallbackQuery(q.id,{text:'Owner only',show_alert:true}).catch(()=>{});
    await bot.answerCallbackQuery(q.id).catch(()=>{});
    if(!q.message) return;
    const chatId=q.message.chat.id;

    if(d==='adv_user_search'){
      sessions.set(q.from.id,{mode:'user_search'});
      return bot.sendMessage(chatId,'👮 QUICK USER CONTROL\n\nTelegram User ID অথবা @username লিখুন।');
    }
    if(d==='adv_sales') return salesReport(chatId);
    if(d==='adv_expiry') return expiryCenter(chatId);
    if(d==='adv_forcejoin'){
      const cur=await getSetting('force_join_channel','true');
      const next=cur==='true'?'false':'true';
      await setSetting('force_join_channel',next);
      return bot.sendMessage(chatId,'🔐 Force Join এখন '+(next==='true'?'ON ✅':'OFF ❌'),{
        reply_markup:{inline_keyboard:[[{text:'⬅️ Owner Dashboard',callback_data:'dash_home'}]]}
      });
    }
    if(d.startsWith('adv_user_')){
      const id=Number(d.replace('adv_user_',''));
      if(Number.isFinite(id)) return userControl(chatId,id);
    }
    if(d.startsWith('adv_warn_')){
      const id=Number(d.replace('adv_warn_',''));
      return bot.sendMessage(chatId,await warnUser(id));
    }
    const mute=d.match(/^adv_mute(10m|30m|1h|1d|7d)_(\d+)$/);
    if(mute){
      const mult={m:60,h:3600,d:86400};
      const unit=mute[1].slice(-1),n=Number(mute[1].slice(0,-1));
      return bot.sendMessage(chatId,await muteUser(Number(mute[2]),n*mult[unit],mute[1]));
    }
    if(d.startsWith('adv_custommute_')){
      const id=Number(d.replace('adv_custommute_',''));
      sessions.set(q.from.id,{mode:'custom_mute',userId:id});
      return bot.sendMessage(chatId,'⏱ Custom mute time লিখুন।\nExample: 15m / 2h / 3d');
    }
    if(d.startsWith('adv_ban_')){
      const id=Number(d.replace('adv_ban_',''));
      return bot.sendMessage(chatId,await banUser(id));
    }
    if(d.startsWith('adv_unban_')){
      const id=Number(d.replace('adv_unban_',''));
      return bot.sendMessage(chatId,await unbanUser(id));
    }
  });

  bot.on('message',async msg=>{
    if(!msg.from || !isOwnerUser(msg.from) || msg.chat.type!=='private') return;
    const s=sessions.get(msg.from.id);
    if(!s || !msg.text || msg.text.startsWith('/')) return;

    if(s.mode==='user_search'){
      const id=await resolveUser(msg.text);
      if(!id) return bot.sendMessage(msg.chat.id,'User পাওয়া যায়নি। আবার ID/@username দিন।');
      sessions.delete(msg.from.id);
      return userControl(msg.chat.id,id);
    }
    if(s.mode==='custom_mute'){
      const d=parseDuration(msg.text);
      if(!d) return bot.sendMessage(msg.chat.id,'সময় ঠিক বুঝিনি। Example: 15m / 2h / 3d (সর্বোচ্চ 366d)');
      sessions.delete(msg.from.id);
      return bot.sendMessage(msg.chat.id,await muteUser(s.userId,d.seconds,d.label));
    }
  });
};