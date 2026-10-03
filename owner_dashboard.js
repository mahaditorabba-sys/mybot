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
      notice,status,noticeAudience
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
      getSetting('service_status','online'),
      getSetting('customer_announcement_audience','all')
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
      (notice?'\n\n🎯 Notice ['+String(noticeAudience).toUpperCase()+']: '+notice:'\n\n🎯 Target Notice: OFF'),
      {reply_markup:{inline_keyboard:[
        [{text:'👮 Quick User Control',callback_data:'adv_user_search'},{text:'💰 Sales Report',callback_data:'adv_sales'}],
        [{text:'⏳ Expiry Center',callback_data:'adv_expiry'},{text:'📣 Broadcast',callback_data:'biz_broadcast'}],
        [{text:'🎯 Target Notice',callback_data:'dash_notice'},{text:'👁 Customer Preview',callback_data:'cust_preview_owner'}],
        [{text:'🛒 Orders',callback_data:'biz_orders'},{text:'📸 Payment Proofs',callback_data:'plus_proofs'}],
        [{text:'💎 Subscriptions',callback_data:'plus_subs'},{text:'🎫 Tickets',callback_data:'grp_tickets'}],
        [{text:'📱 Device Requests',callback_data:'biz_devices'},{text:'👥 Users',callback_data:'user_tracker'}],

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
      const cur=await getSetting('customer_announcement','');
      const aud=await getSetting('customer_announcement_audience','all');
      return bot.sendMessage(chatId,
        '🎯 TARGET CUSTOMER NOTICE\n\nAudience বেছে নিন। তারপর notice লিখবেন।\n\nCurrent: '+(cur||'OFF')+'\nAudience: '+String(aud).toUpperCase(),{
          reply_markup:{inline_keyboard:[
            [{text:'👥 All',callback_data:'dash_notice_all'}],
            [{text:'💎 Active Premium',callback_data:'dash_notice_active'},{text:'⌛ Expired',callback_data:'dash_notice_expired'}],
            [{text:'🛒 Pending Order',callback_data:'dash_notice_pending'}],
            [{text:'❌ Turn Notice Off',callback_data:'dash_notice_off'}],
            [{text:'⬅️ Dashboard',callback_data:'dash_home'}]
          ]}
        }
      );
    }
    if(d==='dash_notice_off'){
      await setSetting('customer_announcement','');
      return bot.sendMessage(chatId,'✅ Target Notice OFF.',{reply_markup:{inline_keyboard:[[{text:'⬅️ Dashboard',callback_data:'dash_home'}]]}});
    }
    if(d.startsWith('dash_notice_')){
      const audience=d.replace('dash_notice_','');
      if(!['all','active','expired','pending'].includes(audience)) return;
      sessions.set(q.from.id,{mode:'notice',audience});
      return bot.sendMessage(chatId,'🎯 '+audience.toUpperCase()+' audience-এর জন্য notice লিখুন।\n\nএটা customer dashboard-এ দেখাবে। বন্ধ করতে পরে Target Notice → Turn Notice Off চাপুন।');
    }
  });

  bot.on('message',async msg=>{
    if(!msg.from || !isOwnerUser(msg.from) || msg.chat.type!=='private') return;
    const s=sessions.get(msg.from.id);
    if(!s || s.mode!=='notice' || !msg.text || msg.text.startsWith('/')) return;
    const v=msg.text.trim();
    await setSetting('customer_announcement',v);
    await setSetting('customer_announcement_audience',s.audience||'all');
    sessions.delete(msg.from.id);
    return bot.sendMessage(msg.chat.id,'✅ Target Notice updated for '+String(s.audience||'all').toUpperCase()+'.',{
      reply_markup:{inline_keyboard:[[{text:'📊 Owner Dashboard',callback_data:'dash_home'}]]}
    });
  });
};