module.exports = function setupAdminPlus(ctx) {
  const { bot, pool, isOwnerUser, getSetting, setSetting, trackUser } = ctx;
  const ownerSessions = new Map();
  const userSessions = new Map();

  async function init() {
    await pool.query(
      "CREATE TABLE IF NOT EXISTS payment_proofs (" +
      "id SERIAL PRIMARY KEY, order_id INTEGER NOT NULL, user_id BIGINT NOT NULL, username TEXT, chat_id BIGINT NOT NULL, " +
      "file_id TEXT NOT NULL, file_type TEXT NOT NULL, status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW(), reviewed_at TIMESTAMPTZ);" +
      "CREATE TABLE IF NOT EXISTS subscriptions (" +
      "id SERIAL PRIMARY KEY, order_id INTEGER UNIQUE, user_id BIGINT NOT NULL, username TEXT, plan_title TEXT, " +
      "starts_at TIMESTAMPTZ DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL, status TEXT DEFAULT 'active', " +
      "reminded_3d BOOLEAN DEFAULT FALSE, reminded_1d BOOLEAN DEFAULT FALSE, expired_notice BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT NOW());" +
      "CREATE TABLE IF NOT EXISTS faqs (" +
      "id SERIAL PRIMARY KEY, question TEXT UNIQUE NOT NULL, answer TEXT NOT NULL, enabled BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());" +
      "CREATE TABLE IF NOT EXISTS admin_notes (" +
      "id SERIAL PRIMARY KEY, user_id BIGINT NOT NULL, note TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW());"
    );
    console.log('Admin Plus module ready');
  }

  async function saveOwner(user) {
    if (user && isOwnerUser(user)) await setSetting('owner_id', String(user.id));
  }

  async function ownerId() {
    const v = await getSetting('owner_id','');
    return v ? Number(v) : null;
  }

  async function ownerAlert(text, options) {
    const id = await ownerId();
    if (!id) return;
    try { await bot.sendMessage(id, text, options || {}); } catch {}
  }

  function planDays(title) {
    const t = String(title || '').toLowerCase();
    if (t.includes('15 day')) return 15;
    if (t.includes('2 month')) return 60;
    if (t.includes('1 month') || t.includes('30 day')) return 30;
    if (t.includes('1 year') || t.includes('12 month')) return 365;
    const m = t.match(/(\d+)\s*day/);
    if (m) return Number(m[1]);
    return 30;
  }

  async function ensureSubscriptionsFromOrders() {
    const r = await pool.query(
      "SELECT id,user_id,username,plan_title FROM sales_orders WHERE status='activated' ORDER BY id"
    ).catch(() => ({rows:[]}));
    for (const o of r.rows) {
      const days = planDays(o.plan_title);
      await pool.query(
        "INSERT INTO subscriptions(order_id,user_id,username,plan_title,expires_at) " +
        "VALUES($1,$2,$3,$4,NOW()+($5||' days')::interval) ON CONFLICT(order_id) DO NOTHING",
        [o.id,o.user_id,o.username,o.plan_title,String(days)]
      ).catch(()=>{});
    }
  }

  async function adminMenu(chatId) {
    await ensureSubscriptionsFromOrders();
    const a = await Promise.all([
      pool.query("SELECT COUNT(*)::int n FROM payment_proofs WHERE status='pending'"),
      pool.query("SELECT COUNT(*)::int n FROM subscriptions WHERE status='active' AND expires_at>NOW()"),
      pool.query("SELECT COUNT(*)::int n FROM faqs WHERE enabled=TRUE")
    ]);
    return bot.sendMessage(chatId,
      '🧰 PREMIUM ADMIN PACK\n\n' +
      '📸 Pending Payment Proofs: '+a[0].rows[0].n+'\n' +
      '⏳ Active Subscriptions: '+a[1].rows[0].n+'\n' +
      '❓ FAQs: '+a[2].rows[0].n,
      {reply_markup:{inline_keyboard:[
        [{text:'📸 Payment Proofs',callback_data:'plus_proofs'},{text:'⏳ Subscriptions',callback_data:'plus_subs'}],
        [{text:'🔎 User Search',callback_data:'plus_usersearch'},{text:'🛡 Moderation',callback_data:'plus_moderation'}],
        [{text:'❓ FAQ Manager',callback_data:'plus_faqs'},{text:'💾 Backup / Restore',callback_data:'plus_backup'}],
        [{text:'⬅️ Main Panel',callback_data:'main_panel'}]
      ]}}
    );
  }

  async function showProofs(chatId) {
    const r = await pool.query(
      "SELECT id,order_id,username,user_id,status FROM payment_proofs ORDER BY id DESC LIMIT 12"
    );
    if (!r.rows.length) return bot.sendMessage(chatId,'📸 কোনো payment proof নেই।');
    return bot.sendMessage(chatId,'📸 PAYMENT PROOFS',{
      reply_markup:{inline_keyboard:r.rows.map(x=>[{
        text:'#'+x.id+' • Order #'+x.order_id+' • '+String(x.status).toUpperCase(),
        callback_data:'plus_proof_'+x.id
      }]).concat([[{text:'⬅️ Admin Pack',callback_data:'plus_menu'}]])}
    });
  }

  async function showSubscriptions(chatId) {
    await ensureSubscriptionsFromOrders();
    const r = await pool.query(
      "SELECT id,user_id,username,plan_title,expires_at,status FROM subscriptions ORDER BY id DESC LIMIT 12"
    );
    if (!r.rows.length) return bot.sendMessage(chatId,'⏳ কোনো subscription নেই।');
    const rows = r.rows.map(x => [{
      text:'#'+x.id+' • '+(x.username?'@'+x.username:x.user_id)+' • '+String(x.status).toUpperCase(),
      callback_data:'plus_sub_'+x.id
    }]);
    rows.push([{text:'➕ Manual Subscription',callback_data:'plus_sub_add'}]);
    rows.push([{text:'⬅️ Admin Pack',callback_data:'plus_menu'}]);
    return bot.sendMessage(chatId,'⏳ SUBSCRIPTIONS',{reply_markup:{inline_keyboard:rows}});
  }

  async function showFaqs(chatId) {
    const r = await pool.query("SELECT id,question,enabled FROM faqs ORDER BY id DESC LIMIT 15");
    const rows = r.rows.map(x=>[{
      text:(x.enabled?'✅ ':'⏸ ')+x.question.slice(0,42),
      callback_data:'plus_faq_'+x.id
    }]);
    rows.push([{text:'➕ Add FAQ',callback_data:'plus_faq_add'}]);
    rows.push([{text:'⬅️ Admin Pack',callback_data:'plus_menu'}]);
    return bot.sendMessage(chatId,'❓ FAQ MANAGER\n\nQuestion চাপলে Edit/Delete করতে পারবেন।',{reply_markup:{inline_keyboard:rows}});
  }

  async function userProfile(chatId, userId) {
    const u = await pool.query("SELECT * FROM tracked_users WHERE telegram_id=$1",[userId]);
    const row=u.rows[0];
    if (!row) return bot.sendMessage(chatId,'User পাওয়া যায়নি।');
    const [orders,tickets,mods,sub,notes] = await Promise.all([
      pool.query("SELECT COUNT(*)::int n FROM sales_orders WHERE user_id=$1",[userId]).catch(()=>({rows:[{n:0}]})),
      pool.query("SELECT COUNT(*)::int n FROM support_tickets WHERE user_id=$1",[userId]).catch(()=>({rows:[{n:0}]})),
      pool.query("SELECT COUNT(*)::int n FROM moderation_events WHERE user_id=$1",[userId]).catch(()=>({rows:[{n:0}]})),
      pool.query("SELECT plan_title,expires_at,status FROM subscriptions WHERE user_id=$1 ORDER BY id DESC LIMIT 1",[userId]).catch(()=>({rows:[]})),
      pool.query("SELECT note FROM admin_notes WHERE user_id=$1 ORDER BY id DESC LIMIT 3",[userId]).catch(()=>({rows:[]}))
    ]);
    const s=sub.rows[0];
    return bot.sendMessage(chatId,
      '🔎 USER PROFILE\n\n' +
      'ID: '+row.telegram_id+'\n' +
      'Username: '+(row.current_username?'@'+row.current_username:'None')+'\n' +
      'First username: '+(row.first_username?'@'+row.first_username:'None')+'\n' +
      'Name: '+[row.first_name,row.last_name].filter(Boolean).join(' ')+'\n' +
      'Orders: '+orders.rows[0].n+' | Tickets: '+tickets.rows[0].n+'\n' +
      'Moderation Events: '+mods.rows[0].n+'\n' +
      'Subscription: '+(s?(s.plan_title+' • '+String(s.status).toUpperCase()+' • '+new Date(s.expires_at).toLocaleString('en-GB',{timeZone:'Asia/Muscat'})):'None')+'\n' +
      (notes.rows.length?'Notes: '+notes.rows.map(x=>x.note).join(' | '):''),
      {reply_markup:{inline_keyboard:[
        [{text:'⚠️ Warn',callback_data:'plus_warn_'+userId},{text:'🔇 Mute 1h',callback_data:'plus_mute1h_'+userId}],
        [{text:'🔇 Mute 1d',callback_data:'plus_mute1d_'+userId},{text:'⛔ Ban',callback_data:'plus_ban_'+userId}],
        [{text:'✅ Unban',callback_data:'plus_unban_'+userId},{text:'📝 Add Note',callback_data:'plus_note_'+userId}],
        [{text:'⬅️ Admin Pack',callback_data:'plus_menu'}]
      ]}}
    );
  }

  async function resolveUser(query) {
    const q=String(query||'').trim();
    if (/^\d+$/.test(q)) {
      const r=await pool.query("SELECT telegram_id FROM tracked_users WHERE telegram_id=$1",[Number(q)]);
      return r.rows[0]?.telegram_id || null;
    }
    const username=q.replace(/^@/,'').toLowerCase();
    const r=await pool.query(
      "SELECT telegram_id FROM tracked_users WHERE lower(current_username)=$1 OR lower(first_username)=$1 ORDER BY last_seen DESC LIMIT 1",
      [username]
    );
    return r.rows[0]?.telegram_id || null;
  }

  async function groupId() {
    const v=await getSetting('primary_group_id','');
    return v ? Number(v) : null;
  }

  async function warnUser(userId) {
    const gid=await groupId();
    if (!gid) return {ok:false,msg:'আগে Group bind করতে হবে।'};
    await pool.query(
      "INSERT INTO moderation_events(chat_id,user_id,action,reason) VALUES($1,$2,$3,$4)",
      [gid,userId,'warn','Owner warning']
    ).catch(()=>{});
    try { await bot.sendMessage(gid,'⚠️ Warning for user ID '+userId+'. Group rules follow করুন।'); } catch {}
    return {ok:true,msg:'⚠️ Warning saved.'};
  }

  async function muteUser(userId,seconds) {
    const gid=await groupId();
    if (!gid) return {ok:false,msg:'আগে Group bind করতে হবে।'};
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
      await pool.query("INSERT INTO moderation_events(chat_id,user_id,action,reason) VALUES($1,$2,$3,$4)",[gid,userId,'mute','Owner action']).catch(()=>{});
      return {ok:true,msg:'🔇 User muted.'};
    } catch(e) { return {ok:false,msg:'Mute হয়নি। Bot-এর restrict permission check করুন।'}; }
  }

  async function banUser(userId) {
    const gid=await groupId();
    if (!gid) return {ok:false,msg:'আগে Group bind করতে হবে।'};
    try {
      await bot.banChatMember(gid,userId);
      await pool.query("INSERT INTO moderation_events(chat_id,user_id,action,reason) VALUES($1,$2,$3,$4)",[gid,userId,'ban','Owner action']).catch(()=>{});
      return {ok:true,msg:'⛔ User banned.'};
    } catch { return {ok:false,msg:'Ban হয়নি। Bot-এর ban permission check করুন।'}; }
  }

  async function unbanUser(userId) {
    const gid=await groupId();
    if (!gid) return {ok:false,msg:'আগে Group bind করতে হবে।'};
    try {
      await bot.unbanChatMember(gid,userId,{only_if_banned:true});
      await pool.query("INSERT INTO moderation_events(chat_id,user_id,action,reason) VALUES($1,$2,$3,$4)",[gid,userId,'unban','Owner action']).catch(()=>{});
      return {ok:true,msg:'✅ User unbanned.'};
    } catch { return {ok:false,msg:'Unban হয়নি।'}; }
  }

  async function sendConfigBackup(chatId) {
    const data = {};
    const tables = [
      ['settings',"SELECT key,value FROM settings ORDER BY key"],
      ['commands',"SELECT command,response,enabled FROM custom_commands ORDER BY command"],
      ['plans',"SELECT code,title,price_text,details,enabled FROM subscription_plans ORDER BY id"],
      ['replies',"SELECT keyword,response,enabled FROM keyword_replies ORDER BY id"],
      ['faqs',"SELECT question,answer,enabled FROM faqs ORDER BY id"],
      ['subscriptions',"SELECT order_id,user_id,username,plan_title,starts_at,expires_at,status FROM subscriptions ORDER BY id"]
    ];
    for (const [name,sql] of tables) {
      const r=await pool.query(sql).catch(()=>({rows:[]}));
      data[name]=r.rows;
    }
    data.settings=data.settings.filter(x=>!/token|password|secret|api[_-]?key/i.test(x.key));
    data.exported_at=new Date().toISOString();
    data.type='mahadi-tools-admin-backup-v1';
    const buf=Buffer.from(JSON.stringify(data,null,2));
    return bot.sendDocument(chatId,buf,{caption:'💾 Mahadi Tools configuration backup'},{filename:'mahadi-tools-admin-backup.json',contentType:'application/json'});
  }

  async function restoreBackup(fileId) {
    const link=await bot.getFileLink(fileId);
    const res=await fetch(link);
    const text=await res.text();
    const data=JSON.parse(text);
    if (!data || data.type!=='mahadi-tools-admin-backup-v1') throw new Error('Invalid backup file');

    await pool.query('BEGIN');
    try {
      for (const x of (data.settings||[])) {
        if (!x.key || /token|password|secret|api[_-]?key/i.test(x.key)) continue;
        await pool.query(
          "INSERT INTO settings(key,value,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()",
          [x.key,String(x.value??'')]
        );
      }
      for (const x of (data.commands||[])) {
        if (!x.command) continue;
        await pool.query(
          "INSERT INTO custom_commands(command,response,enabled) VALUES($1,$2,$3) ON CONFLICT(command) DO UPDATE SET response=EXCLUDED.response,enabled=EXCLUDED.enabled",
          [x.command,String(x.response||''),x.enabled!==false]
        );
      }
      for (const x of (data.plans||[])) {
        if (!x.code) continue;
        await pool.query(
          "INSERT INTO subscription_plans(code,title,price_text,details,enabled) VALUES($1,$2,$3,$4,$5) ON CONFLICT(code) DO UPDATE SET title=EXCLUDED.title,price_text=EXCLUDED.price_text,details=EXCLUDED.details,enabled=EXCLUDED.enabled",
          [x.code,String(x.title||''),String(x.price_text||''),String(x.details||''),x.enabled!==false]
        );
      }
      for (const x of (data.replies||[])) {
        if (!x.keyword) continue;
        await pool.query(
          "INSERT INTO keyword_replies(keyword,response,enabled) VALUES($1,$2,$3) ON CONFLICT(keyword) DO UPDATE SET response=EXCLUDED.response,enabled=EXCLUDED.enabled",
          [String(x.keyword).toLowerCase(),String(x.response||''),x.enabled!==false]
        );
      }
      for (const x of (data.faqs||[])) {
        if (!x.question) continue;
        await pool.query(
          "INSERT INTO faqs(question,answer,enabled) VALUES($1,$2,$3) ON CONFLICT(question) DO UPDATE SET answer=EXCLUDED.answer,enabled=EXCLUDED.enabled,updated_at=NOW()",
          [String(x.question),String(x.answer||''),x.enabled!==false]
        );
      }
      await pool.query('COMMIT');
    } catch(e) {
      await pool.query('ROLLBACK');
      throw e;
    }
  }

  bot.onText(/^\/adminpack(?:@\w+)?$/, async msg=>{
    if(!isOwnerUser(msg.from)) return;
    await saveOwner(msg.from);
    return adminMenu(msg.chat.id);
  });

  bot.onText(/^\/proof(?:@\w+)?\s+(\d+)$/, async (msg,match)=>{
    const orderId=Number(match[1]);
    const r=await pool.query("SELECT * FROM sales_orders WHERE id=$1 AND user_id=$2",[orderId,msg.from.id]).catch(()=>({rows:[]}));
    if(!r.rows[0]) return bot.sendMessage(msg.chat.id,'Order পাওয়া যায়নি অথবা এটা আপনার order নয়।');
    userSessions.set(msg.from.id,{mode:'payment_proof',orderId:orderId});
    return bot.sendMessage(msg.chat.id,'📸 এখন payment screenshot/photo পাঠান। Document হিসেবেও পাঠাতে পারবেন।');
  });

  bot.onText(/^\/usersearch(?:@\w+)?\s+(.+)$/, async (msg,match)=>{
    if(!isOwnerUser(msg.from)) return;
    const id=await resolveUser(match[1]);
    if(!id) return bot.sendMessage(msg.chat.id,'User পাওয়া যায়নি।');
    return userProfile(msg.chat.id,id);
  });

  bot.on('callback_query', async q=>{
    const d=q.data||'';
    if(!d.startsWith('plus_')) return;
    if(!isOwnerUser(q.from)) return;
    await saveOwner(q.from);
    await bot.answerCallbackQuery(q.id).catch(()=>{});
    const chatId=q.message.chat.id;

    if(d==='plus_menu') return adminMenu(chatId);
    if(d==='plus_proofs') return showProofs(chatId);
    if(d==='plus_subs') return showSubscriptions(chatId);
    if(d==='plus_faqs') return showFaqs(chatId);

    if(d==='plus_usersearch' || d==='plus_moderation') {
      ownerSessions.set(q.from.id,{mode:'user_search'});
      return bot.sendMessage(chatId,'🔎 Telegram User ID অথবা @username লিখুন।');
    }

    if(d==='plus_backup') {
      return bot.sendMessage(chatId,'💾 BACKUP / RESTORE',{
        reply_markup:{inline_keyboard:[
          [{text:'📤 Create Backup',callback_data:'plus_backup_create'}],
          [{text:'📥 Restore Backup',callback_data:'plus_restore'}],
          [{text:'⬅️ Admin Pack',callback_data:'plus_menu'}]
        ]}
      });
    }
    if(d==='plus_backup_create') return sendConfigBackup(chatId);
    if(d==='plus_restore') {
      ownerSessions.set(q.from.id,{mode:'restore'});
      return bot.sendMessage(chatId,'📥 আগের Mahadi Tools backup JSON file এখন পাঠান।');
    }

    if(d.startsWith('plus_proof_')) {
      const id=Number(d.replace('plus_proof_',''));
      const r=await pool.query("SELECT * FROM payment_proofs WHERE id=$1",[id]);
      const p=r.rows[0]; if(!p)return;
      const caption='📸 PAYMENT PROOF #'+p.id+'\nOrder #'+p.order_id+'\nUser: '+p.user_id+' '+(p.username?'@'+p.username:'')+'\nStatus: '+String(p.status).toUpperCase();
      const opts={caption:caption,reply_markup:{inline_keyboard:[
        [{text:'✅ Approve',callback_data:'plus_proofapprove_'+id},{text:'❌ Reject',callback_data:'plus_proofreject_'+id}],
        [{text:'⬅️ Proofs',callback_data:'plus_proofs'}]
      ]}};
      try {
        if(p.file_type==='photo') return bot.sendPhoto(chatId,p.file_id,opts);
        return bot.sendDocument(chatId,p.file_id,opts);
      } catch { return bot.sendMessage(chatId,caption); }
    }

    if(d.startsWith('plus_proofapprove_') || d.startsWith('plus_proofreject_')) {
      const approve=d.startsWith('plus_proofapprove_');
      const id=Number(d.replace(approve?'plus_proofapprove_':'plus_proofreject_',''));
      const status=approve?'approved':'rejected';
      const r=await pool.query(
        "UPDATE payment_proofs SET status=$2,reviewed_at=NOW() WHERE id=$1 RETURNING *",
        [id,status]
      );
      const p=r.rows[0]; if(!p)return;
      if(approve) await pool.query("UPDATE sales_orders SET status='paid',updated_at=NOW() WHERE id=$1",[p.order_id]).catch(()=>{});
      try {
        await bot.sendMessage(Number(p.chat_id),
          approve ? '✅ Payment proof approved. Order #'+p.order_id+' এখন PAID.' : '❌ Payment proof rejected. Order #'+p.order_id+'-এর proof আবার পাঠান।'
        );
      } catch {}
      return bot.sendMessage(chatId,'Payment proof #'+id+' → '+status.toUpperCase());
    }

    if(d.startsWith('plus_sub_') && !d.startsWith('plus_sub_add')) {
      const id=Number(d.replace('plus_sub_',''));
      const r=await pool.query("SELECT * FROM subscriptions WHERE id=$1",[id]);
      const s=r.rows[0]; if(!s)return;
      return bot.sendMessage(chatId,
        '⏳ SUBSCRIPTION #'+id+'\n\nUser: '+s.user_id+' '+(s.username?'@'+s.username:'')+'\nPlan: '+(s.plan_title||'-')+'\nStatus: '+String(s.status).toUpperCase()+'\nExpires: '+new Date(s.expires_at).toLocaleString('en-GB',{timeZone:'Asia/Muscat'}),
        {reply_markup:{inline_keyboard:[
          [{text:'➕ 15 Days',callback_data:'plus_extend15_'+id},{text:'➕ 30 Days',callback_data:'plus_extend30_'+id}],
          [{text:'➕ 60 Days',callback_data:'plus_extend60_'+id},{text:'❌ Expire Now',callback_data:'plus_expire_'+id}],
          [{text:'⬅️ Subscriptions',callback_data:'plus_subs'}]
        ]}}
      );
    }

    if(d==='plus_sub_add') {
      ownerSessions.set(q.from.id,{mode:'sub_add'});
      return bot.sendMessage(chatId,'➕ Format: UserID | Days | Plan Name\nExample: 123456789 | 30 | 1 Month Premium');
    }

    if(d.startsWith('plus_extend')) {
      const m=d.match(/^plus_extend(15|30|60)_(\d+)$/);
      if(!m)return;
      const days=Number(m[1]), id=Number(m[2]);
      await pool.query(
        "UPDATE subscriptions SET expires_at=GREATEST(expires_at,NOW())+($2||' days')::interval,status='active',reminded_3d=FALSE,reminded_1d=FALSE,expired_notice=FALSE WHERE id=$1",
        [id,String(days)]
      );
      return bot.sendMessage(chatId,'✅ Subscription #'+id+' +'+days+' days.');
    }

    if(d.startsWith('plus_expire_')) {
      const id=Number(d.replace('plus_expire_',''));
      await pool.query("UPDATE subscriptions SET expires_at=NOW(),status='expired' WHERE id=$1",[id]);
      return bot.sendMessage(chatId,'❌ Subscription #'+id+' expired.');
    }

    if(d==='plus_faq_add') {
      ownerSessions.set(q.from.id,{mode:'faq_add'});
      return bot.sendMessage(chatId,'❓ Format: Question | Answer');
    }

    if(d.startsWith('plus_faq_')) {
      const id=Number(d.replace('plus_faq_',''));
      const r=await pool.query("SELECT * FROM faqs WHERE id=$1",[id]);
      const f=r.rows[0]; if(!f)return;
      return bot.sendMessage(chatId,'❓ '+f.question+'\n\n'+f.answer,{
        reply_markup:{inline_keyboard:[
          [{text:'✏️ Edit',callback_data:'plus_faqedit_'+id},{text:'🗑 Delete',callback_data:'plus_faqdel_'+id}],
          [{text:(f.enabled?'⏸ Disable':'▶️ Enable'),callback_data:'plus_faqtoggle_'+id}],
          [{text:'⬅️ FAQs',callback_data:'plus_faqs'}]
        ]}
      });
    }

    if(d.startsWith('plus_faqedit_')) {
      const id=Number(d.replace('plus_faqedit_',''));
      ownerSessions.set(q.from.id,{mode:'faq_edit',id:id});
      return bot.sendMessage(chatId,'✏️ নতুনভাবে লিখুন: Question | Answer');
    }
    if(d.startsWith('plus_faqdel_')) {
      const id=Number(d.replace('plus_faqdel_',''));
      await pool.query("DELETE FROM faqs WHERE id=$1",[id]);
      return bot.sendMessage(chatId,'🗑 FAQ deleted.');
    }
    if(d.startsWith('plus_faqtoggle_')) {
      const id=Number(d.replace('plus_faqtoggle_',''));
      await pool.query("UPDATE faqs SET enabled=NOT enabled,updated_at=NOW() WHERE id=$1",[id]);
      return bot.sendMessage(chatId,'✅ FAQ status changed.');
    }

    if(d.startsWith('plus_warn_')) {
      const id=Number(d.replace('plus_warn_','')); const r=await warnUser(id); return bot.sendMessage(chatId,r.msg);
    }
    if(d.startsWith('plus_mute1h_')) {
      const id=Number(d.replace('plus_mute1h_','')); const r=await muteUser(id,3600); return bot.sendMessage(chatId,r.msg);
    }
    if(d.startsWith('plus_mute1d_')) {
      const id=Number(d.replace('plus_mute1d_','')); const r=await muteUser(id,86400); return bot.sendMessage(chatId,r.msg);
    }
    if(d.startsWith('plus_ban_')) {
      const id=Number(d.replace('plus_ban_','')); const r=await banUser(id); return bot.sendMessage(chatId,r.msg);
    }
    if(d.startsWith('plus_unban_')) {
      const id=Number(d.replace('plus_unban_','')); const r=await unbanUser(id); return bot.sendMessage(chatId,r.msg);
    }
    if(d.startsWith('plus_note_')) {
      const id=Number(d.replace('plus_note_',''));
      ownerSessions.set(q.from.id,{mode:'note_add',userId:id});
      return bot.sendMessage(chatId,'📝 এই user-এর private admin note লিখুন।');
    }
  });

  bot.on('message', async msg=>{
    if(msg.from) await trackUser(msg.from,{chatId:msg.chat?.id,chatType:msg.chat?.type}).catch(()=>{});

    const us=userSessions.get(msg.from?.id);
    if(us && us.mode==='payment_proof' && !isOwnerUser(msg.from)) {
      let fileId=null,fileType=null;
      if(msg.photo?.length){fileId=msg.photo[msg.photo.length-1].file_id;fileType='photo';}
      else if(msg.document){fileId=msg.document.file_id;fileType='document';}
      if(!fileId) return bot.sendMessage(msg.chat.id,'Screenshot/photo অথবা document পাঠান।');
      const r=await pool.query(
        "INSERT INTO payment_proofs(order_id,user_id,username,chat_id,file_id,file_type) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
        [us.orderId,msg.from.id,msg.from.username||null,msg.chat.id,fileId,fileType]
      );
      userSessions.delete(msg.from.id);
      const id=r.rows[0].id;
      await bot.sendMessage(msg.chat.id,'✅ Payment proof #'+id+' submitted. Review হলে জানানো হবে.');
      const oid=await ownerId();
      if(oid){
        const caption='📸 NEW PAYMENT PROOF #'+id+'\nOrder #'+us.orderId+'\nUser: '+msg.from.id+' '+(msg.from.username?'@'+msg.from.username:'');
        const opts={caption:caption,reply_markup:{inline_keyboard:[[{text:'✅ Approve',callback_data:'plus_proofapprove_'+id},{text:'❌ Reject',callback_data:'plus_proofreject_'+id}]]}};
        try {
          if(fileType==='photo') await bot.sendPhoto(oid,fileId,opts);
          else await bot.sendDocument(oid,fileId,opts);
        } catch {}
      }
      return;
    }

    if(!msg.from || !isOwnerUser(msg.from) || msg.chat.type!=='private') return;
    await saveOwner(msg.from);
    const s=ownerSessions.get(msg.from.id);
    if(!s) return;

    if(s.mode==='user_search' && msg.text && !msg.text.startsWith('/')) {
      const id=await resolveUser(msg.text);
      if(!id) return bot.sendMessage(msg.chat.id,'User পাওয়া যায়নি। আবার ID/@username দিন।');
      ownerSessions.delete(msg.from.id);
      return userProfile(msg.chat.id,id);
    }

    if(s.mode==='note_add' && msg.text && !msg.text.startsWith('/')) {
      await pool.query("INSERT INTO admin_notes(user_id,note) VALUES($1,$2)",[s.userId,msg.text]);
      ownerSessions.delete(msg.from.id);
      return bot.sendMessage(msg.chat.id,'✅ Private note saved.');
    }

    if(s.mode==='sub_add' && msg.text && !msg.text.startsWith('/')) {
      const p=msg.text.split('|').map(x=>x.trim());
      if(p.length<3 || !/^\d+$/.test(p[0]) || !/^\d+$/.test(p[1])) return bot.sendMessage(msg.chat.id,'Format: UserID | Days | Plan Name');
      const userId=Number(p[0]),days=Number(p[1]),plan=p.slice(2).join(' | ');
      const u=await pool.query("SELECT current_username FROM tracked_users WHERE telegram_id=$1",[userId]);
      await pool.query(
        "INSERT INTO subscriptions(user_id,username,plan_title,expires_at) VALUES($1,$2,$3,NOW()+($4||' days')::interval)",
        [userId,u.rows[0]?.current_username||null,plan,String(days)]
      );
      ownerSessions.delete(msg.from.id);
      return bot.sendMessage(msg.chat.id,'✅ Subscription added for '+days+' days.');
    }

    if((s.mode==='faq_add' || s.mode==='faq_edit') && msg.text && !msg.text.startsWith('/')) {
      const cut=msg.text.indexOf('|');
      if(cut<1) return bot.sendMessage(msg.chat.id,'Format: Question | Answer');
      const q=msg.text.slice(0,cut).trim(),a=msg.text.slice(cut+1).trim();
      if(!q || !a) return bot.sendMessage(msg.chat.id,'Question এবং Answer দুটোই দিন।');
      if(s.mode==='faq_add'){
        await pool.query(
          "INSERT INTO faqs(question,answer,enabled) VALUES($1,$2,TRUE) ON CONFLICT(question) DO UPDATE SET answer=EXCLUDED.answer,enabled=TRUE,updated_at=NOW()",
          [q,a]
        );
      } else {
        await pool.query("UPDATE faqs SET question=$2,answer=$3,updated_at=NOW() WHERE id=$1",[s.id,q,a]);
      }
      ownerSessions.delete(msg.from.id);
      return bot.sendMessage(msg.chat.id,'✅ FAQ saved.');
    }

    if(s.mode==='restore' && msg.document) {
      try {
        await restoreBackup(msg.document.file_id);
        ownerSessions.delete(msg.from.id);
        return bot.sendMessage(msg.chat.id,'✅ Backup restored.');
      } catch(e) {
        return bot.sendMessage(msg.chat.id,'❌ Restore হয়নি: '+e.message);
      }
    }
    if(s.mode==='restore' && !msg.document) {
      return bot.sendMessage(msg.chat.id,'Backup JSON file document হিসেবে পাঠান।');
    }
  });

  setInterval(async ()=>{
    try {
      await ensureSubscriptionsFromOrders();
      const r=await pool.query(
        "SELECT * FROM subscriptions WHERE status='active' ORDER BY expires_at"
      );
      for(const s of r.rows){
        const ms=new Date(s.expires_at).getTime()-Date.now();
        if(ms<=0){
          await pool.query("UPDATE subscriptions SET status='expired' WHERE id=$1",[s.id]);
          if(!s.expired_notice){
            try { await bot.sendMessage(Number(s.user_id),'⏳ আপনার '+(s.plan_title||'Premium')+' subscription expire হয়েছে।',{reply_markup:{inline_keyboard:[[{text:'🔄 Renew Premium',callback_data:'cust_renew'}],[{text:'👤 Customer Menu',callback_data:'cust_menu'}]]}}); } catch {}
            await pool.query("UPDATE subscriptions SET expired_notice=TRUE WHERE id=$1",[s.id]);
          }
        } else if(ms<=86400000 && !s.reminded_1d){
          try { await bot.sendMessage(Number(s.user_id),'⏳ আপনার '+(s.plan_title||'Premium')+' subscription প্রায় ১ দিনের মধ্যে expire হবে।',{reply_markup:{inline_keyboard:[[{text:'🔄 Renew Premium',callback_data:'cust_renew'}],[{text:'⏳ My Subscription',callback_data:'cust_sub'}]]}}); } catch {}
          await pool.query("UPDATE subscriptions SET reminded_1d=TRUE WHERE id=$1",[s.id]);
        } else if(ms<=259200000 && !s.reminded_3d){
          try { await bot.sendMessage(Number(s.user_id),'⏳ আপনার '+(s.plan_title||'Premium')+' subscription প্রায় ৩ দিনের মধ্যে expire হবে।',{reply_markup:{inline_keyboard:[[{text:'🔄 Renew Premium',callback_data:'cust_renew'}],[{text:'⏳ My Subscription',callback_data:'cust_sub'}]]}}); } catch {}
          await pool.query("UPDATE subscriptions SET reminded_3d=TRUE WHERE id=$1",[s.id]);
        }
      }
    } catch(e){ console.error('Subscription reminder error:',e.message); }
  }, 60*60*1000);

  init().catch(e=>console.error('Admin Plus init error:',e));
};