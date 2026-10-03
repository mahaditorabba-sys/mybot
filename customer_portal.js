module.exports = function setupCustomerPortal(ctx) {
  const { bot, pool, isOwnerUser, getSetting, trackUser, OWNER_USERNAME } = ctx;
  const sessions = new Map();

  async function init() {
    await pool.query(
      "CREATE TABLE IF NOT EXISTS payment_proofs (" +
      "id SERIAL PRIMARY KEY, order_id INTEGER NOT NULL, user_id BIGINT NOT NULL, username TEXT, chat_id BIGINT NOT NULL, " +
      "file_id TEXT NOT NULL, file_type TEXT NOT NULL, status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW(), reviewed_at TIMESTAMPTZ);" +
      "CREATE TABLE IF NOT EXISTS subscriptions (" +
      "id SERIAL PRIMARY KEY, order_id INTEGER UNIQUE, user_id BIGINT NOT NULL, username TEXT, plan_title TEXT, " +
      "starts_at TIMESTAMPTZ DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL, status TEXT DEFAULT 'active', " +
      "reminded_3d BOOLEAN DEFAULT FALSE, reminded_1d BOOLEAN DEFAULT FALSE, expired_notice BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT NOW());"
    );
    await pool.query("INSERT INTO settings(key,value) VALUES('customer_announcement','') ON CONFLICT(key) DO NOTHING");
    console.log('Customer portal module ready');
  }

  async function ownerId() {
    const v = await getSetting('owner_id','');
    return v && /^\d+$/.test(String(v)) ? Number(v) : null;
  }

  async function menu(chatId, user) {
    const [orders,latestOrder,sub,tickets,devices,announcement,status,pendingOrders,noticeAudience] = await Promise.all([
      pool.query("SELECT COUNT(*)::int n FROM sales_orders WHERE user_id=$1",[user.id]).catch(()=>({rows:[{n:0}]})),
      pool.query("SELECT id,status,plan_title FROM sales_orders WHERE user_id=$1 ORDER BY id DESC LIMIT 1",[user.id]).catch(()=>({rows:[]})),
      pool.query("SELECT s.id,s.status,s.expires_at,s.plan_title,o.plan_id FROM subscriptions s LEFT JOIN sales_orders o ON o.id=s.order_id WHERE s.user_id=$1 ORDER BY s.id DESC LIMIT 1",[user.id]).catch(()=>({rows:[]})),
      pool.query("SELECT COUNT(*)::int n FROM support_tickets WHERE user_id=$1 AND status='open'",[user.id]).catch(()=>({rows:[{n:0}]})),
      pool.query("SELECT COUNT(*)::int n FROM device_requests WHERE user_id=$1 AND status='pending'",[user.id]).catch(()=>({rows:[{n:0}]})),
      getSetting('customer_announcement',''),
      getSetting('service_status','online'),
      pool.query("SELECT COUNT(*)::int n FROM sales_orders WHERE user_id=$1 AND status='pending'",[user.id]).catch(()=>({rows:[{n:0}]})),
      getSetting('customer_announcement_audience','all')
    ]);
    const s=sub.rows[0];
    const last=latestOrder.rows[0];
    let subText='No subscription';
    if(s){
      const active=s.status==='active'&&new Date(s.expires_at).getTime()>Date.now();
      subText=active?'✅ '+(s.plan_title||'Premium')+' • '+remainingText(s.expires_at):'❌ Expired';
    }
    const activeSub=!!(s&&s.status==='active'&&new Date(s.expires_at).getTime()>Date.now());
    const expiredSub=!!(s&&!activeSub);
    const hasPending=Number(pendingOrders.rows[0]?.n||0)>0;
    const audienceMatch=noticeAudience==='all' ||
      (noticeAudience==='active'&&activeSub) ||
      (noticeAudience==='expired'&&expiredSub) ||
      (noticeAudience==='pending'&&hasPending);
    const notice=(announcement&&audienceMatch) ? '\n📢 NOTICE\n'+announcement+'\n' : '';
    const renewCb=s?.plan_id?'pub_plan_'+s.plan_id:'cust_renew';
    return bot.sendMessage(chatId,
      '🏠 MAHADI TOOLS — CUSTOMER DASHBOARD\n\n'+
      '👋 '+(user.first_name||'Customer')+'\n'+
      '🆔 User ID: '+user.id+'\n'+
      (user.username?'👤 @'+user.username+'\n':'')+
      '🟢 Service: '+String(status).toUpperCase()+'\n'+
      notice+'\n'+
      '💎 Premium: '+subText+'\n'+
      '📦 Total Orders: '+orders.rows[0].n+'\n'+
      '🧾 Last Order: '+(last?'#'+last.id+' • '+String(last.status).toUpperCase():'None')+'\n'+
      '📱 Device Requests: '+devices.rows[0].n+' pending\n'+
      '🎫 Support Tickets: '+tickets.rows[0].n+' open',
      {reply_markup:{inline_keyboard:[
        [{text:'💎 Buy Premium',callback_data:'cust_plans'},{text:'🔄 Refresh',callback_data:'cust_menu'}],
        [{text:'📦 My Orders',callback_data:'cust_orders'},{text:'⏳ My Subscription',callback_data:'cust_sub'}],
        [{text:'📱 Device Change',callback_data:'cust_device'},{text:'🎫 Support',callback_data:'cust_support'}],
        [{text:'🔄 Renew Premium',callback_data:renewCb},{text:'☎️ Official Contact',callback_data:'cust_contact'}]
      ]}}
    );
  }

  async function ownerPreview(chatId) {
    return bot.sendMessage(chatId,
      '👁 CUSTOMER SCREEN PREVIEW\n\n'+
      '🏠 MAHADI TOOLS — CUSTOMER DASHBOARD\n\n'+
      '👋 Customer Name\n'+
      '🆔 User ID: customer ID\n'+
      '🟢 Service: ONLINE\n\n'+
      '💎 Premium: status + remaining time\n'+
      '📦 Total Orders: customer order count\n'+
      '🧾 Last Order: latest status\n'+
      '📱 Device Requests: pending count\n'+
      '🎫 Support Tickets: open count',
      {reply_markup:{inline_keyboard:[
        [{text:'💎 Buy Premium',callback_data:'cust_preview_info'},{text:'🔄 Refresh',callback_data:'cust_preview_info'}],
        [{text:'📦 My Orders',callback_data:'cust_preview_info'},{text:'⏳ My Subscription',callback_data:'cust_preview_info'}],
        [{text:'📱 Device Change',callback_data:'cust_preview_info'},{text:'🎫 Support',callback_data:'cust_preview_info'}],
        [{text:'🔄 Renew Premium',callback_data:'cust_preview_info'},{text:'☎️ Official Contact',callback_data:'cust_preview_info'}],
        [{text:'⬅️ Back to Owner Panel',callback_data:'main_panel'}]
      ]}}
    );
  }

  async function showPlans(chatId) {
    const r=await pool.query("SELECT id,title,price_text FROM subscription_plans WHERE enabled=TRUE ORDER BY id");
    if(!r.rows.length) return bot.sendMessage(chatId,'💎 কোনো plan available নেই।');
    return bot.sendMessage(chatId,'💎 PREMIUM PLANS\n\nPlan সিলেক্ট করুন:',{
      reply_markup:{inline_keyboard:r.rows.map(x=>[{
        text:x.title+' — '+x.price_text,
        callback_data:'pub_plan_'+x.id
      }]).concat([[{text:'⬅️ Customer Menu',callback_data:'cust_menu'}]])}
    });
  }

  async function showOrders(chatId, userId) {
    const r=await pool.query(
      "SELECT id,plan_title,price_text,contact_method,status,created_at FROM sales_orders WHERE user_id=$1 ORDER BY id DESC LIMIT 12",
      [userId]
    ).catch(()=>({rows:[]}));
    if(!r.rows.length){
      return bot.sendMessage(chatId,'📦 এখনো কোনো order নেই।',{
        reply_markup:{inline_keyboard:[
          [{text:'💎 View Plans',callback_data:'cust_plans'}],
          [{text:'⬅️ Customer Menu',callback_data:'cust_menu'}]
        ]}
      });
    }
    const rows=r.rows.map(x=>[{
      text:'#'+x.id+' • '+(x.plan_title||'Premium')+' • '+String(x.status).toUpperCase(),
      callback_data:'cust_order_'+x.id
    }]);
    rows.push([{text:'⬅️ Customer Menu',callback_data:'cust_menu'}]);
    return bot.sendMessage(chatId,'📦 MY ORDERS',{reply_markup:{inline_keyboard:rows}});
  }

  async function showOrder(chatId, userId, orderId) {
    const r=await pool.query(
      "SELECT * FROM sales_orders WHERE id=$1 AND user_id=$2",
      [orderId,userId]
    );
    const o=r.rows[0];
    if(!o) return bot.sendMessage(chatId,'Order পাওয়া যায়নি।');
    const pr=await pool.query(
      "SELECT status FROM payment_proofs WHERE order_id=$1 AND user_id=$2 ORDER BY id DESC LIMIT 1",
      [orderId,userId]
    ).catch(()=>({rows:[]}));
    const proof=pr.rows[0]?.status || 'not submitted';
    const kb=[];
    if(String(o.status).toLowerCase()==='pending'){
      kb.push([{text:'📸 Submit Payment Proof',callback_data:'cust_proof_'+o.id}]);
    }
    if(String(o.status).toLowerCase()==='activated'){
      kb.push([{text:'⏳ My Subscription',callback_data:'cust_sub'}]);
    }
    kb.push([{text:'🔄 Renew / Buy Again',callback_data:'cust_renew'}]);
    kb.push([{text:'⬅️ My Orders',callback_data:'cust_orders'}]);
    return bot.sendMessage(chatId,
      '📦 ORDER #'+o.id+'\n\n'+
      'Plan: '+(o.plan_title||'-')+'\n'+
      'Price: '+(o.price_text||'-')+'\n'+
      'Status: '+String(o.status).toUpperCase()+'\n'+
      'Payment Proof: '+String(proof).toUpperCase()+'\n'+
      'Contact: '+(o.contact_method||'-')+'\n'+
      'Created: '+new Date(o.created_at).toLocaleString('en-GB',{timeZone:'Asia/Muscat'}),
      {reply_markup:{inline_keyboard:kb}}
    );
  }

  function remainingText(expiresAt) {
    const ms=new Date(expiresAt).getTime()-Date.now();
    if(ms<=0) return 'Expired';
    const days=Math.floor(ms/86400000);
    const hours=Math.floor((ms%86400000)/3600000);
    if(days>0) return days+' দিন '+hours+' ঘণ্টা বাকি';
    const mins=Math.max(1,Math.floor(ms/60000));
    return hours+' ঘণ্টা '+(mins%60)+' মিনিট বাকি';
  }

  async function showSubscription(chatId, userId) {
    const r=await pool.query(
      "SELECT s.*,o.plan_id FROM subscriptions s LEFT JOIN sales_orders o ON o.id=s.order_id WHERE s.user_id=$1 ORDER BY s.id DESC LIMIT 1",
      [userId]
    ).catch(()=>({rows:[]}));
    const s=r.rows[0];
    if(!s){
      return bot.sendMessage(chatId,'⏳ আপনার কোনো subscription পাওয়া যায়নি।',{
        reply_markup:{inline_keyboard:[
          [{text:'💎 View Plans',callback_data:'cust_plans'}],
          [{text:'⬅️ Customer Menu',callback_data:'cust_menu'}]
        ]}
      });
    }
    const active=s.status==='active' && new Date(s.expires_at).getTime()>Date.now();
    const renewCb=s.plan_id?'pub_plan_'+s.plan_id:'cust_renew';
    return bot.sendMessage(chatId,
      '⏳ MY SUBSCRIPTION\n\n'+
      'Plan: '+(s.plan_title||'Premium')+'\n'+
      'Status: '+(active?'✅ ACTIVE':'❌ EXPIRED')+'\n'+
      'Started: '+new Date(s.starts_at).toLocaleString('en-GB',{timeZone:'Asia/Muscat'})+'\n'+
      'Expires: '+new Date(s.expires_at).toLocaleString('en-GB',{timeZone:'Asia/Muscat'})+'\n'+
      'Remaining: '+remainingText(s.expires_at),
      {reply_markup:{inline_keyboard:[
        [{text:'🔄 Renew Same Plan',callback_data:renewCb}],
        [{text:'💎 Other Plans',callback_data:'cust_plans'}],
        [{text:'📦 My Orders',callback_data:'cust_orders'},{text:'⬅️ Customer Menu',callback_data:'cust_menu'}]
      ]}}
    );
  }

  async function startProof(chatId, user, orderId) {
    const r=await pool.query(
      "SELECT id,plan_title,price_text,status FROM sales_orders WHERE id=$1 AND user_id=$2",
      [orderId,user.id]
    );
    const o=r.rows[0];
    if(!o) return bot.sendMessage(chatId,'Order পাওয়া যায়নি অথবা এটা আপনার order নয়।');
    if(String(o.status).toLowerCase()!=='pending'){
      return bot.sendMessage(chatId,'এই order-এর status '+String(o.status).toUpperCase()+'. নতুন proof দরকার নেই।');
    }
    sessions.set(user.id,{mode:'proof',orderId:o.id});
    return bot.sendMessage(chatId,
      '📸 PAYMENT PROOF — Order #'+o.id+'\n\nএখন payment screenshot/photo পাঠান। Document হিসেবেও পাঠাতে পারবেন।',
      {reply_markup:{inline_keyboard:[[{text:'❌ Cancel',callback_data:'cust_proof_cancel'}]]}}
    );
  }

  async function saveProof(msg, session) {
    let fileId=null,fileType=null;
    if(msg.photo?.length){ fileId=msg.photo[msg.photo.length-1].file_id; fileType='photo'; }
    else if(msg.document){ fileId=msg.document.file_id; fileType='document'; }
    if(!fileId) return bot.sendMessage(msg.chat.id,'📸 Screenshot/photo অথবা document পাঠান।');

    const own=await pool.query(
      "SELECT id,plan_title,price_text FROM sales_orders WHERE id=$1 AND user_id=$2",
      [session.orderId,msg.from.id]
    );
    const order=own.rows[0];
    if(!order){ sessions.delete(msg.from.id); return bot.sendMessage(msg.chat.id,'Order পাওয়া যায়নি।'); }

    const r=await pool.query(
      "INSERT INTO payment_proofs(order_id,user_id,username,chat_id,file_id,file_type) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
      [order.id,msg.from.id,msg.from.username||null,msg.chat.id,fileId,fileType]
    );
    sessions.delete(msg.from.id);
    const proofId=r.rows[0].id;
    await bot.sendMessage(msg.chat.id,
      '✅ Payment proof #'+proofId+' submitted. Owner review করলে status update পাবেন।',
      {reply_markup:{inline_keyboard:[[{text:'📦 View Order',callback_data:'cust_order_'+order.id},{text:'👤 Menu',callback_data:'cust_menu'}]]}}
    );

    const oid=await ownerId();
    if(oid){
      const caption='📸 NEW PAYMENT PROOF #'+proofId+'\nOrder #'+order.id+'\nPlan: '+(order.plan_title||'-')+'\nPrice: '+(order.price_text||'-')+'\nUser: '+msg.from.id+' '+(msg.from.username?'@'+msg.from.username:'');
      const opts={caption,reply_markup:{inline_keyboard:[[
        {text:'✅ Approve',callback_data:'plus_proofapprove_'+proofId},
        {text:'❌ Reject',callback_data:'plus_proofreject_'+proofId}
      ]]}};
      try {
        if(fileType==='photo') await bot.sendPhoto(oid,fileId,opts);
        else await bot.sendDocument(oid,fileId,opts);
      } catch {}
    }
  }

  bot.onText(/^\/start(?:@\w+)?$/, async msg=>{
    if(msg.chat.type!=='private' || isOwnerUser(msg.from)) return;
    await trackUser(msg.from,{chatId:msg.chat.id,chatType:msg.chat.type}).catch(()=>{});
    return menu(msg.chat.id,msg.from);
  });

  bot.onText(/^\/plans(?:@\w+)?$/, async msg=>{
    if(msg.chat.type!=='private' || isOwnerUser(msg.from)) return;
    return showPlans(msg.chat.id);
  });

  bot.onText(/^\/myorders(?:@\w+)?$/, async msg=>{
    if(msg.chat.type!=='private' || isOwnerUser(msg.from)) return;
    return showOrders(msg.chat.id,msg.from.id);
  });

  bot.onText(/^\/mysubscription(?:@\w+)?$/, async msg=>{
    if(msg.chat.type!=='private' || isOwnerUser(msg.from)) return;
    return showSubscription(msg.chat.id,msg.from.id);
  });

  bot.onText(/^\/renew(?:@\w+)?$/, async msg=>{
    if(msg.chat.type!=='private' || isOwnerUser(msg.from)) return;
    return showPlans(msg.chat.id);
  });

  bot.on('callback_query', async q=>{
    const d=q.data||'';
    if(!d.startsWith('cust_')) return;
    if(isOwnerUser(q.from)) {
      await bot.answerCallbackQuery(q.id).catch(()=>{});
      if(!q.message || q.message.chat.type!=='private') return;
      if(d==='cust_preview_owner') return ownerPreview(q.message.chat.id);
      if(d==='cust_preview_info') return bot.answerCallbackQuery(q.id,{text:'Preview only — customer account থেকে এগুলো live কাজ করবে.',show_alert:false}).catch(()=>{});
      return;
    }
    await bot.answerCallbackQuery(q.id).catch(()=>{});
    if(!q.message || q.message.chat.type!=='private') return;
    const chatId=q.message.chat.id;
    await trackUser(q.from,{chatId,chatType:'private'}).catch(()=>{});

    if(d==='cust_menu') return menu(chatId,q.from);
    if(d==='cust_plans' || d==='cust_renew') return showPlans(chatId);
    if(d==='cust_orders') return showOrders(chatId,q.from.id);
    if(d==='cust_sub') return showSubscription(chatId,q.from.id);
    if(d==='cust_support'){
      sessions.set(q.from.id,{mode:'ticket'});
      return bot.sendMessage(chatId,
        '🎫 SUPPORT TICKET\n\nআপনার সমস্যাটা এখন লিখে পাঠান।\nPassword বা sensitive তথ্য দেবেন না।',
        {reply_markup:{inline_keyboard:[[{text:'❌ Cancel',callback_data:'cust_input_cancel'}]]}}
      );
    }
    if(d==='cust_device'){
      sessions.set(q.from.id,{mode:'device'});
      return bot.sendMessage(chatId,
        '📱 DEVICE CHANGE REQUEST\n\nAccount/Gmail এবং নতুন device-এর দরকারি details লিখে পাঠান। Password দেবেন না।',
        {reply_markup:{inline_keyboard:[[{text:'❌ Cancel',callback_data:'cust_input_cancel'}]]}}
      );
    }
    if(d==='cust_contact'){
      const tg=(await getSetting('contact_telegram',OWNER_USERNAME)).replace(/^@/,'');
      const wa=(await getSetting('contact_whatsapp','')).replace(/[^0-9]/g,'');
      const kb=[];
      kb.push([{text:'✈️ Telegram @'+tg,url:'https://t.me/'+tg}]);
      if(wa) kb.push([{text:'📱 WhatsApp',url:'https://wa.me/'+wa}]);
      kb.push([{text:'⬅️ Customer Menu',callback_data:'cust_menu'}]);
      return bot.sendMessage(chatId,
        '☎️ OFFICIAL CONTACT\n\nশুধু এই official contact-এ যোগাযোগ করুন। Payment number bot-এ public করা হয় না।',
        {reply_markup:{inline_keyboard:kb}}
      );
    }
    if(d==='cust_input_cancel'){
      sessions.delete(q.from.id);
      return bot.sendMessage(chatId,'❌ Cancelled.',{reply_markup:{inline_keyboard:[[{text:'⬅️ Customer Menu',callback_data:'cust_menu'}]]}});
    }
    if(d==='cust_proof_cancel'){
      sessions.delete(q.from.id);
      return bot.sendMessage(chatId,'❌ Payment proof upload cancelled.',{
        reply_markup:{inline_keyboard:[[{text:'⬅️ Customer Menu',callback_data:'cust_menu'}]]}
      });
    }
    if(d.startsWith('cust_order_')){
      const id=Number(d.replace('cust_order_',''));
      return showOrder(chatId,q.from.id,id);
    }
    if(d.startsWith('cust_proof_')){
      const id=Number(d.replace('cust_proof_',''));
      return startProof(chatId,q.from,id);
    }
  });

  bot.on('message', async msg=>{
    if(!msg.from || isOwnerUser(msg.from) || msg.chat.type!=='private') return;
    const s=sessions.get(msg.from.id);
    if(!s) return;
    if(msg.text?.startsWith('/')) return;
    if(s.mode==='proof') return saveProof(msg,s);

    if(s.mode==='ticket'){
      const text=(msg.text||'').trim();
      if(!text) return bot.sendMessage(msg.chat.id,'আপনার সমস্যাটা text হিসেবে লিখুন।');
      const r=await pool.query(
        "INSERT INTO support_tickets(user_id,username,chat_id,message_id,text) VALUES($1,$2,$3,$4,$5) RETURNING id",
        [msg.from.id,msg.from.username||null,msg.chat.id,msg.message_id,text]
      );
      sessions.delete(msg.from.id);
      const id=r.rows[0].id;
      await bot.sendMessage(msg.chat.id,'✅ Support Ticket #'+id+' তৈরি হয়েছে। Owner reply করলে এখানে পাবেন।',{
        reply_markup:{inline_keyboard:[[{text:'👤 Customer Dashboard',callback_data:'cust_menu'}]]}
      });
      const oid=await ownerId();
      if(oid) try {
        await bot.sendMessage(oid,'🎫 NEW CUSTOMER TICKET #'+id+'\nUser: '+msg.from.id+' '+(msg.from.username?'@'+msg.from.username:'')+'\n\n'+text,{
          reply_markup:{inline_keyboard:[[{text:'💬 Reply',callback_data:'grp_reply_'+id},{text:'✅ Close',callback_data:'grp_close_'+id}]]}
        });
      } catch {}
      return;
    }

    if(s.mode==='device'){
      const details=(msg.text||'').trim();
      if(!details) return bot.sendMessage(msg.chat.id,'Device change details text হিসেবে লিখুন।');
      const r=await pool.query(
        "INSERT INTO device_requests(user_id,username,chat_id,message_id,details) VALUES($1,$2,$3,$4,$5) RETURNING id",
        [msg.from.id,msg.from.username||null,msg.chat.id,msg.message_id,details]
      );
      sessions.delete(msg.from.id);
      const id=r.rows[0].id;
      await bot.sendMessage(msg.chat.id,'✅ Device Change Request #'+id+' পাঠানো হয়েছে।',{
        reply_markup:{inline_keyboard:[[{text:'👤 Customer Dashboard',callback_data:'cust_menu'}]]}
      });
      const oid=await ownerId();
      if(oid) try {
        await bot.sendMessage(oid,'📱 NEW DEVICE REQUEST #'+id+'\nUser: '+msg.from.id+' '+(msg.from.username?'@'+msg.from.username:'')+'\n\n'+details,{
          reply_markup:{inline_keyboard:[[{text:'✅ Approve',callback_data:'biz_devapprove_'+id},{text:'❌ Reject',callback_data:'biz_devreject_'+id}]]}
        });
      } catch {}
      return;
    }
  });

  init().catch(e=>console.error('Customer portal init error:',e));
};