module.exports = function setupOwnerDashboard(ctx) {
  const { bot, pool, isOwnerUser, getSetting, setSetting, OWNER_USERNAME, CHANNEL } = ctx;
  const sessions = new Map();

  async function count(sql, params=[]) {
    try {
      const r=await pool.query(sql,params);
      return Number(r.rows[0]?.n||0);
    } catch { return 0; }
  }

  async function dashboard(chatId) {
    const now=Date.now();
    const [
      users,totalOrders,pendingOrders,paidOrders,activatedOrders,todayOrders,
      pendingProofs,activeSubs,expiringSubs,openTickets,pendingDevices,scheduled,
      notice,status
    ] = await Promise.all([
      count("SELECT COUNT(*)::int n FROM tracked_users"),
      count("SELECT COUNT(*)::int n FROM sales_orders"),
      count("SELECT COUNT(*)::int n FROM sales_orders WHERE status='pending'"),
      count("SELECT COUNT(*)::int n FROM sales_orders WHERE status='paid'"),
      count("SELECT COUNT(*)::int n FROM sales_orders WHERE status='activated'"),
      count("SELECT COUNT(*)::int n FROM sales_orders WHERE created_at>=date_trunc('day',NOW())"),
      count("SELECT COUNT(*)::int n FROM payment_proofs WHERE status='pending'"),
      count("SELECT COUNT(*)::int n FROM subscriptions WHERE status='active' AND expires_at>NOW()"),
      count("SELECT COUNT(*)::int n FROM subscriptions WHERE status='active' AND expires_at>NOW() AND expires_at<=NOW()+INTERVAL '3 days'"),
      count("SELECT COUNT(*)::int n FROM support_tickets WHERE status='open'"),
      count("SELECT COUNT(*)::int n FROM device_requests WHERE status='pending'"),
      count("SELECT COUNT(*)::int n FROM scheduled_posts WHERE status='pending'"),
      getSetting('customer_announcement',''),
      getSetting('service_status','online')
    ]);

    const actionNeeded=pendingOrders+pendingProofs+openTickets+pendingDevices;
    return bot.sendMessage(chatId,
      '📊 OWNER DASHBOARD\n\n'+
      '👑 @'+OWNER_USERNAME+'\n'+
      '🟢 Service: '+String(status).toUpperCase()+'\n'+
      '📢 Channel: '+CHANNEL+'\n\n'+
      '👥 Known Users: '+users+'\n'+
      '💎 Active Premium: '+activeSubs+'\n'+
      '⏳ Expiring ≤ 3 Days: '+expiringSubs+'\n\n'+
      '🛒 Orders: '+totalOrders+' total • '+todayOrders+' today\n'+
      '⏳ Pending Orders: '+pendingOrders+'\n'+
      '💰 Paid: '+paidOrders+' • ✅ Activated: '+activatedOrders+'\n'+
      '📸 Pending Proofs: '+pendingProofs+'\n'+
      '🎫 Open Tickets: '+openTickets+'\n'+
      '📱 Device Requests: '+pendingDevices+'\n'+
      '⏰ Scheduled Posts: '+scheduled+'\n\n'+
      '🚨 Action Needed: '+actionNeeded+
      (notice?'\n\n📣 Customer Notice: '+notice:'\n\n📣 Customer Notice: OFF'),
      {reply_markup:{inline_keyboard:[
        [{text:'🛒 Orders',callback_data:'biz_orders'},{text:'📸 Payment Proofs',callback_data:'plus_proofs'}],
        [{text:'💎 Subscriptions',callback_data:'plus_subs'},{text:'🎫 Tickets',callback_data:'grp_tickets'}],
        [{text:'📱 Device Requests',callback_data:'biz_devices'},{text:'👥 Users',callback_data:'user_tracker'}],
        [{text:'📢 Customer Notice',callback_data:'dash_notice'},{text:'👁 Customer Preview',callback_data:'cust_preview_owner'}],
        [{text:'🔄 Refresh Dashboard',callback_data:'dash_home'}],
        [{text:'⬅️ Main Panel',callback_data:'main_panel'}]
      ]}}
    );
  }

  bot.onText(/^\/dashboard(?:@\w+)?$/, async msg=>{
    if(!isOwnerUser(msg.from)) return;
    return dashboard(msg.chat.id);
  });

  bot.on('callback_query',async q=>{
    const d=q.data||'';
    if(!d.startsWith('dash_')) return;
    if(!isOwnerUser(q.from)) return bot.answerCallbackQuery(q.id,{text:'Owner only',show_alert:true}).catch(()=>{});
    await bot.answerCallbackQuery(q.id).catch(()=>{});
    if(!q.message) return;
    const chatId=q.message.chat.id;
    if(d==='dash_home') return dashboard(chatId);
    if(d==='dash_notice'){
      sessions.set(q.from.id,{mode:'notice'});
      const cur=await getSetting('customer_announcement','');
      return bot.sendMessage(chatId,
        '📢 CUSTOMER NOTICE\n\nCustomer dashboard-এর উপরে যে notice দেখাবে সেটা লিখুন।\n\nCurrent: '+(cur||'OFF')+'\n\nবন্ধ করতে শুধু: off'
      );
    }
  });

  bot.on('message',async msg=>{
    if(!msg.from || !isOwnerUser(msg.from) || msg.chat.type!=='private') return;
    const s=sessions.get(msg.from.id);
    if(!s || s.mode!=='notice' || !msg.text || msg.text.startsWith('/')) return;
    const v=msg.text.trim().toLowerCase()==='off'?'':msg.text.trim();
    await setSetting('customer_announcement',v);
    sessions.delete(msg.from.id);
    return bot.sendMessage(msg.chat.id,v?'✅ Customer Notice updated.':'✅ Customer Notice turned OFF.',{
      reply_markup:{inline_keyboard:[[{text:'📊 Owner Dashboard',callback_data:'dash_home'}]]}
    });
  });
};