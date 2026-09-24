(()=>{
'use strict';

const WS='wss://api.upbit.com/websocket/v1';
const REST='https://api.upbit.com/v1/trades/ticks';
const MARKET='KRW-XRP';

const TOTAL_TARGET=120000;
const PAGE_SIZE=500;
const CHUNK_TARGET=10000;
const DELAY_MS=300;

const MAX_BARS=620;
const VWAP_WINDOW=20;
const VWAP_SLOPE_LOOKBACK=3;
const VWAP_FLAT_TOL_PCT=0.02;
const CONVERGENCE_MAX_PCT=0.25;

const STATE_KEY='xrp_v4_2_state';
const HIST_KEY='xrp_v4_2_history';
const META_KEY='xrp_v4_2_history_meta';
const VERSION=42;

const $=id=>document.getElementById(id);
const E={
  conn:$('conn'),price:$('price'),count:$('count'),save:$('save'),
  v:$('vwapState'),sig:$('signal'),hist:$('history'),hb:$('histbar'),
  p240:$('p240'),p960:$('p960'),c240:$('c240'),c960:$('c960'),
  re:$('reconnect')
};

let ws=null, liveCount=0, seq=0, lastSid=null, saveTimer=null;
let historyLoading=false;

const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function Builder(size){this.size=size;this.done=[];this.cur=null}
Builder.prototype.reset=function(){this.done=[];this.cur=null}
Builder.prototype.add=function(t){
  const gid=Math.floor(t.seq/this.size);
  if(!this.cur || this.cur.gid!==gid){
    if(this.cur){
      this.cur.complete=this.cur.count>=this.size;
      this.done.push(this.cur);
      if(this.done.length>MAX_BARS)this.done.shift();
    }
    this.cur={gid,open:t.p,high:t.p,low:t.p,close:t.p,volume:t.q,start:t.ts,end:t.ts,count:1,complete:false};
  } else {
    const b=this.cur;
    b.high=Math.max(b.high,t.p); b.low=Math.min(b.low,t.p); b.close=t.p;
    b.volume+=t.q; b.end=t.ts; b.count++;
  }
  if(this.cur && this.cur.count>=this.size){
    this.cur.complete=true;
    this.done.push(this.cur);
    if(this.done.length>MAX_BARS)this.done.shift();
    this.cur=null;
  }
};
const C={240:new Builder(240),960:new Builder(960)};

const allBars=b=>{const a=b.done.slice();if(b.cur)a.push({...b.cur});return a};

function ema(v,s){
  if(!v.length)return[];
  const k=2/(s+1),o=[];let e=v[0];o.push(e);
  for(let i=1;i<v.length;i++){e=v[i]*k+e*(1-k);o.push(e)}
  return o;
}
function vwap20(a){
  const out=[],q=[];let pvS=0,vS=0;
  for(const b of a){
    const typ=(b.high+b.low+b.close)/3,vol=+b.volume||0,pv=typ*vol;
    q.push([pv,vol]);pvS+=pv;vS+=vol;
    if(q.length>VWAP_WINDOW){const z=q.shift();pvS-=z[0];vS-=z[1]}
    out.push(vS?pvS/vS:b.close);
  }
  return out;
}
function ind(a){
  const c=a.map(x=>x.close);
  return {e5:ema(c,5),e10:ema(c,10),e20:ema(c,20),e60:ema(c,60),e120:ema(c,120),vwap:vwap20(a)};
}
function slope(v){
  if(v.length<VWAP_SLOPE_LOOKBACK+1)return{state:'FLAT',pct:0};
  const n=v.at(-1),b=v[v.length-1-VWAP_SLOPE_LOOKBACK],p=b?(n/b-1)*100:0;
  return{state:p>VWAP_FLAT_TOL_PCT?'UP':p<-VWAP_FLAT_TOL_PCT?'DOWN':'FLAT',pct:p};
}
function arrows(a,I){
  const out=[];
  for(let i=1;i<a.length;i++){
    const px=a[i].close||1;
    const span=(Math.max(I.e5[i],I.e10[i],I.e20[i])-Math.min(I.e5[i],I.e10[i],I.e20[i]))/px*100;
    if(span>CONVERGENCE_MAX_PCT)continue;
    const up=I.e5[i-1]<=I.vwap[i-1]&&I.e5[i]>I.vwap[i];
    const dn=I.e5[i-1]>=I.vwap[i-1]&&I.e5[i]<I.vwap[i];
    if(up)out.push([i,'UP',a[i].low]);
    if(dn)out.push([i,'DOWN',a[i].high]);
  }
  return out;
}
function sig(){
  const a=C[240].done;
  if(a.length<22)return{state:'FLAT',pct:0,label:'WAIT',cls:'wait'};
  const I=ind(a),i=a.length-1,p=i-1,S=slope(I.vwap),px=a[i].close||1;
  const span=(Math.max(I.e5[i],I.e10[i],I.e20[i])-Math.min(I.e5[i],I.e10[i],I.e20[i]))/px*100;
  const cv=span<=CONVERGENCE_MAX_PCT;
  const up=I.e5[p]<=I.vwap[p]&&I.e5[i]>I.vwap[i];
  const dn=I.e5[p]>=I.vwap[p]&&I.e5[i]<I.vwap[i];
  if(S.state==='UP'&&cv&&up)return{...S,label:'BUY 후보 ↑',cls:'buy'};
  if(S.state==='DOWN'&&cv&&dn)return{...S,label:'SELL 후보 ↓',cls:'sell'};
  if(S.state==='UP')return{...S,label:'HOLD / BUY 허가',cls:'buy'};
  if(S.state==='DOWN')return{...S,label:'BUY 차단 / SELL 관찰',cls:'sell'};
  return{...S,label:'WAIT',cls:'wait'};
}
function drawArrow(ctx,x,y,d){
  ctx.fillStyle=d==='UP'?'#0a8f3c':'#c62828';
  ctx.beginPath();
  if(d==='UP'){
    ctx.moveTo(x,y-12);ctx.lineTo(x-8,y-2);ctx.lineTo(x-3,y-2);ctx.lineTo(x-3,y+8);
    ctx.lineTo(x+3,y+8);ctx.lineTo(x+3,y-2);ctx.lineTo(x+8,y-2);
  } else {
    ctx.moveTo(x,y+12);ctx.lineTo(x-8,y+2);ctx.lineTo(x-3,y+2);ctx.lineTo(x-3,y-8);
    ctx.lineTo(x+3,y-8);ctx.lineTo(x+3,y+2);ctx.lineTo(x+8,y+2);
  }
  ctx.closePath();ctx.fill();
}
function draw(cv,a){
  const d=Math.max(1,devicePixelRatio||1),r=cv.getBoundingClientRect(),ctx=cv.getContext('2d');
  cv.width=r.width*d;cv.height=r.height*d;ctx.setTransform(d,0,0,d,0,0);
  const W=r.width,H=r.height;ctx.clearRect(0,0,W,H);
  const pad={l:46,r:12,t:12,b:22},pw=W-pad.l-pad.r,ph=H-pad.t-pad.b;
  if(a.length<2){ctx.fillStyle='#777';ctx.font='14px sans-serif';ctx.fillText('과거/실시간 체결 준비 중...',18,32);return}
  a=a.slice(-180);
  const I=ind(a),vals=[];
  a.forEach(b=>vals.push(b.high,b.low));
  Object.values(I).forEach(s=>s.forEach(x=>Number.isFinite(x)&&vals.push(x)));
  let mn=Math.min(...vals),mx=Math.max(...vals),ex=(mx-mn)*.08||1;mn-=ex;mx+=ex;
  const X=i=>pad.l+(i+.5)*(pw/a.length),Y=x=>pad.t+(mx-x)/(mx-mn)*ph;
  ctx.strokeStyle='#ececec';ctx.lineWidth=1;
  for(let g=0;g<=5;g++){const yy=pad.t+ph*g/5;ctx.beginPath();ctx.moveTo(pad.l,yy);ctx.lineTo(W-pad.r,yy);ctx.stroke()}
  const cw=Math.max(2,Math.min(7,pw/a.length*.68));
  a.forEach((b,i)=>{
    const up=b.close>=b.open,col=up?'#e65d5d':'#4b82e8';
    ctx.strokeStyle=col;ctx.fillStyle=col;ctx.beginPath();ctx.moveTo(X(i),Y(b.high));ctx.lineTo(X(i),Y(b.low));ctx.stroke();
    const yo=Y(b.open),yc=Y(b.close);ctx.fillRect(X(i)-cw/2,Math.min(yo,yc),cw,Math.max(1,Math.abs(yc-yo)));
  });
  [['e5','#2f80ed',1.2],['e10','#f2994a',1.2],['e20','#27ae60',1.4],['e60','#eb5757',1.3],['e120','#9b51e0',1.3],['vwap','#8d5a44',2.8]].forEach(([k,c,l])=>{
    ctx.strokeStyle=c;ctx.lineWidth=l;ctx.setLineDash(k==='vwap'?[7,5]:[]);
    ctx.beginPath();let started=false;
    I[k].forEach((z,i)=>{if(!Number.isFinite(z))return;if(!started){ctx.moveTo(X(i),Y(z));started=true}else ctx.lineTo(X(i),Y(z))});
    ctx.stroke();ctx.setLineDash([]);
  });
  arrows(a,I).forEach(s=>drawArrow(ctx,X(s[0]),Y(s[2])+(s[1]==='UP'?16:-16),s[1]));
  ctx.fillStyle='#555';ctx.font='11px sans-serif';ctx.fillText(mx.toFixed(1),3,pad.t+4);ctx.fillText(mn.toFixed(1),3,pad.t+ph);
}
function render(){
  draw(E.c240,allBars(C[240]));draw(E.c960,allBars(C[960]));
  E.p240.textContent=`${C[240].cur?.count||0}/240 · 완성 ${C[240].done.length}`;
  E.p960.textContent=`${C[960].cur?.count||0}/960 · 완성 ${C[960].done.length}`;
  const s=sig();
  E.v.textContent=`VWAP20 ${s.state} ${s.pct>=0?'+':''}${s.pct.toFixed(3)}%`;
  E.v.className='badge '+(s.state==='UP'?'up':s.state==='DOWN'?'down':'flat');
  E.sig.textContent=s.label;E.sig.className='signal '+s.cls;
}
function add(raw){
  const t={p:+raw.trade_price,q:+raw.trade_volume||0,s:raw.ask_bid||'',ts:+raw.timestamp||Date.now(),sid:raw.sequential_id??null,seq:seq++};
  C[240].add(t);C[960].add(t);if(t.sid!=null)lastSid=t.sid;
}
function saveState(){
  try{
    localStorage.setItem(STATE_KEY,JSON.stringify({v:VERSION,seq,lastSid,b240:C[240],b960:C[960]}));
    E.save.textContent='자동 저장됨';
  }catch(e){E.save.textContent='저장 실패'}
}
function loadState(){
  try{
    const s=JSON.parse(localStorage.getItem(STATE_KEY)||'null');
    if(!s||s.v!==VERSION)return false;
    seq=s.seq||0;lastSid=s.lastSid??null;
    Object.assign(C[240],s.b240||{});Object.assign(C[960],s.b960||{});
    return !!(C[240].done.length||C[960].done.length);
  }catch(e){return false}
}
function loadMeta(){
  try{return JSON.parse(localStorage.getItem(META_KEY)||'null')}catch(e){return null}
}
function saveMeta(m){localStorage.setItem(META_KEY,JSON.stringify(m))}
function loadHistory(){
  try{return JSON.parse(localStorage.getItem(HIST_KEY)||'[]')}catch(e){return[]}
}
function saveHistory(h){
  try{
    // 브라우저 저장공간 보호: 최대 120,000건만
    localStorage.setItem(HIST_KEY,JSON.stringify(h.slice(-TOTAL_TARGET)));
    return true;
  }catch(e){
    return false;
  }
}

async function fetchPage(cursor=null){
  const u=new URL(REST);
  u.searchParams.set('market',MARKET);
  u.searchParams.set('count',PAGE_SIZE);
  if(cursor!=null)u.searchParams.set('cursor',String(cursor));
  const r=await fetch(u.toString(),{cache:'no-store'});
  if(!r.ok)throw new Error('HTTP '+r.status);
  return await r.json();
}

async function resumableHistory(){
  if(historyLoading)return;
  historyLoading=true;

  let hist=loadHistory();
  let meta=loadMeta()||{loaded:hist.length,cursor:null,done:false};

  // 기존 저장 이력이 없는데 meta만 남은 경우 초기화
  if(!hist.length && meta.loaded>0)meta={loaded:0,cursor:null,done:false};

  try{
    while(hist.length<TOTAL_TARGET){
      const chunkGoal=Math.min(TOTAL_TARGET,hist.length+CHUNK_TARGET);
      let cursor=meta.cursor;

      while(hist.length<chunkGoal){
        const a=await fetchPage(cursor);
        if(!Array.isArray(a)||!a.length){meta.done=true;break}
        hist.push(...a);
        cursor=a.at(-1)?.sequential_id??cursor;
        meta={loaded:hist.length,cursor,done:false};
        E.hist.textContent=`과거체결 ${hist.length.toLocaleString()}/${TOTAL_TARGET.toLocaleString()}`;
        E.hb.textContent=`${Math.min(100,hist.length/TOTAL_TARGET*100).toFixed(0)}%`;
        await sleep(DELAY_MS);
      }

      saveMeta(meta);
      const ok=saveHistory(hist);
      if(!ok){
        E.hist.textContent=`저장공간 제한 · ${hist.length.toLocaleString()}건까지 확보`;
        break;
      }

      // 1만건 단위 중간 저장 후 UI 양보
      E.hist.textContent=`과거체결 ${hist.length.toLocaleString()}건 저장 완료`;
      await sleep(1000);

      if(meta.done)break;
    }

    if(hist.length){
      // Upbit 응답 최신→과거, 차트 투입은 과거→최신
      const ordered=hist.slice(0,TOTAL_TARGET).reverse();
      C[240].reset();C[960].reset();seq=0;lastSid=null;
      for(let i=0;i<ordered.length;i++){
        add(ordered[i]);
        if(i%5000===0){render();await sleep(0)}
      }
      saveState();
      E.hist.textContent=`과거 ${ordered.length.toLocaleString()}건 · 240T ${C[240].done.length}봉 · 960T ${C[960].done.length}봉`;
      E.hb.textContent=`${Math.min(100,ordered.length/TOTAL_TARGET*100).toFixed(0)}%`;
      render();
    }
  }catch(e){
    console.warn(e);
    E.hist.textContent=`과거 로딩 일시중단 · 저장 ${hist.length.toLocaleString()}건`;
    E.hb.textContent=`${Math.min(100,hist.length/TOTAL_TARGET*100).toFixed(0)}%`;
  }finally{
    historyLoading=false;
  }
}

async function backfillGap(){
  if(lastSid==null)return;
  try{
    let rows=[],cursor=null;
    for(let pg=0;pg<20;pg++){
      const a=await fetchPage(cursor);
      if(!a.length)break;
      let found=false;
      for(const z of a){
        if(String(z.sequential_id)===String(lastSid)){found=true;break}
        rows.push(z);
      }
      if(found)break;
      cursor=a.at(-1)?.sequential_id;
      await sleep(DELAY_MS);
    }
    rows.reverse();
    rows.forEach(add);
    if(rows.length){
      E.hist.textContent=`누락 ${rows.length.toLocaleString()}건 보충`;
      saveState();render();
    }
  }catch(e){
    E.hist.textContent='누락 보충 실패 · 실시간 계속';
  }
}

async function parse(d){
  try{
    if(d instanceof Blob)return JSON.parse(await d.text());
    if(d instanceof ArrayBuffer)return JSON.parse(new TextDecoder().decode(d));
    return JSON.parse(d);
  }catch(e){return null}
}
function connect(){
  if(ws)try{ws.close()}catch(e){}
  E.conn.textContent='연결 중';
  ws=new WebSocket(WS);ws.binaryType='arraybuffer';
  ws.onopen=()=>{
    ws.send(JSON.stringify([{ticket:'xrp-v4-2-'+Date.now()},{type:'trade',codes:[MARKET],is_only_realtime:true},{format:'DEFAULT'}]));
    E.conn.textContent='실시간 연결';E.conn.className='badge up';
  };
  ws.onmessage=async ev=>{
    const m=await parse(ev.data);
    if(!m||m.type!=='trade'||m.code!==MARKET)return;
    if(lastSid!=null&&m.sequential_id!=null&&String(m.sequential_id)===String(lastSid))return;
    add(m);liveCount++;
    E.price.textContent=`${(+m.trade_price).toLocaleString()} KRW`;
    E.count.textContent=`실시간 ${liveCount.toLocaleString()}`;
    render();
    clearTimeout(saveTimer);saveTimer=setTimeout(saveState,1000);
  };
  ws.onclose=()=>setTimeout(connect,3000);
}
async function start(){
  const restored=loadState();
  if(restored){
    E.hist.textContent=`저장 복원 · 240T ${C[240].done.length}봉 · 960T ${C[960].done.length}봉`;
    render();
    await backfillGap();
  }
  connect();
  // 실시간 연결과 과거 이력 로딩을 병행하되, 과거 로딩은 재개형
  setTimeout(resumableHistory,1500);
}

E.re.onclick=async()=>{await backfillGap();connect()};
addEventListener('resize',render);
document.addEventListener('visibilitychange',async()=>{
  if(document.visibilityState==='visible'){
    await backfillGap();
    if(!ws||ws.readyState>1)connect();
    setTimeout(resumableHistory,800);
  } else saveState();
});
addEventListener('beforeunload',saveState);

if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
start();
setInterval(render,1000);
})();