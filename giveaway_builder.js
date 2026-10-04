const crypto = require('crypto');

module.exports = function setupGiveawayBuilder(ctx) {
  const { bot, pool, isOwnerUser, getSetting, CHANNEL, TOKEN } = ctx;
  const sessions = new Map();

  function key() {
    return crypto.createHash('sha256').update(String(TOKEN)+'|mahadi-tools-giveaway-v1').digest();
  }

  function encrypt(obj) {
    const iv=crypto.randomBytes(12);
    const cipher=crypto.createCipheriv('aes-256-gcm',key(),iv);
    const enc=Buffer.concat([cipher.update(JSON.stringify(obj),'utf8'),cipher.final()]);
    const tag=cipher.getAuthTag();
    return Buffer.concat([iv,tag,enc]).toString('base64');
  }

  function decrypt(text) {
    const b=Buffer.from(text,'base64');
    const iv=b.subarray(0,12),tag=b.subarray(12,28),enc=b.subarray(28);
    const decipher=crypto.createDecipheriv('aes-256-gcm',key(),iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(enc),decipher.final()]).toString('utf8'));
  }

  async function init() {
    await pool.query(
      "CREATE TABLE IF NOT EXISTS scheduled_giveaways ("+
      "id SERIAL PRIMARY KEY, payload_enc TEXT NOT NULL, target TEXT NOT NULL, schedule_at TIMESTAMPTZ NOT NULL, "+
      "status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW(), published_at TIMESTAMPTZ)"
    );
    console.log('Giveaway builder module ready');
  }

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

  function omanDateAt(hour,minute) {
    const now=new Date();
    const omanNow=new Date(now.getTime()+4*3600000);
    const y=omanNow.getUTCFullYear();
    const m=String(omanNow.getUTCMonth()+1).padStart(2,'0');
    const d=String(omanNow.getUTCDate()).padStart(2,'0');
    return new Date(y+'-'+m+'-'+String(d).padStart(2,'0')+'T'+String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0')+':00+04:00');
  }

  function parseOmanTime(v) {
    const s=String(v||'').trim();
    let m=s.match(/^(\d{1,2}):(\d{2})$/);
    if(m){
      const h=Number(m[1]),min=Number(m[2]);
      if(h>23||min>59)return null;
      let dt=omanDateAt(h,min);
      if(dt.getTime()<=Date.now()) dt=new Date(dt.getTime()+86400000);
      return dt;
    }
    m=s.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})$/);
    if(m){
      const h=Number(m[2]),min=Number(m[3]);
      if(h>23||min>59)return null;
      return new Date(m[1]+'T'+String(h).padStart(2,'0')+':'+String(min).padStart(2,'0')+':00+04:00');
    }
    return null;
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
    return bot.sendMessage(chatId,'এখন Publish অথবা Schedule করুন:',{
      reply_markup:{inline_keyboard:[
        [{text:'📢 Channel Now',callback_data:'give_pub_channel'},{text:'👥 Group Now',callback_data:'give_pub_group'}],
        [{text:'📢 Channel + Group Now',callback_data:'give_pub_both'}],
        [{text:'⏰ 6:00 PM Oman',callback_data:'give_sched6'}],
        [{text:'🕒 Custom Schedule',callback_data:'give_sched_custom'},{text:'📋 Scheduled',callback_data:'give_scheduled'}],
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

  async function publishData(data,where) {
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
    return {ch,gr};
  }

  async function publish(chatId,userId,where) {
    const s=sessions.get(userId);
    if(!s || s.step!=='ready') return bot.sendMessage(chatId,'Giveaway data পাওয়া যায়নি। আবার শুরু করুন।');
    const r=await publishData(s.data,where);
    sessions.delete(userId);
    let msg='✅ GIVEAWAY POST RESULT\n\n';
    if(where==='channel' || where==='both') msg+='📢 Channel: '+(r.ch?'Published ✅':'Failed ❌')+'\n';
    if(where==='group' || where==='both') msg+='👥 Group: '+(r.gr?'Published ✅':'Not connected / failed ❌')+'\n';
    return bot.sendMessage(chatId,msg);
  }

  async function schedule(chatId,userId,when,where='channel') {
    const s=sessions.get(userId);
    if(!s || s.step!=='ready') return bot.sendMessage(chatId,'Giveaway data পাওয়া যায়নি। আবার শুরু করুন।');
    if(!when || isNaN(when.getTime()) || when.getTime()<=Date.now()) return bot.sendMessage(chatId,'Future time দিন।');
    const r=await pool.query(
      "INSERT INTO scheduled_giveaways(payload_enc,target,schedule_at) VALUES($1,$2,$3) RETURNING id",
      [encrypt(s.data),where,when]
    );
    sessions.delete(userId);
    return bot.sendMessage(chatId,
      '⏰ Giveaway Scheduled ✅\n\n'+
      'ID: #'+r.rows[0].id+'\n'+
      'Oman time: '+when.toLocaleString('en-GB',{timeZone:'Asia/Muscat'})+'\n'+
      'Target: '+where.toUpperCase()
    );
  }

  async function showScheduled(chatId) {
    const r=await pool.query(
      "SELECT id,target,schedule_at FROM scheduled_giveaways WHERE status='pending' ORDER BY schedule_at LIMIT 12"
    );
    if(!r.rows.length) return bot.sendMessage(chatId,'📋 কোনো scheduled giveaway নেই।');
    return bot.sendMessage(chatId,'📋 SCHEDULED GIVEAWAYS',{
      reply_markup:{inline_keyboard:r.rows.map(x=>[
        {text:'#'+x.id+' • '+new Date(x.schedule_at).toLocaleString('en-GB',{timeZone:'Asia/Muscat'}),callback_data:'give_noop_'+x.id},
        {text:'❌',callback_data:'give_del_'+x.id}
      ])}
    });
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
    if(d==='give_sched6'){
      const s=sessions.get(q.from.id);
      if(!s || s.step!=='ready') return bot.sendMessage(chatId,'আগে Giveaway বানিয়ে Preview পর্যন্ত যান।');
      let when=omanDateAt(18,0);
      if(when.getTime()<=Date.now()) when=new Date(when.getTime()+86400000);
      s.step='schedule_target'; s.when=when; sessions.set(q.from.id,s);
      return bot.sendMessage(chatId,
        '⏰ Schedule time: '+when.toLocaleString('en-GB',{timeZone:'Asia/Muscat'})+' Oman\n\nকোথায় যাবে?',{
          reply_markup:{inline_keyboard:[
            [{text:'📢 Channel',callback_data:'give_target_channel'},{text:'👥 Group',callback_data:'give_target_group'}],
            [{text:'📢 Channel + Group',callback_data:'give_target_both'}]
          ]}
        }
      );
    }
    if(d==='give_sched_custom'){
      const s=sessions.get(q.from.id);
      if(!s || s.step!=='ready') return bot.sendMessage(chatId,'আগে Giveaway বানিয়ে Preview পর্যন্ত যান।');
      s.step='schedule_time'; sessions.set(q.from.id,s);
      return bot.sendMessage(chatId,'🕒 Oman time দিন।\nExample: 18:00\nঅথবা: 2026-10-04 18:00');
    }
    if(d==='give_scheduled') return showScheduled(chatId);
    if(d.startsWith('give_del_')){
      const id=Number(d.replace('give_del_',''));
      await pool.query("UPDATE scheduled_giveaways SET status='cancelled' WHERE id=$1 AND status='pending'",[id]);
      return bot.sendMessage(chatId,'❌ Scheduled giveaway #'+id+' cancelled.');
    }
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
    if(s.step==='schedule_time'){
      const when=parseOmanTime(v);
      if(!when || isNaN(when.getTime()) || when.getTime()<=Date.now()) return bot.sendMessage(msg.chat.id,'সময় বুঝিনি। Example: 18:00 অথবা 2026-10-04 18:00');
      s.step='schedule_target'; s.when=when; sessions.set(msg.from.id,s);
      return bot.sendMessage(msg.chat.id,'কোথায় scheduled post যাবে?',{
        reply_markup:{inline_keyboard:[
          [{text:'📢 Channel',callback_data:'give_target_channel'},{text:'👥 Group',callback_data:'give_target_group'}],
          [{text:'📢 Channel + Group',callback_data:'give_target_both'}]
        ]}
      });
    }
  });

  bot.on('callback_query',async q=>{
    const d=q.data||'';
    if(!d.startsWith('give_target_')) return;
    if(!isOwnerUser(q.from)) return;
    await bot.answerCallbackQuery(q.id).catch(()=>{});
    const s=sessions.get(q.from.id);
    if(!s || s.step!=='schedule_target' || !s.when) return;
    const where=d.replace('give_target_','');
    if(!['channel','group','both'].includes(where)) return;
    s.step='ready'; sessions.set(q.from.id,s);
    return schedule(q.message.chat.id,q.from.id,s.when,where);
  });

  setInterval(async ()=>{
    try {
      const r=await pool.query(
        "SELECT id,payload_enc,target FROM scheduled_giveaways WHERE status='pending' AND schedule_at<=NOW() ORDER BY schedule_at LIMIT 5"
      );
      for(const row of r.rows){
        try {
          const data=decrypt(row.payload_enc);
          const out=await publishData(data,row.target);
          const ok=(row.target==='channel'&&out.ch)||(row.target==='group'&&out.gr)||(row.target==='both'&&out.ch&&out.gr);
          await pool.query(
            "UPDATE scheduled_giveaways SET status=$2,published_at=CASE WHEN $2='published' THEN NOW() ELSE published_at END WHERE id=$1",
            [row.id,ok?'published':'failed']
          );
        } catch(e) {
          console.error('Scheduled giveaway error:',row.id,e.message);
          await pool.query("UPDATE scheduled_giveaways SET status='failed' WHERE id=$1",[row.id]).catch(()=>{});
        }
      }
    } catch(e) {
      console.error('Giveaway scheduler error:',e.message);
    }
  },30000);

  init().catch(e=>console.error('Giveaway builder init error:',e));
};