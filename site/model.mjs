export const dayKey = ts => new Date(ts * 1000 + 28800000).toISOString().slice(0, 10);
export const hourKey = ts => new Date(ts * 1000 + 28800000).getUTCHours();
export const compareEvents = (a,b) => a.timestamp-b.timestamp || (a.sequence??0)-(b.sequence??0) || String(a.id).localeCompare(String(b.id));
export const isPairMoment = event => event.kind==='moment' && [...(event.likes||[]),...(event.comments||[])].some(item=>item.sent!==event.sent);
export const spokenText = event => event.kind==='voice' ? event.transcript||'' : ['text','quote'].includes(event.kind) ? event.text||'' : '';
const affectionPatterns=[/想你|想念你|想死你/i,/亲亲|亲你|亲我|亲一下|亲一口|亲吻|接吻|么么|啵啵|mua|😘|💋|^亲[～~！!。.]*$/i,/喜欢你|喜欢上你/i,/爱你/i,/抱抱|抱你|抱我|拥抱/i,/宝贝|宝宝/i];
const stylePatterns={direct:/喜欢你|想你|想念你|爱你|抱抱|亲亲|亲你|mua/i,care:/吃饭了吗|吃了没|早点睡|注意安全|注意身体|多喝水|别熬夜|记得吃|到家了吗|休息一下/i,share:/我今天|我刚刚|我刚才|给你看|我在|我发现|今天去了/i,playful:/哈哈|嘿嘿|嘻嘻|略略|笨蛋|傻瓜|哼哼/i,tsundere:/才不|才没有|才不要|谁要|哼[！!～~。]*$/i,easy:/没关系|不着急|不急|慢慢来|都可以|都行|随你|没事的/i};
export const hasAffection=event=>affectionPatterns.some(pattern=>pattern.test(spokenText(event)));
export const hasStyle=(event,key)=>Boolean(stylePatterns[key]?.test(spokenText(event)));
export function inScope(event, filter={}) {
  const day=dayKey(event.timestamp);
  if(filter.month && day.slice(0,7)!==filter.month)return false;
  if(filter.day && day!==filter.day)return false;
  if(filter.start && day<filter.start)return false;
  if(filter.end && day>filter.end)return false;
  if(Number.isInteger(filter.hour) && hourKey(event.timestamp)!==filter.hour)return false;
  if(filter.sender && event.sent!==(filter.sender==='mine'))return false;
  return true;
}
export function buildBehavior(events) {
  const human=events.filter(e=>e.kind!=='moment'&&e.kind!=='system').sort(compareEvents);
  const starts=[],replies=[];
  for(let i=0;i<human.length;i++){
    const current=human[i],previous=human[i-1],gap=previous?current.timestamp-previous.timestamp:null;
    if(!previous||gap>=14400)starts.push(current);
    else if(current.sent!==previous.sent)replies.push({previous,current,seconds:Math.max(0,gap)});
  }
  return {starts,replies};
}
export function selectRecords(events,filter={},behavior=null) {
  const sorted=[...events].sort(compareEvents);
  if(filter.context){
    const target=sorted.find(e=>e.id===filter.context);
    if(!target)return [];
    if(target.kind==='moment')return [target];
    const chats=sorted.filter(e=>e.kind!=='moment'),at=chats.findIndex(e=>e.id===target.id);
    return chats.slice(Math.max(0,at-4),at+5);
  }
  if(filter.behavior==='replies'){
    return (behavior||buildBehavior(sorted)).replies.filter(pair=>inScope(pair.current,filter)&&(!filter.instant||pair.seconds<=10)&&(!filter.search||[pair.previous,pair.current].some(e=>[e.text,e.transcript,e.quote].filter(Boolean).join('\n').toLocaleLowerCase().includes(filter.search.toLocaleLowerCase()))));
  }
  let rows=filter.behavior==='starts'?(behavior||buildBehavior(sorted)).starts:sorted;
  const ids=filter.ids?new Set(filter.ids):null;
  rows=rows.filter(event=>{
    if(ids&&!ids.has(event.id))return false;
    const kind=filter.kind||'all';
    if(kind==='all'&&event.kind==='moment')return false;
    if(kind==='voice'&&event.kind!=='voice')return false;
    if(kind==='call'&&event.kind!=='voip')return false;
    if(kind==='moment'&&event.kind!=='moment')return false;
    if(kind==='momentPair'&&!isPairMoment(event))return false;
    if(['image','video','emoji','file','text'].includes(kind)&&event.kind!==kind)return false;
    if(filter.humanOnly&&event.kind==='system')return false;
    if(!inScope(event,filter))return false;
    if(filter.word&&!spokenText(event).toLocaleLowerCase().includes(filter.word.toLocaleLowerCase()))return false;
    if(filter.expression&&!hasAffection(event))return false;
    if(filter.style&&!hasStyle(event,filter.style))return false;
    if(filter.search){
      const haystack=[event.text,event.transcript,event.quote,...(event.comments||[]).map(c=>c.text)].filter(Boolean).join('\n').toLocaleLowerCase();
      if(!haystack.includes(filter.search.toLocaleLowerCase()))return false;
    }
    return true;
  });
  return rows;
}
