module.exports = function setupGiveawayBuilder(ctx) {
  const { bot, isOwnerUser, getSetting, CHANNEL } = ctx;
  const sessions = new Map();

  function buildText(d) {
    return [
      '🎁 ' + (d.title || 'MAHADI TOOLS GIVEAWAY'),
      '',
      d.intro || 'GIVEAWAY ACCESS',
      '',
      '📧 EMAIL',
      d.email,
      '',
      '🔑 PASSWORD',
      d.accessKey,
      '',
      '📱 DEVICE',
      d.device,
      '',
      '⏳ VALIDITY',
      d.validity,
      '',
      '🌐 MAHADI TOOLS',
      d.url
    ].join('\n');
  }

  function publishKeyboard(d) {
    return { inline_keyboard: [
      [
        { text:'📧 Copy Email', copy_text:{ text:d.email } },
        { text:'🔑 Copy Password', copy_text:{ text:d.accessKey } }
      ],
      [{ text:'🌐 Open Mahadi Tools', url:d.url }]
    ]};
  }

  async function start(chatId,userId) {
    sessions.set(userId,{step:'title',data:{}});
    return bot.sendMessage(chatId,
      '🎁 GIVEAWAY BUILDER\n\n' +
      'Ready-made giveaway post বানাবেন।\n' +
      'প্রথমে উপরের TITLE লিখুন।\n\n' +
      'Example: 🎉 5,000 MEMBERS COMPLETE!'
    );
  }

  async function preview(chatId,userId) {
    const s=sessions.get(userId);
    if(!s) return;
    await bot.sendMessage(chatId,'👁 PREVIEW\n\n'+buildText(s.data),{
      disable_web_page_preview:true,
      reply_markup:publishKeyboard(s.data)
    });
    return bot.sendMessage(chatId,'কোথায় পোস্ট করবেন?',{
      reply_markup:{inline_keyboard:[
        [{text:'📢 Channel',callback_data:'give_pub_channel'},{text:'👥 Group',callback_data:'give_pub_group'}],
        [{text:'📢 Channel + Group',callback_data:'give_pub_both'}],
        [{text:'✏️ Edit Again',callback_data:'give_start'},{text:'❌ Cancel',callback_data:'give_cancel'}]
      ]}
    });
  }

  async function sendTo(target,data) {
    return bot.sendMessage(target,buildText(data),{
      disable_web_page_preview:true,
      reply_markup:publishKeyboard(data)
    });
  }

  async function publish(chatId,userId,where) {
    const s=sessions.get(userId);
    if(!s || s.step!=='ready') return bot.sendMessage(chatId,'Giveaway data পাওয়া যায়নি। আবার শুরু করুন।');
    const data=s.data;
    let ch=false,gr=false;

    if(where==='channel' || where==='both'){
      try { await sendTo(CHANNEL,data); ch=true; } catch(e) { console.error('Giveaway channel error:',e.message); }
    }
    if(where==='group' || where==='both'){
      const gid=await getSetting('primary_group_id','');
      if(gid){
        try { await sendTo(Number(gid),data); gr=true; } catch(e) { console.error('Giveaway group error:',e.message); }
      }
    }
    sessions.delete(userId);

    let msg='✅ GIVEAWAY POST RESULT\n\n';
    if(where==='channel' || where==='both') msg+='📢 Channel: '+(ch?'Published ✅':'Failed ❌')+'\n';
    if(where==='group' || where==='both') msg+='👥 Group: '+(gr?'Published ✅':'Not connected / failed ❌')+'\n';
    return bot.sendMessage(chatId,msg);
  }

  bot.onText(/^\/giveaway(?:@\w+)?$/, async msg=>{
    if(!isOwnerUser(msg.from) || msg.chat.type!=='private') return;
    return start(msg.chat.id,msg.from.id);
  });

  bot.on('callback_query', async q=>{
    const d=q.data||'';
    if(!d.startsWith('give_')) return;
    if(!isOwnerUser(q.from)) return bot.answerCallbackQuery(q.id,{text:'Owner only',show_alert:true}).catch(()=>{});
    await bot.answerCallbackQuery(q.id).catch(()=>{});
    if(!q.message) return;
    const chatId=q.message.chat.id;
    if(d==='give_start') return start(chatId,q.from.id);
    if(d==='give_cancel'){
      sessions.delete(q.from.id);
      return bot.sendMessage(chatId,'❌ Giveaway cancelled.');
    }
    if(d==='give_pub_channel') return publish(chatId,q.from.id,'channel');
    if(d==='give_pub_group') return publish(chatId,q.from.id,'group');
    if(d==='give_pub_both') return publish(chatId,q.from.id,'both');
  });

  bot.on('message', async msg=>{
    if(!msg.from || !isOwnerUser(msg.from) || msg.chat.type!=='private') return;
    const s=sessions.get(msg.from.id);
    if(!s || !msg.text || msg.text.startsWith('/')) return;
    const v=msg.text.trim();
    if(!v) return;

    if(s.step==='title'){
      s.data.title=v; s.step='intro'; sessions.set(msg.from.id,s);
      return bot.sendMessage(msg.chat.id,'② Giveaway-এর ছোট লেখা/intro দিন।\nExample: GIVEAWAY ACCESS');
    }
    if(s.step==='intro'){
      s.data.intro=v; s.step='email'; sessions.set(msg.from.id,s);
      return bot.sendMessage(msg.chat.id,'③ EMAIL দিন।');
    }
    if(s.step==='email'){
      s.data.email=v; s.step='access'; sessions.set(msg.from.id,s);
      return bot.sendMessage(msg.chat.id,'④ PASSWORD দিন।');
    }
    if(s.step==='access'){
      s.data.accessKey=v; s.step='device'; sessions.set(msg.from.id,s);
      return bot.sendMessage(msg.chat.id,'⑤ DEVICE লিখুন।\nExample: 5 Devices');
    }
    if(s.step==='device'){
      s.data.device=v; s.step='validity'; sessions.set(msg.from.id,s);
      return bot.sendMessage(msg.chat.id,'⑥ VALIDITY লিখুন।\nExample: Remaining 5 Days 14 Hours');
    }
    if(s.step==='validity'){
      s.data.validity=v; s.step='url'; sessions.set(msg.from.id,s);
      return bot.sendMessage(msg.chat.id,'⑦ Website/link দিন।');
    }
    if(s.step==='url'){
      if(!/^https?:\/\//i.test(v)) return bot.sendMessage(msg.chat.id,'Valid http/https link দিন।');
      s.data.url=v; s.step='ready'; sessions.set(msg.from.id,s);
      return preview(msg.chat.id,msg.from.id);
    }
  });
};