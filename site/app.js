import {dayKey,hourKey,compareEvents,spokenText,buildBehavior,selectRecords} from './model.mjs';
import {WordSphere} from './sphere.js';
const $=q=>document.querySelector(q);
const number=new Intl.NumberFormat('zh-CN');
const dateFormatter=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});
const timeFormatter=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false});
const fullDate=ts=>dateFormatter.format(new Date(ts*1000));
const timeOf=ts=>timeFormatter.format(new Date(ts*1000));
const prettyDate=value=>value.replace(/-/g,'.');
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
const state={manifest:null,key:null,index:null,insights:null,events:new Map(),pending:new Map(),behavior:null,wordSide:'both',
  period:'all',month:'',sphere:null,filter:{},page:1,recordGeneration:0,session:0,urls:new Set(),abort:null};
function el(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=String(text);return node;}
function button(className,text,action){const node=el('button',className,text);node.type='button';if(action)node.addEventListener('click',action);return node;}
function toast(text){const node=$('#globalStatus');node.textContent=text;node.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>{node.hidden=true;},3500);}
function openDialog(node){if(typeof node.showModal==='function'){if(!node.open)node.showModal();}else node.setAttribute('open','');document.body.style.overflow='hidden';state.sphere?.suspend(true);}
function closeDialog(node){if(typeof node.close==='function')node.close();else node.removeAttribute('open');if(!$('#recordDialog').open&&!$('#imageDialog').open){document.body.style.overflow='';state.sphere?.suspend(false);}}
function clearMedia(){document.querySelectorAll('audio,video').forEach(n=>n.pause());for(const url of state.urls)URL.revokeObjectURL(url);state.urls.clear();}
function decode64(text){return Uint8Array.from(atob(text),c=>c.charCodeAt(0));}
async function readCipher(path,key=state.key){
  if(!/^(data|assets)\/[a-f0-9]{32}\.bin$/.test(path))throw new Error('记录路径有误');
  const response=await fetch(path,{cache:'force-cache',credentials:'same-origin',signal:state.abort?.signal});
  if(!response.ok)throw new Error('这一页暂时没载入，稍后再试一次。');
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.length<29)throw new Error('这一页记录不完整');
  return crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12),additionalData:new TextEncoder().encode(path)},key,bytes.slice(12));
}
async function readJSON(path,key=state.key){
  let bytes=new Uint8Array(await readCipher(path,key));
  if(bytes[0]===31&&bytes[1]===139){
    if(globalThis.fflate?.gunzipSync)bytes=globalThis.fflate.gunzipSync(bytes);
    else if(typeof DecompressionStream!=='undefined')bytes=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    else throw new Error('请更新微信，或用手机浏览器打开这本纪念册。');
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function fetchMonths(descriptors){
  const key=state.key,session=state.session;let cursor=0,done=0;
  await Promise.all(Array.from({length:Math.min(4,descriptors.length)},async()=>{
    while(cursor<descriptors.length){
      const month=descriptors[cursor++];
      if(!state.events.has(month.month)){
        if(!state.pending.has(month.month)){
          const request=readJSON(month.path,key).then(data=>{
            if(key!==state.key||session!==state.session)throw new DOMException('纪念册已合上','AbortError');
            if(!Array.isArray(data.events))throw new Error('这一页的格式暂时无法识别');
            state.events.set(month.month,data.events);
          });
          state.pending.set(month.month,request);
          request.finally(()=>{if(state.pending.get(month.month)===request)state.pending.delete(month.month);}).catch(()=>{});
        }
        await state.pending.get(month.month);
      }
      done++;
    }
  }));
  if(key!==state.key)throw new DOMException('纪念册已合上','AbortError');
  return descriptors.flatMap(month=>state.events.get(month.month)||[]).sort(compareEvents);
}
function scopedFilter(filter){
  const value={...filter};
  const scope=filter.phase?state.insights.phases[filter.phase]:filter.period&&filter.period!=='all'?state.insights.periods[filter.period]:null;
  if(scope){const starts=[value.start,scope.range_start].filter(Boolean).sort();value.start=starts[starts.length-1];value.end=[value.end,scope.range_end].filter(Boolean).sort()[0];}
  return value;
}
function analyticFilter(){return scopedFilter({period:state.period,month:state.month,humanOnly:true});}
function currentStats(){return state.month?state.insights.months[state.month]:state.insights.periods[state.period];}
function fitMonths(filter){
  if(filter.behavior)return state.index.months.filter(m=>m.messages);
  if(filter.context){const target=[...state.events.values()].flat().find(e=>e.id===filter.context);return target?.kind==='moment'?state.index.months.filter(m=>m.month===dayKey(target.timestamp).slice(0,7)):state.index.months.filter(m=>m.messages);}
  const ids=filter.ids?new Set(filter.ids):null;
  const known=ids?[...state.insights.first_words.flatMap(x=>[x.first,x.mine,x.hers]),...state.insights.calls].filter(Boolean).filter(x=>ids.has(x.id)):null;
  let selected=state.index.months.filter(month=>{
    const isMoment=['moment','momentPair'].includes(filter.kind);
    if(isMoment&&!month.moments)return false;
    if(!isMoment&&!month.messages)return false;
    if(filter.month&&month.month!==filter.month)return false;
    if(filter.day&&month.month!==filter.day.slice(0,7))return false;
    if(filter.start&&month.month<filter.start.slice(0,7))return false;
    if(filter.end&&month.month>filter.end.slice(0,7))return false;
    return true;
  });
  if(ids&&known&&known.length===ids.size){const wanted=new Set(known.map(e=>dayKey(e.timestamp).slice(0,7)));selected=selected.filter(m=>wanted.has(m.month));}
  return selected;
}
function showStats(){
  const stats=currentStats(),scope=analyticFilter();
  $('#monthChart').replaceChildren();
  const max=Math.max(1,...stats.months.map(m=>m.total));
  for(const row of stats.months){
    const node=button('month-col'+(state.month===row.month?' active':''),'',()=>openRecords({month:row.month,period:state.period,humanOnly:true},row.month.replace('-','年')+'月的聊天'));
    node.title=row.month+' · '+number.format(row.total)+' 条';node.setAttribute('aria-label',node.title+'，点击查看原话');
    const stack=el('span','month-stack');stack.style.height=Math.max(3,row.total/max*166)+'px';
    for(const [who,style] of [['mine','bar-mine'],['hers','bar-hers']]){const part=el('span',style);part.style.height=(row[who]/Math.max(1,row.total)*100)+'%';stack.append(part);}
    node.append(el('span','bar-count',number.format(row.total)),stack,el('span','month-label',row.month.slice(2)));$('#monthChart').append(node);
  }
  $('#monthNote').textContent='点击柱形查看当月原话 · 双方消息，不含系统记录。首末月份仅按已归档日期统计。';
  $('#initiativeFigures').replaceChildren();$('#initiativeTrack').replaceChildren();$('#replyFigures').replaceChildren();
  const totalStarts=(stats.initiations.mine||0)+(stats.initiations.hers||0);
  for(const who of ['mine','hers']){
    const label=who==='mine'?'我':state.index.profile.herName||'她',count=stats.initiations[who]||0;
    const node=button('','',()=>openRecords({...scope,behavior:'starts',sender:who},label+'先说的那些话'));
    node.append(el('span','',label),el('strong','',number.format(count)),el('small','',totalStarts?(count/totalStarts*100).toFixed(1)+'% 的开场':'暂无可统计开场'));$('#initiativeFigures').append(node);
    const segment=el('i');segment.style.width=count/Math.max(1,totalStarts)*100+'%';$('#initiativeTrack').append(segment);
    const reply=stats.replies[who],card=el('div','reply-person');card.append(el('span','',label));
    const median=el('strong','',reply.median_seconds===null?'—':String(reply.median_seconds));median.append(el('small','','秒'));card.append(median);
    card.append(el('p','','典型回复间隔 · 中位数'));
    const instant=button('','10 秒内回复',()=>openRecords({...scope,behavior:'replies',instant:true,sender:who},label+'的 10 秒内回应'));
    instant.append(el('span','',reply.instant_rate===null?'—':(reply.instant_rate*100).toFixed(1)+'%'));card.append(instant);$('#replyFigures').append(card);
  }
  const hourly=Array.from({length:24},(_,h)=>(stats.hourly.mine[h]||0)+(stats.hourly.hers[h]||0)),peak=hourly.indexOf(Math.max(...hourly));
  $('#hourChart').replaceChildren();
  for(let h=0;h<24;h++){
    const node=button('hour-bar','',()=>openRecords({...scope,hour:h},String(h).padStart(2,'0')+':00 的我们'));
    const label=String(h).padStart(2,'0')+':00 · '+number.format(hourly[h])+' 条';node.dataset.label=label;node.setAttribute('aria-label',label+'，查看原话');
    const stack=el('span');stack.style.height=Math.max(1,hourly[h]/Math.max(1,...hourly)*100)+'%';
    for(const [who,style] of [['mine','bar-mine'],['hers','bar-hers']]){const bar=el('i',style);bar.style.height=(stats.hourly[who][h]/Math.max(1,hourly[h])*100)+'%';stack.append(bar);}
    node.append(stack);$('#hourChart').append(node);
  }
  $('#peakHour').textContent=String(peak).padStart(2,'0')+':00—'+String(peak+1).padStart(2,'0')+':00 最活跃';
  $('#expressionChart').replaceChildren();
  const maxDensity=Math.max(1,...stats.months.map(m=>m.affection/Math.max(1,m.total)*1000));
  for(const row of stats.months){
    const density=row.affection/Math.max(1,row.total)*1000;
    const node=button('month-col expression-col','',()=>openRecords({...scope,month:row.month,expression:true},'那个月，关于想念与喜欢的词','按相关词语匹配，点“前后文”可以结合语境看。'));
    node.setAttribute('aria-label',row.month+' 亲密相关用词 '+row.affection+' 条，查看原话');
    const bar=el('span','expression-bar');bar.style.height=Math.max(2,density/maxDensity*100)+'px';
    node.append(el('span','density-label',density.toFixed(1)),bar,el('span','month-label',row.month.slice(2)));$('#expressionChart').append(node);
  }
  $('#styleGrid').replaceChildren();
  for(const who of ['mine','hers']){
    const label=who==='mine'?'我':state.index.profile.herName||'你',rows=stats.styles[who].slice(0,3),person=el('div','style-person');
    person.append(el('h4','',label));
    const maxStyle=Math.max(1,...rows.map(row=>row.count));
    for(const row of rows){
      const node=button('style-row','',()=>openRecords({...scope,style:row.id,sender:who},label+'的'+row.label,'按常见表达归类，同一句可能属于多种风格。'));
      const text=el('span','style-label',row.label);text.append(el('small','',row.count+' 条 ↗'));
      const track=el('span','style-track'),fill=el('i');fill.style.width=row.count/maxStyle*100+'%';track.append(fill);node.append(text,track);person.append(node);
    }
    $('#styleGrid').append(person);
  }
  refreshCloud();
}
function refreshCloud(){
  const words=currentStats().words[state.wordSide]||[];
  state.sphere?.setWords(words);
  $('#wordHighlights').replaceChildren();
  const all=currentStats().words.both,preferred=['喜欢','想你','好吃','小猫','晚安','学校'];
  const items=preferred.map(word=>all.find(x=>x.word===word)).filter(Boolean).slice(0,5);
  for(const item of items){const node=button('word-chip',item.word,()=>openWord(item,'both'));node.append(el('small','',item.count+' 次'));$('#wordHighlights').append(node);}
}
function openWord(item,side=state.wordSide){openRecords({...analyticFilter(),word:item.word,sender:side==='both'?undefined:side},'说起“'+item.word+'”的时候','词云统计 '+item.count+' 次用词；下方按含这个词的消息展示，同一句可能重复使用。');}
function renderStory(){
  const data=state.insights;
  $('#originQuote').textContent=data.relationship_origin.quote;
  $('#originDescription').textContent=data.relationship_origin.description;
  $('#originButton').onclick=()=>openRecords({ids:data.relationship_origin.related_ids},'那句“重亲”，和后来的话','从出发前的那句话，翻到后来把喜欢说清楚。');
  $('#storyList').replaceChildren();
  for(const item of data.milestones){
    const row=el('article','story-step'),body=el('div');row.append(el('span','story-dot'));
    const date=el('time','',prettyDate(item.date));date.dateTime=item.date;
    body.append(date,el('h3','',item.title),el('p','',item.note),button('','看看那天说了什么 ↗',()=>openRecords({day:item.date},item.title)));
    row.append(body);$('#storyList').append(row);
  }
  $('#journeyGrid').replaceChildren();
  for(const trip of data.travels){
    const node=button('journey-card','',()=>openRecords({start:trip.start,end:trip.end},'一起在'+trip.city+'的日子','把这几天的聊天，再慢慢翻一遍。'));
    node.append(el('small','',prettyDate(trip.start)+' — '+trip.end.slice(5).replace('-','.')),el('h3','',trip.city),el('p','',trip.subtitle),el('span','trip-arrow','↗'),el('span','city-contour'));$('#journeyGrid').append(node);
  }
}
function renderPhases(){
  $('#phaseGrid').replaceChildren();
  const items=[['everyday','确定喜欢之前'],['crush','确定喜欢的日子之后'],['together','成为我们之后']];
  for(const [key,label] of items){
    const row=state.insights.phases[key],node=button('phase-card','',()=>openRecords({phase:key,humanOnly:true},label));
    node.append(el('span','',label),el('strong','',row.daily_average.toFixed(1)),el('p','','条 / 每个自然日'),el('i','','↗'));$('#phaseGrid').append(node);
  }
}
function renderCalendar(){
  const grid=$('#calendarGrid');grid.replaceChildren();
  const counts=state.index.dailyCounts,start=dayKey(state.index.stats.firstTimestamp),end=dayKey(state.index.stats.lastTimestamp);
  const first=new Date(start+'T00:00:00Z'),last=new Date(end+'T00:00:00Z'),offset=(first.getUTCDay()+6)%7;
  for(let i=0;i<offset;i++)grid.append(el('span','calendar-day empty'));
  for(let date=new Date(first);date<=last;date.setUTCDate(date.getUTCDate()+1)){
    const day=date.toISOString().slice(0,10),count=counts[day]||0,node=button('calendar-day','',()=>openRecords({day,humanOnly:true},prettyDate(day)+' 的我们'));
    node.dataset.level=count===0?'0':count<20?'1':count<80?'2':count<200?'3':'4';node.title=prettyDate(day)+' · '+count+' 条';
    node.setAttribute('aria-label',node.title+'，查看记录');node.disabled=count===0;grid.append(node);
  }
}
function renderMemories(){
  $('#firstWords').replaceChildren();
  const labels={miss:'第一次说想念',like:'把喜欢说出口',kiss:'聊起我们的亲吻',hug:'关于拥抱',pet:'一句亲昵的称呼',night:'把晚安说给你'};
  for(const item of state.insights.first_words.filter(e=>e.first)){
    const first=item.first,ids=[item.mine?.id,item.hers?.id].filter(Boolean);
    const node=button('first-word-card','',()=>openRecords({ids},labels[item.id]||item.label,'按现有记录检索并复核语境；日期是消息时间。可以继续点“看看前后文”。'));
    node.append(el('small','',prettyDate(dayKey(first.timestamp))),el('h3','',labels[item.id]||item.label),el('blockquote','','“'+(first.text.length>46?first.text.slice(0,46)+'…':first.text)+'”'),el('span','',first.sent?'我说的':(state.index.profile.herName||'她')+'说的'),el('i','','↗'));$('#firstWords').append(node);
  }
  $('#analysisGrid').replaceChildren();
  const all=state.insights.periods.all;
  const notes=[
    {label:'FROM ORDINARY TO EVERYDAY',title:'喜欢，先藏在日常里。',text:'从确定喜欢的那天起，连续 '+state.insights.scope.consecutive_days_since_crush+' 天都有聊天。后来，很多平常的一句话，终于组成了“我们”。',filter:{phase:'crush',humanOnly:true}},
    {label:'A LITTLE GIVE AND TAKE',title:'你一句，我一句。',text:'我留下 '+number.format(all.counts.mine)+' 条消息，你留下 '+number.format(all.counts.hers)+' 条。典型回复间隔都在十几秒，互相接住的话，有具体的样子。',filter:{behavior:'replies',instant:true}},
    {label:'YOUR VOICE, KEPT HERE',title:'喜欢听你，把日常说完。',text:'原声和文字一起留着。那些聊过的日常，还能从声音里再遇见一次。点开这一段，看看当时怎样说起彼此的声音。',filter:{ids:[state.insights.analysis_sources.voice_quote_id]}}
  ];
  for(const item of notes){const node=button('analysis-note','',()=>openRecords(item.filter,item.title));node.append(el('small','eyebrow',item.label),el('h3','',item.title),el('p','',item.text),el('span','','回到原话 ↗'));$('#analysisGrid').append(node);}
}
function activate(index,insights){
  state.index=index;state.insights=insights;state.events.clear();state.behavior=null;state.period='all';state.month='';state.wordSide='both';
  $('#dedication').textContent='写给'+(index.profile.herName||'你')+' · 一份日常珍藏';
  const days=insights.scope.consecutive_days_since_crush;
  $('#heroDays').textContent=String(days);$('#statDays').textContent=number.format(days);$('#statMessages').textContent=number.format(index.stats.messages);$('#statVoices').textContent=number.format(index.stats.voices);
  $('#heroQuote').textContent='很多句，都是想你。';
  $('#coverDate').textContent=fullDate(index.stats.firstTimestamp)+' — '+fullDate(index.stats.lastTimestamp);
  $('#archiveRange').textContent='归档至 '+fullDate(index.stats.lastTimestamp);
  $('#callSummary').textContent=insights.call_summary.records+' 条记录 · 接通约 '+Math.round(insights.call_summary.duration_seconds/60)+' 分钟';
  $('#periodSelect').value='all';$('#analyticsMonth').replaceChildren(new Option('全部月份',''));
  for(const month of Object.keys(insights.months).sort())$('#analyticsMonth').append(new Option(month.replace('-','年')+'月',month));
  $('#lockScreen').hidden=true;$('#appRoot').hidden=false;document.body.style.overflow='';
  state.sphere=new WordSphere($('#wordSphere'),item=>openWord(item));
  for(const item of $('#wordSides').querySelectorAll('button')){const active=item.dataset.side==='both';item.classList.toggle('active',active);item.setAttribute('aria-pressed',String(active));}
  $('#cloudMotion').textContent=state.sphere.paused?'开始转动 ↻':'暂停转动 Ⅱ';
  $('#cloudMotion').setAttribute('aria-label',state.sphere.paused?'开始词云转动':'暂停词云转动');
  renderStory();renderPhases();renderCalendar();renderMemories();showStats();
  for(const node of document.querySelectorAll('.chapter .section-heading,.phase-grid,.chart-card,.archive-gates')){node.classList.add('reveal');revealObserver.observe(node);}
}
const revealObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){entry.target.classList.add('visible');revealObserver.unobserve(entry.target);}},{threshold:.05});
function filterLabels(filter){
  const labels=[];
  if(filter.word)labels.push('词语：'+filter.word);
  if(filter.search)labels.push('搜索：'+filter.search);
  if(filter.day)labels.push(prettyDate(filter.day));
  else if(filter.start||filter.end)labels.push((filter.start||'')+' — '+(filter.end||''));
  if(filter.month)labels.push(filter.month);
  if(filter.sender)labels.push(filter.sender==='mine'?'我说的':'你说的');
  if(Number.isInteger(filter.hour))labels.push(String(filter.hour).padStart(2,'0')+':00—'+String(filter.hour+1).padStart(2,'0')+':00');
  if(filter.behavior==='starts')labels.push('间隔 ≥4 小时后的开场');
  if(filter.behavior==='replies')labels.push(filter.instant?'10 秒内回应':'相邻双方的回应');
  if(filter.context)labels.push('这条消息的前后文');
  if(filter.ids)labels.push('选中的原话');
  if(filter.expression)labels.push('亲密相关用词');
  if(filter.style)labels.push('表达习惯');
  return labels;
}
function populateRecordMonths(){
  const select=$('#recordMonth');select.replaceChildren(new Option('全部月份',''));
  for(const month of [...state.index.months].reverse()){
    const moments=['moment','momentPair'].includes(state.filter.kind);
    if(moments?!month.moments:!month.messages)continue;
    select.append(new Option(month.month.replace('-','年')+'月',month.month));
  }
  select.value=state.filter.month||'';
}
async function openRecords(filter={},title='我们的记录',note=''){
  clearMedia();state.filter=scopedFilter(filter);state.recordNote=note;state.page=1;state.recordTitle=title;
  $('#recordTitle').textContent=title;$('#recordSearch').value=filter.search||'';$('#recordKind').value=filter.kind||'all';
  populateRecordMonths();$('#recordEntries').replaceChildren();$('#recordMore').hidden=true;
  openDialog($('#recordDialog'));$('#recordDialog').scrollTop=0;
  await renderRecords();
}
async function renderRecords(){
  const generation=++state.recordGeneration,filter={...state.filter},session=state.session;
  clearMedia();imageObserver.disconnect();$('#recordEntries').replaceChildren();$('#recordMore').hidden=true;
  $('#filterChips').replaceChildren(...filterLabels(filter).map(text=>el('span','',text)));
  $('#recordStatus').textContent='正在翻回那些日子…';
  try{
    const descriptors=fitMonths(filter),events=await fetchMonths(descriptors);
    if(generation!==state.recordGeneration||session!==state.session||!state.key)return;
    if(filter.behavior&&!state.behavior)state.behavior=buildBehavior(events);
    const records=selectRecords(events,filter,state.behavior),limit=state.page*40;
    let visible=records.slice(0,limit);
    if(!filter.context&&!filter.ids&&!filter.behavior)visible=[...records].reverse().slice(0,limit);
    let previous='';
    for(const row of visible){
      if(filter.behavior==='replies'){
        const card=el('div','reply-pair');
        card.append(el('span','pair-label','相隔 '+formatDelay(row.seconds)),messageNode(row.previous),messageNode(row.current));$('#recordEntries').append(card);continue;
      }
      const day=dayKey(row.timestamp);
      if(day!==previous){$('#recordEntries').append(el('div','day-header',fullDate(row.timestamp)));previous=day;}
      $('#recordEntries').append(row.kind==='moment'?momentNode(row):messageNode(row,filter.context===row.id));
    }
    const label=filter.behavior==='replies'?'组回应':'条记录';
    $('#recordStatus').textContent=number.format(records.length)+' '+label+(state.recordNote?' · '+state.recordNote:'');
    if(!records.length)$('#recordEntries').append(el('p','empty-records','这一页没有匹配的记录，换个词或月份试试。'));
    $('#recordMore').hidden=limit>=records.length;
    $('#recordMore').onclick=()=>{state.page++;renderRecords();};
  }catch(error){if(generation===state.recordGeneration&&error.name!=='AbortError')$('#recordStatus').textContent=/[\u3400-\u9fff]/.test(error.message)?error.message:'这一页暂时没翻开，请刷新后重试。';}
}
function formatDelay(seconds){if(seconds<60)return seconds+' 秒';if(seconds<3600)return Math.floor(seconds/60)+' 分 '+seconds%60+' 秒';return Math.floor(seconds/3600)+' 小时 '+Math.floor(seconds%3600/60)+' 分';}
function humanText(event){
  const text=event.text||'';
  if(!text.trim().startsWith('<'))return text;
  if(event.kind==='transfer')return '一次转账记录';
  const title=text.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
  return title?title[1].replace(/<[^>]*>/g,''):'';
}
function addMedia(container,event){
  for(const media of event.media||[]){
    const type=media.mime?.startsWith('audio/')?'audio':media.mime?.startsWith('video/')?'video':media.mime?.startsWith('image/')?'img':'file';
    const wrapper=el('div','media-placeholder'),label=type==='audio'?'打开原声':type==='video'?'打开视频':type==='img'?'打开照片':'打开附件';
    const trigger=button('media-load-button',label,()=>loadMedia(wrapper,media,type));trigger.append(el('span','','↗'));wrapper.append(trigger);container.append(wrapper);
    if(type==='img'&&!navigator.connection?.saveData){wrapper._media={media,type};imageObserver.observe(wrapper);}
  }
  if(event.missingMedia)container.append(el('span','missing-media','有 '+event.missingMedia+' 份附件没能随记录保存。'));
}
async function loadMedia(wrapper,media,type){
  const session=state.session,key=state.key,trigger=wrapper.querySelector('button');if(trigger?.disabled)return;if(trigger){trigger.disabled=true;trigger.firstChild.textContent='正在打开…';}
  try{
    const bytes=await readCipher(media.path,key);
    if(!wrapper.isConnected||session!==state.session||!state.key)return;
    const url=URL.createObjectURL(new Blob([bytes],{type:media.mime||'application/octet-stream'}));state.urls.add(url);
    if(type==='file'){
      const link=el('a','media-load-button','点击保存附件 ↗');link.href=url;link.download=media.name||'附件';wrapper.replaceChildren(link);return;
    }
    const node=el(type);node.src=url;
    if(type==='img'){
      node.alt='记录里的一张照片';node.loading='lazy';node.addEventListener('click',()=>{$('#largeImage').src=url;openDialog($('#imageDialog'));});
    }else{node.controls=true;node.preload='metadata';if(type==='video')node.setAttribute('playsinline','');}
    wrapper.replaceChildren(node);
  }catch(error){if(wrapper.isConnected&&session===state.session){wrapper.replaceChildren(button('media-load-button','暂时没打开，点这里重试',()=>loadMedia(wrapper,media,type)));}}
}
const imageObserver=new IntersectionObserver(entries=>{for(const item of entries)if(item.isIntersecting){imageObserver.unobserve(item.target);const {media,type}=item.target._media;loadMedia(item.target,media,type);}},{root:$('#recordDialog'),rootMargin:'150px'});
function messageNode(event,highlight=false){
  const row=el('article','entry'+(event.sent?' sent':'')+(highlight?' record-highlight':''));row.dataset.eventId=event.id;
  const name=event.sent?'我':state.index.profile.herName||'她';row.append(el('div','avatar',event.sent?'我':name.slice(-1)));
  const body=el('div','entry-body');body.append(el('div','entry-meta',name+' · '+timeOf(event.timestamp)));
  const bubble=el('div','bubble');
  if(event.kind==='voice'){
    bubble.append(el('span','message-type','一段声音'));addMedia(bubble,event);
    const text=el('p','transcript');text.append(el('span','transcript-label',event.transcriptReview?'语音文字 · 这一段建议对照原声':'语音文字 · 自动转写'),document.createTextNode(event.transcript||'这段声音暂时没有文字。'));bubble.append(text);
  }else{
    if(event.kind==='voip')bubble.append(el('span','message-type',event.callType==='video'?'视频通话':'语音通话'));
    const text=humanText(event);if(text)bubble.append(el('div','message-content',text));
    addMedia(bubble,event);
    if(!text&&!(event.media||[]).length&&!event.missingMedia)bubble.append(el('span','message-type',({image:'一张照片',emoji:'一个表情',video:'一段视频',file:'一份附件',link:'一个分享',chatHistory:'一组转发记录',system:'一条系统记录',location:'一处位置'}[event.kind]||'一条记录')));
    if(event.quote){const quote=el('p','transcript');quote.append(el('span','transcript-label','引用的话'),document.createTextNode(event.quote));bubble.append(quote);}
  }
  body.append(bubble,button('context-button','看看前后文 ↗',()=>openRecords({context:event.id},fullDate(event.timestamp)+' · 前后文')));row.append(body);return row;
}
function momentNode(event){
  const card=el('article','moment-card'),header=el('div','moment-header'),name=event.sent?'我':state.index.profile.herName||'她';
  header.append(el('div','avatar',event.sent?'我':name.slice(-1)));const by=el('div');by.append(el('p','',name),el('small','',fullDate(event.timestamp)+' · 朋友圈'));header.append(by);card.append(header);
  if(event.text)card.append(el('div','moment-text',event.text));
  const media=el('div','moment-media');addMedia(media,event);if(media.childNodes.length)card.append(media);
  if(event.likes?.length||event.comments?.length){
    const interaction=el('div','moment-interactions');
    if(event.likes?.length)interaction.append(el('p','','♡ '+event.likes.map(x=>x.sent?'我':state.index.profile.herName||'她').join('、')));
    for(const comment of event.comments||[])interaction.append(el('p','',(comment.sent?'我':state.index.profile.herName||'她')+'：'+comment.text));
    card.append(interaction);
  }
  return card;
}
function lock(){
  state.session++;state.recordGeneration++;state.abort?.abort();state.sphere?.destroy();state.sphere=null;state.key=null;state.index=null;state.insights=null;
  state.events.clear();state.pending.clear();state.behavior=null;state.filter={};state.recordNote='';state.recordTitle='';state.abort=null;clearMedia();imageObserver.disconnect();revealObserver.disconnect();
  closeDialog($('#imageDialog'));closeDialog($('#recordDialog'));$('#largeImage').removeAttribute('src');$('#recordEntries').replaceChildren();
  for(const id of ['storyList','journeyGrid','wordHighlights','phaseGrid','monthChart','initiativeFigures','initiativeTrack','replyFigures','hourChart','expressionChart','styleGrid','calendarGrid','firstWords','analysisGrid'])$('#'+id).replaceChildren();
  for(const id of ['dedication','coverDate','archiveRange','originQuote','originDescription','recordTitle','recordStatus','filterChips','callSummary','heroDays','statDays','statMessages','statVoices'])$('#'+id).textContent='';
  $('#originButton').onclick=null;$('#analyticsMonth').replaceChildren(new Option('全部月份',''));$('#recordMonth').replaceChildren(new Option('全部月份',''));$('#peakHour').textContent='';
  $('#appRoot').hidden=true;$('#lockScreen').hidden=false;$('#passwordInput').value='';$('#unlockError').textContent='';$('#recordSearch').value='';window.scrollTo(0,0);$('#passwordInput').focus();
}
$('#unlockForm').addEventListener('submit',async event=>{
  event.preventDefault();const submit=$('#unlockSubmit');submit.disabled=true;submit.textContent='…';$('#unlockError').textContent='';
  try{
    if(!window.isSecureContext||!crypto.subtle)throw new Error('请通过 HTTPS 链接打开这份纪念册。');
    if(!state.manifest)throw new Error('封面还在载入，稍后再试一次。');
    state.abort=new AbortController();
    const material=await crypto.subtle.importKey('raw',new TextEncoder().encode($('#passwordInput').value),'PBKDF2',false,['deriveKey']);
    const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:decode64(state.manifest.salt),iterations:state.manifest.iterations,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['decrypt']);
    let index,insights;
    try{index=await readJSON(state.manifest.index,key);insights=await readJSON(index.insights,key);}catch(error){if(error.name==='OperationError')throw new Error('口令还没对上，再试一次。');throw error;}
    if(index.version!==1||!Array.isArray(index.months)||!insights.periods||!insights.relationship_origin)throw new Error('这份纪念册暂时无法打开，请刷新重试。');
    state.key=key;state.session++;$('#passwordInput').value='';activate(index,insights);
  }catch(error){state.key=null;$('#unlockError').textContent=error.message||'这一页暂时没翻开，请重试。';}finally{submit.disabled=false;submit.textContent='↗';}
});
$('#lockButton').addEventListener('click',lock);
$('#statDaysButton').addEventListener('click',()=>openRecords({start:state.insights.phases.crush.range_start,end:state.insights.scope.consecutive_until,humanOnly:true},'每天，都有你'));
$('#statMessagesButton').addEventListener('click',()=>openRecords({},'一句句，留在这里'));
$('#statVoicesButton').addEventListener('click',()=>openRecords({kind:'voice'},'想再听一遍'));
$('#statTripsButton').addEventListener('click',()=>$('#journeys').scrollIntoView({behavior:reduced?'instant':'smooth',block:'start'}));
for(const node of document.querySelectorAll('[data-archive]'))node.addEventListener('click',()=>openRecords({kind:node.dataset.archive},({all:'一句句聊天',voice:'想再听一遍',moment:'朋友圈里',call:'那些通话'}[node.dataset.archive])));
for(const node of $('#wordSides').querySelectorAll('button'))node.addEventListener('click',()=>{
  state.wordSide=node.dataset.side;for(const item of $('#wordSides').querySelectorAll('button')){const active=item===node;item.classList.toggle('active',active);item.setAttribute('aria-pressed',String(active));}refreshCloud();
});
$('#cloudMotion').addEventListener('click',()=>{if(!state.sphere)return;const paused=state.sphere.toggle();$('#cloudMotion').textContent=paused?'开始转动 ↻':'暂停转动 Ⅱ';$('#cloudMotion').setAttribute('aria-label',paused?'开始词云转动':'暂停词云转动');});
$('#periodSelect').addEventListener('change',()=>{state.period=$('#periodSelect').value;state.month='';$('#analyticsMonth').value='';showStats();});
$('#analyticsMonth').addEventListener('change',()=>{state.month=$('#analyticsMonth').value;if(state.month){state.period='all';$('#periodSelect').value='all';}showStats();});
$('#recordKind').append(new Option('彼此的回应','momentPair'));
for(const [label,kind] of [['照片','image'],['视频','video'],['表情','emoji'],['附件','file']])$('#recordKind').append(new Option(label,kind));
$('#recordKind').addEventListener('change',()=>{state.filter={kind:$('#recordKind').value,search:$('#recordSearch').value.trim()};state.recordNote='';state.page=1;populateRecordMonths();renderRecords();});
$('#recordMonth').addEventListener('change',()=>{state.filter={...state.filter,month:$('#recordMonth').value};delete state.filter.day;delete state.filter.context;delete state.filter.ids;state.recordNote='';$('#recordTitle').textContent='我们的记录';state.page=1;renderRecords();});
$('#recordSearchForm').addEventListener('submit',event=>{event.preventDefault();state.filter={...state.filter,search:$('#recordSearch').value.trim()};delete state.filter.context;delete state.filter.ids;state.recordNote='';$('#recordTitle').textContent='我们的记录';state.page=1;renderRecords();});
$('#recordSearch').addEventListener('search',()=>{if(!$('#recordSearch').value){delete state.filter.search;state.page=1;renderRecords();}});
$('#clearRecordFilters').addEventListener('click',()=>openRecords({kind:$('#recordKind').value},'我们的记录'));
$('#closeRecords').addEventListener('click',()=>closeDialog($('#recordDialog')));
$('#recordDialog').addEventListener('close',()=>{state.recordGeneration++;imageObserver.disconnect();clearMedia();$('#recordEntries').replaceChildren();document.body.style.overflow='';state.sphere?.suspend(false);});
$('#closeImage').addEventListener('click',()=>closeDialog($('#imageDialog')));
$('#imageDialog').addEventListener('close',()=>{$('#largeImage').removeAttribute('src');if(!$('#recordDialog').open)document.body.style.overflow='';});
for(const id of ['recordDialog','imageDialog'])$('#'+id).addEventListener('click',event=>{if(event.target===$('#'+id)){const box=event.target.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)closeDialog(event.target);}});
const hero=$('#heroScene');
if(matchMedia('(hover:hover)').matches&&!reduced){hero.addEventListener('pointermove',event=>{const box=hero.getBoundingClientRect();hero.style.setProperty('--tiltY',((event.clientX-box.left)/box.width-.5)*9+'deg');hero.style.setProperty('--tiltX',-((event.clientY-box.top)/box.height-.5)*7+'deg');});hero.addEventListener('pointerleave',()=>{hero.style.setProperty('--tiltX','0deg');hero.style.setProperty('--tiltY','0deg');});}
document.addEventListener('visibilitychange',()=>{if(document.hidden)document.querySelectorAll('video').forEach(n=>n.pause());});
try{
  const response=await fetch('archive-manifest.json',{cache:'no-store'});if(!response.ok)throw new Error('纪念册封面暂时无法载入，请刷新重试。');
  const manifest=await response.json();
  if(manifest.version!==1||manifest.state!=='encrypted'||!Number.isInteger(manifest.iterations)||manifest.iterations<100000||manifest.iterations>2000000)throw new Error('这一版纪念册暂时无法打开，请刷新重试。');
  state.manifest=manifest;
}catch(error){$('#unlockError').textContent=error.message;}
