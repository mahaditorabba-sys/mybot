const crypto = require('crypto');

module.exports = function setupGiveawayBuilder(ctx) {
  const { bot, pool, isOwnerUser, getSetting, CHANNEL, TOKEN, OWNER_USERNAME } = ctx;
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
    if(d.rawText) return d.rawText;
    return [
      '🎁 ' + (d.title || 'MAHADI TOOLS GIVEAWAY'),
      '',
      d.intro || 'GIVEAWAY ACCESS',
      '',
      '📧 EMAIL',
      d.email || '',
      '',
      '🔑 PASSWORD',
      d.accessKey || '',
      '',
      '📱 DEVICE',
      d.device || '',
      '',
      '⏳ VALIDITY',
      d.validity || '',
      '',
      '🌐 MAHADI TOOLS',
      d.url || ''
    ].join('\n');
  }

  function publishKeyboard(d) {
    const text=buildText(d);
    const rows=[];
    const urls=text.match(/https?:\/\/[^\s]+/gi)||[];
    const directTelegram=urls.map(x=>x.replace(/[),.]+$/,'')).find(x=>/^https?:\/\/(?:www\.)?t\.me\/[A-Za-z0-9_]{5,}$/i.test(x));
    const mentionMatches=[...text.matchAll(/(^|[\s(>:\-])@([A-Za-z0-9_]{5,})\b/gm)];
    const mention=mentionMatches.length ? mentionMatches[mentionMatches.length-1][2] : '';
    const username=(directTelegram ? directTelegram.split('/').pop() : '') || mention || OWNER_USERNAME;
    const website=urls.find(x=>!/^https?:\/\/(?:www\.)?t\.me\//i.test(x));

    if(username) rows.push([{text:'✈️ Telegram Inbox',url:'https://t.me/'+String(username).replace(/^@/,'')}]);
    if(website) rows.push([{text:'🌐 Website',url:website.replace(/[),.]+$/,'')}]);
    if(!d.rawText && d.email && d.accessKey){
      rows.unshift([
        {text:'📧 Copy Email',copy_text:{text:d.email}},
        {text:'🔑 Copy Password',copy_text:{text:d.accessKey}}
      ]);
    }
    return rows.length ? {inline_keyboard:rows} : undefined;
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
    sessions.set(userId,{step:'await_content',data:{}});
    return bot.sendMessage(chatId,
      '🎁 GIVEAWAY BUILDER\n\n' +
      'একবারেই post তৈরি করুন।\n\n' +
      '📸 Poster + পুরো লেখা caption হিসেবে একসাথে পাঠান।\n' +
      'অথবা শুধু পুরো লেখাটা পাঠান।\n\n' +
      'এরপর সরাসরি Preview + Publish/Schedule দেখাবে।'
    );
  }

  async function preview(chatId,userId) {
    const s=sessions.get(userId);
    if(!s) return;
    const postText=buildText(s.data);
    const previewText='👁 PREVIEW\n\n'+postText;
    const kb=publishKeyboard(s.data);
    if(s.data.posterFileId && previewText.length<=1024){
      const opts={caption:previewText};
      if(kb) opts.reply_markup=kb;
      await bot.sendPhoto(chatId,s.data.posterFileId,opts);
    } else if(s.data.posterFileId){
      await bot.sendPhoto(chatId,s.data.posterFileId,{caption:'👁 PREVIEW'});
      const opts={disable_web_page_preview:true};
      if(kb) opts.reply_markup=kb;
      await bot.sendMessage(chatId,postText,opts);
    } else {
      const opts={disable_web_page_preview:true};
      if(kb) opts.reply_markup=kb;
      await bot.sendMessage(chatId,previewText,opts);
    }
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
    const text=buildText(data);
    const kb=publishKeyboard(data);
    if(data.posterFileId && text.length<=1024){
      const opts={caption:text};
      if(kb) opts.reply_markup=kb;
      return bot.sendPhoto(target,data.posterFileId,opts);
    }
    if(data.posterFileId){
      await bot.sendPhoto(target,data.posterFileId);
      const opts={disable_web_page_preview:true};
      if(kb) opts.reply_markup=kb;
      return bot.sendMessage(target,text,opts);
    }
    const opts={disable_web_page_preview:true};
    if(kb) opts.reply_markup=kb;
    return bot.sendMessage(target,text,opts);
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

  function nextValue(lines,labelRx) {
    for(let i=0;i<lines.length;i++){
      const line=lines[i].trim();
      if(!labelRx.test(line)) continue;
      const same=line.replace(labelRx,'').replace(/^[\s|:=-]+/,'').trim();
      if(same) return same;
      for(let j=i+1;j<Math.min(lines.length,i+4);j++){
        const n=lines[j].trim().replace(/^[|:\-]+/,'').trim();
        if(n && !/^(EMAIL|PASSWORD|DEVICE|DEVICES|VALIDITY|WEBSITE|MAHADI TOOLS)$/i.test(n)) return n;
      }
    }
    return '';
  }

  function parseFullGiveaway(text) {
    const raw=String(text||'').trim();
    if(!raw) return null;
    const lines=raw.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    const email=(raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)||[])[0]||'';
    const url=(raw.match(/https?:\/\/[^\s]+/i)||[])[0]||'';
    const password=nextValue(lines,/^(?:🔑\s*)?PASSWORD\b/i);
    const device=nextValue(lines,/^(?:📱\s*)?DEVICES?\b/i);
    const validity=nextValue(lines,/^(?:⏳\s*)?VALIDITY\b/i);
    const title=lines.find(x=>/GIVEAWAY/i.test(x) && !/GIVEAWAY ACCESS/i.test(x)) || lines[0] || 'MAHADI TOOLS GIVEAWAY';
    const intro=lines.find(x=>/GIVEAWAY ACCESS/i.test(x)) || 'GIVEAWAY ACCESS';
    if(!email || !password || !device || !validity || !url) return null;
    return {title,intro,email,accessKey:password,device,validity,url};
  }

  function mergeParsed(session,parsed) {
    const keepPoster=session.data?.posterFileId;
    session.data={...parsed};
    if(keepPoster) session.data.posterFileId=keepPoster;
    session.step='ready';
    return session;
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
    if(!s) return;

    if(s.step==='schedule_time'){
      if(!msg.text || msg.text.startsWith('/')) return;
      const when=parseOmanTime(msg.text.trim());
      if(!when || isNaN(when.getTime()) || when.getTime()<=Date.now()) {
        return bot.sendMessage(msg.chat.id,'সময় বুঝিনি। Example: 18:00 অথবা 2026-10-04 18:00');
      }
      s.step='schedule_target'; s.when=when; sessions.set(msg.from.id,s);
      return bot.sendMessage(msg.chat.id,'কোথায় scheduled post যাবে?',{
        reply_markup:{inline_keyboard:[
          [{text:'📢 Channel',callback_data:'give_target_channel'},{text:'👥 Group',callback_data:'give_target_group'}],
          [{text:'📢 Channel + Group',callback_data:'give_target_both'}]
        ]}
      });
    }

    if(msg.photo?.length){
      s.data=s.data||{};
      s.data.posterFileId=msg.photo[msg.photo.length-1].file_id;
      const cap=(msg.caption||'').trim();
      if(cap){
        s.data.rawText=cap;
        s.step='ready';
        sessions.set(msg.from.id,s);
        return preview(msg.chat.id,msg.from.id);
      }
      s.step='await_text_after_photo';
      sessions.set(msg.from.id,s);
      return bot.sendMessage(msg.chat.id,'✅ Poster পেয়েছি। এখন শুধু পুরো post লেখাটা একবারে পাঠান।');
    }

    if(!msg.text || msg.text.startsWith('/')) return;
    const v=msg.text.trim();
    if(!v) return;

    if(s.step==='await_content' || s.step==='await_text_after_photo'){
      s.data=s.data||{};
      s.data.rawText=v;
      s.step='ready';
      sessions.set(msg.from.id,s);
      return preview(msg.chat.id,msg.from.id);
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