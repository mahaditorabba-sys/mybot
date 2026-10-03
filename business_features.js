module.exports = function setupBusinessFeatures(ctx) {
  const { bot, pool, isOwnerUser, getSetting, setSetting, OWNER_USERNAME, CHANNEL } = ctx;
  const sessions = new Map();

  async function init() {
    await pool.query(
      'CREATE TABLE IF NOT EXISTS sales_orders (' +
      'id SERIAL PRIMARY KEY, user_id BIGINT NOT NULL, username TEXT, chat_id BIGINT, message_id BIGINT, ' +
      'plan_id INTEGER, plan_title TEXT, price_text TEXT, contact_method TEXT, status TEXT DEFAULT \'pending\', ' +
      'created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());' +
      'CREATE TABLE IF NOT EXISTS device_requests (' +
      'id SERIAL PRIMARY KEY, user_id BIGINT NOT NULL, username TEXT, chat_id BIGINT NOT NULL, message_id BIGINT, ' +
      'details TEXT NOT NULL, status TEXT DEFAULT \'pending\', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());'
    );
    for (const [k,v] of Object.entries({
      payment_info: '',
      business_broadcast_enabled: 'true'
    })) {
      await pool.query('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING',[k,v]);
    }
    const payMigration = await getSetting('migration_payment_methods_bkash_nagad','false');
    if (payMigration !== 'true') {
      await setSetting('payment_info','💗 bKash\n🟠 Nagad');
      await setSetting('migration_payment_methods_bkash_nagad','true');
    }
    console.log('Business tools module ready');
  }

  function durationDaysFromCode(code,title) {
    const c=String(code||'').toLowerCase();
    if(c==='15d') return 15;
    if(c==='1m') return 30;
    if(c==='2m') return 60;
    if(c==='1y') return 365;
    const t=String(title||'').toLowerCase();
    if(t.includes('15 day')) return 15;
    if(t.includes('2 month')) return 60;
    if(t.includes('1 year') || t.includes('12 month')) return 365;
    return 30;
  }

  async function ownerId() {
    const v = await getSetting('owner_id','');
    return v ? Number(v) : null;
  }

  async function ownerAlert(text, keyboard) {
    const id = await ownerId();
    if (!id) return;
    try {
      await bot.sendMessage(id,text,keyboard ? {reply_markup:{inline_keyboard:keyboard}} : {});
    } catch {}
  }

  async function businessMenu(chatId) {
    const p = await getSetting('payment_info','');
    const openOrders = await pool.query("SELECT COUNT(*)::int n FROM sales_orders WHERE status='pending'");
    const openDevices = await pool.query("SELECT COUNT(*)::int n FROM device_requests WHERE status='pending'");
    return bot.sendMessage(chatId,
      '💼 BUSINESS TOOLS\n\n' +
      '🛒 Pending Orders: '+openOrders.rows[0].n+'\n' +
      '📱 Device Requests: '+openDevices.rows[0].n+'\n' +
      '💳 Payment Info: '+(p ? 'SET' : 'NOT SET')+'\n💗 bKash  •  🟠 Nagad',
      {reply_markup:{inline_keyboard:[
        [{text:'🛒 Orders',callback_data:'biz_orders'},{text:'📱 Device Requests',callback_data:'biz_devices'}],
        [{text:'💗 bKash / 🟠 Nagad',callback_data:'biz_payment'},{text:'📣 Broadcast',callback_data:'biz_broadcast'}],
        [{text:'📈 Sales Summary',callback_data:'biz_sales'},{text:'⬅️ Main Panel',callback_data:'main_panel'}]
      ]}}
    );
  }

  async function showOrders(chatId) {
    const r = await pool.query(
      'SELECT id,username,user_id,plan_title,price_text,contact_method,status FROM sales_orders ORDER BY id DESC LIMIT 12'
    );
    if (!r.rows.length) return bot.sendMessage(chatId,'🛒 এখনো কোনো order নেই।');
    return bot.sendMessage(chatId,'🛒 RECENT ORDERS',{
      reply_markup:{inline_keyboard:r.rows.map(x=>[{
        text:'#'+x.id+' • '+(x.plan_title||'Plan')+' • '+String(x.status).toUpperCase(),
        callback_data:'biz_order_'+x.id
      }]).concat([[{text:'⬅️ Business Tools',callback_data:'biz_menu'}]])}
    });
  }

  async function showDevices(chatId) {
    const r = await pool.query(
      "SELECT id,username,user_id,status FROM device_requests ORDER BY id DESC LIMIT 12"
    );
    if (!r.rows.length) return bot.sendMessage(chatId,'📱 কোনো device request নেই।');
    return bot.sendMessage(chatId,'📱 DEVICE REQUESTS',{
      reply_markup:{inline_keyboard:r.rows.map(x=>[{
        text:'#'+x.id+' • '+(x.username?'@'+x.username:x.user_id)+' • '+String(x.status).toUpperCase(),
        callback_data:'biz_device_'+x.id
      }]).concat([[{text:'⬅️ Business Tools',callback_data:'biz_menu'}]])}
    });
  }

  async function salesSummary(chatId) {
    const a = await Promise.all([
      pool.query("SELECT COUNT(*)::int n FROM sales_orders"),
      pool.query("SELECT COUNT(*)::int n FROM sales_orders WHERE status='pending'"),
      pool.query("SELECT COUNT(*)::int n FROM sales_orders WHERE status='paid'"),
      pool.query("SELECT COUNT(*)::int n FROM sales_orders WHERE status='activated'"),
      pool.query("SELECT COUNT(*)::int n FROM sales_orders WHERE created_at >= date_trunc('day',NOW())")
    ]);
    return bot.sendMessage(chatId,
      '📈 SALES SUMMARY\n\n' +
      '🧾 Total Orders: '+a[0].rows[0].n+'\n' +
      '⏳ Pending: '+a[1].rows[0].n+'\n' +
      '💰 Paid: '+a[2].rows[0].n+'\n' +
      '✅ Activated: '+a[3].rows[0].n+'\n' +
      '📅 Today: '+a[4].rows[0].n
    );
  }

  bot.onText(/^\/business(?:@\w+)?$/, async msg=>{
    if (!isOwnerUser(msg.from)) return;
    return businessMenu(msg.chat.id);
  });

  bot.onText(/^\/orders(?:@\w+)?$/, async msg=>{
    if (!isOwnerUser(msg.from)) return;
    return showOrders(msg.chat.id);
  });

  bot.onText(/^\/devicechange(?:@\w+)?(?:\s+([\s\S]+))?$/, async (msg,match)=>{
    const details=(match?.[1]||'').trim();
    if (!details) {
      return bot.sendMessage(msg.chat.id,
        '📱 Device Change Request\n\nএইভাবে লিখুন:\n/devicechange আপনার account/device details\n\nPassword public message-এ দেবেন না।'
      );
    }
    const r=await pool.query(
      'INSERT INTO device_requests(user_id,username,chat_id,message_id,details) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [msg.from.id,msg.from.username||null,msg.chat.id,msg.message_id,details]
    );
    const id=r.rows[0].id;
    await bot.sendMessage(msg.chat.id,'✅ Device request #'+id+' পাঠানো হয়েছে।',{reply_to_message_id:msg.message_id}).catch(()=>{});
    await ownerAlert(
      '📱 NEW DEVICE REQUEST #'+id+'\nUser: '+msg.from.id+' '+(msg.from.username?'@'+msg.from.username:'')+'\n\n'+details,
      [[{text:'✅ Approve',callback_data:'biz_devapprove_'+id},{text:'❌ Reject',callback_data:'biz_devreject_'+id}]]
    );
  });

  bot.on('callback_query', async q=>{
    const d=q.data||'';
    if (!d.startsWith('biz_')) return;
    if (!isOwnerUser(q.from)) return;
    await bot.answerCallbackQuery(q.id).catch(()=>{});
    const chatId=q.message.chat.id;

    if (d==='biz_menu') return businessMenu(chatId);
    if (d==='biz_orders') return showOrders(chatId);
    if (d==='biz_devices') return showDevices(chatId);
    if (d==='biz_sales') return salesSummary(chatId);

    if (d==='biz_payment') {
      return bot.sendMessage(chatId,
        '💳 PAYMENT METHODS\n\n💗 bKash\n🟠 Nagad\n\n🔒 Customer-এর কাছে কোনো payment number দেখানো হবে না।\nPlan select → WhatsApp/Telegram → bKash/Nagad → ready-made message → Send.'
      );
    }

    if (d==='biz_broadcast') {
      sessions.set(q.from.id,{mode:'broadcast'});
      return bot.sendMessage(chatId,
        '📣 যে announcement পাঠাতে চান সেটা লিখুন।\n\nএটা Channel-এ যাবে, আর Group bind করা থাকলে Group-এও যাবে।'
      );
    }

    if (d.startsWith('biz_order_')) {
      const id=Number(d.replace('biz_order_',''));
      const r=await pool.query('SELECT * FROM sales_orders WHERE id=$1',[id]);
      const o=r.rows[0]; if(!o)return;
      return bot.sendMessage(chatId,
        '🛒 ORDER #'+o.id+'\n\n'+
        'User: '+o.user_id+' '+(o.username?'@'+o.username:'')+'\n'+
        'Plan: '+(o.plan_title||'-')+'\n'+
        'Price: '+(o.price_text||'-')+'\n'+
        'Contact: '+(o.contact_method||'-')+'\n'+
        'Status: '+String(o.status).toUpperCase(),
        {reply_markup:{inline_keyboard:[
          [{text:'⏳ Pending',callback_data:'biz_ost_pending_'+id},{text:'💰 Paid',callback_data:'biz_ost_paid_'+id}],
          [{text:'✅ Activated',callback_data:'biz_ost_activated_'+id},{text:'❌ Cancelled',callback_data:'biz_ost_cancelled_'+id}],
          [{text:'⬅️ Orders',callback_data:'biz_orders'}]
        ]}}
      );
    }

    if (d.startsWith('biz_ost_')) {
      const rest=d.replace('biz_ost_','');
      const cut=rest.lastIndexOf('_');
      const status=rest.slice(0,cut);
      const id=Number(rest.slice(cut+1));
      const r=await pool.query(
        'UPDATE sales_orders SET status=$2,updated_at=NOW() WHERE id=$1 RETURNING *',
        [id,status]
      );
      const o=r.rows[0]; if(!o)return;
      if(status==='activated'){
        const plan=await pool.query('SELECT code,title FROM subscription_plans WHERE id=$1',[o.plan_id]).catch(()=>({rows:[]}));
        const days=durationDaysFromCode(plan.rows[0]?.code,o.plan_title);
        await pool.query(
          "INSERT INTO subscriptions(order_id,user_id,username,plan_title,expires_at,status) "+
          "VALUES($1,$2,$3,$4,NOW()+($5||' days')::interval,'active') "+
          "ON CONFLICT(order_id) DO UPDATE SET status='active'",
          [o.id,o.user_id,o.username,o.plan_title,String(days)]
        ).catch(()=>{});
      }
      try {
        if (o.chat_id) await bot.sendMessage(
          Number(o.chat_id),
          '🛒 Order #'+id+' status: '+status.toUpperCase(),
          {reply_to_message_id:o.message_id||undefined,reply_markup:{inline_keyboard:[[
            {text:'👤 Customer Menu',callback_data:'cust_menu'},
            {text:'⏳ My Subscription',callback_data:'cust_sub'}
          ]]}}
        );
      } catch {}
      return bot.sendMessage(chatId,'✅ Order #'+id+' → '+status.toUpperCase());
    }

    if (d.startsWith('biz_device_')) {
      const id=Number(d.replace('biz_device_',''));
      const r=await pool.query('SELECT * FROM device_requests WHERE id=$1',[id]);
      const x=r.rows[0]; if(!x)return;
      return bot.sendMessage(chatId,
        '📱 DEVICE REQUEST #'+id+'\n\nUser: '+x.user_id+' '+(x.username?'@'+x.username:'')+'\nStatus: '+String(x.status).toUpperCase()+'\n\n'+x.details,
        {reply_markup:{inline_keyboard:[
          [{text:'✅ Approve',callback_data:'biz_devapprove_'+id},{text:'❌ Reject',callback_data:'biz_devreject_'+id}],
          [{text:'⬅️ Device Requests',callback_data:'biz_devices'}]
        ]}}
      );
    }

    if (d.startsWith('biz_devapprove_') || d.startsWith('biz_devreject_')) {
      const approve=d.startsWith('biz_devapprove_');
      const id=Number(d.replace(approve?'biz_devapprove_':'biz_devreject_',''));
      const status=approve?'approved':'rejected';
      const r=await pool.query(
        'UPDATE device_requests SET status=$2,updated_at=NOW() WHERE id=$1 RETURNING *',
        [id,status]
      );
      const x=r.rows[0]; if(!x)return;
      try {
        await bot.sendMessage(Number(x.chat_id),
          approve ? '✅ Device request #'+id+' approved.' : '❌ Device request #'+id+' rejected.',
          {reply_to_message_id:x.message_id||undefined}
        );
      } catch {}
      return bot.sendMessage(chatId,'📱 Device request #'+id+' → '+status.toUpperCase());
    }
  });

  bot.on('message', async msg=>{
    if (!msg.from || !isOwnerUser(msg.from) || msg.chat.type!=='private') return;
    const s=sessions.get(msg.from.id);
    if (!s || !msg.text || msg.text.startsWith('/')) return;

    if (s.mode==='payment') {
      const v=msg.text.trim().toLowerCase()==='off'?'':msg.text.trim();
      await setSetting('payment_info',v);
      sessions.delete(msg.from.id);
      return bot.sendMessage(msg.chat.id,'✅ Payment Info updated.');
    }

    if (s.mode==='broadcast') {
      sessions.delete(msg.from.id);
      const text=msg.text;
      let channelOk=false,groupOk=false;
      try { await bot.sendMessage(CHANNEL,text); channelOk=true; } catch {}
      const gid=await getSetting('primary_group_id','');
      if (gid) { try { await bot.sendMessage(Number(gid),text); groupOk=true; } catch {} }
      return bot.sendMessage(msg.chat.id,
        '📣 Broadcast complete.\nChannel: '+(channelOk?'✅':'❌')+'\nGroup: '+(gid?(groupOk?'✅':'❌'):'Not bound')
      );
    }
  });

  init().catch(e=>console.error('Business module init error:',e));
};