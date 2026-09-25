(()=>{
'use strict';

/* =========================================================
   XRP iPad Tick Chart v4.3
   PC R11 VWAP COLOR ONLY FLAT YELLOW 대응판
   READ ONLY / NO ORDER
   ========================================================= */

const WS='wss://api.upbit.com/websocket/v1';
const PROXY='https://xrp-upbit-proxy.apollo3744.workers.dev/trades';
const MARKET='KRW-XRP';

const TOTAL_TARGET=120000;
const PAGE_SIZE=200;
const DELAY_MS=350;
const MAX_BARS=620;

const VWAP_WINDOW=20;

/* PC R11 */
const VWAP_TREND_LOOKBACK=8;
const VWAP_FLAT_TOL_PCT=0.02;

const STATE_KEY='xrp_v4_3_r11_state';
const VERSION=43;

const $=id=>document.getElementById(id);

const E={
  conn:$('conn'),
  price:$('price'),
  count:$('count'),
  save:$('save'),
  v:$('vwapState'),
  sig:$('signal'),
  hist:$('history'),
  hb:$('histbar'),
  p240:$('p240'),
  p960:$('p960'),
  c240:$('c240'),
  c960:$('c960'),
  re:$('reconnect')
};

let ws=null;
let liveCount=0;
let seq=0;
let lastSid=null;
let saveTimer=null;
let historyLoading=false;

const sleep=ms=>new Promise(r=>setTimeout(r,ms));


/* =========================================================
   TICK BAR BUILDER
   ========================================================= */

function Builder(size){
  this.size=size;
  this.done=[];
  this.cur=null;
}

Builder.prototype.reset=function(){
  this.done=[];
  this.cur=null;
};

Builder.prototype.add=function(t){

  const gid=Math.floor(t.seq/this.size);

  if(!this.cur || this.cur.gid!==gid){

    if(this.cur){
      this.cur.complete=this.cur.count>=this.size;
      this.done.push(this.cur);

      if(this.done.length>MAX_BARS){
        this.done.shift();
      }
    }

    this.cur={
      gid,
      open:t.p,
      high:t.p,
      low:t.p,
      close:t.p,
      volume:t.q,
      start:t.ts,
      end:t.ts,
      count:1,
      complete:false
    };

  }else{

    const b=this.cur;

    b.high=Math.max(b.high,t.p);
    b.low=Math.min(b.low,t.p);
    b.close=t.p;
    b.volume+=t.q;
    b.end=t.ts;
    b.count++;
  }

  if(this.cur && this.cur.count>=this.size){

    this.cur.complete=true;
    this.done.push(this.cur);

    if(this.done.length>MAX_BARS){
      this.done.shift();
    }

    this.cur=null;
  }
};


const C={
  240:new Builder(240),
  960:new Builder(960)
};


function allBars(b){

  const a=b.done.slice();

  if(b.cur){
    a.push({...b.cur});
  }

  return a;
}


/* =========================================================
   EMA
   ========================================================= */

function ema(values,span){

  if(!values.length)return[];

  const k=2/(span+1);

  let e=values[0];

  const out=[e];

  for(let i=1;i<values.length;i++){

    e=values[i]*k+e*(1-k);

    out.push(e);
  }

  return out;
}


/* =========================================================
   PC R11 VWAP20
   Typical = (High + Low + Close) / 3
   ========================================================= */

function vwap20(a){

  const out=[];
  const q=[];

  let pvSum=0;
  let volSum=0;

  for(const b of a){

    const typical=
      (b.high+b.low+b.close)/3;

    const volume=
      Number(b.volume)||0;

    const pv=
      typical*volume;

    q.push([pv,volume]);

    pvSum+=pv;
    volSum+=volume;

    if(q.length>VWAP_WINDOW){

      const old=q.shift();

      pvSum-=old[0];
      volSum-=old[1];
    }

    out.push(
      volSum
        ? pvSum/volSum
        : b.close
    );
  }

  return out;
}


/* =========================================================
   INDICATORS
   ========================================================= */

function indicators(a){

  const close=
    a.map(x=>x.close);

  return{

    e5:ema(close,5),
    e10:ema(close,10),
    e20:ema(close,20),
    e60:ema(close,60),
    e120:ema(close,120),

    vwap:vwap20(a)
  };
}


/* =========================================================
   PC R11 VWAP TREND

   현재 봉의 VWAP 색상은
   현재 봉 직전 VWAP과
   8봉 이전 VWAP 비교

   UP   >= +0.02%
   DOWN <= -0.02%
   FLAT 그 사이
   ========================================================= */

function vwapTrendSeries(vwap){

  const out=
    new Array(vwap.length).fill(NaN);

  for(let i=0;i<vwap.length;i++){

    const prev=i-1;

    const base=
      i-1-VWAP_TREND_LOOKBACK;

    if(prev<0 || base<0){
      continue;
    }

    const a=vwap[prev];
    const b=vwap[base];

    if(
      Number.isFinite(a) &&
      Number.isFinite(b) &&
      b!==0
    ){

      out[i]=
        (a/b-1)*100;
    }
  }

  return out;
}


function trendState(pct){

  if(
    Number.isFinite(pct) &&
    pct>=VWAP_FLAT_TOL_PCT
  ){
    return 'UP';
  }

  if(
    Number.isFinite(pct) &&
    pct<=-VWAP_FLAT_TOL_PCT
  ){
    return 'DOWN';
  }

  return 'FLAT';
}


/* =========================================================
   CHART DRAW
   ========================================================= */

function draw(canvas,bars){

  const ratio=
    Math.max(
      1,
      window.devicePixelRatio||1
    );

  const rect=
    canvas.getBoundingClientRect();

  const ctx=
    canvas.getContext('2d');

  canvas.width=
    rect.width*ratio;

  canvas.height=
    rect.height*ratio;

  ctx.setTransform(
    ratio,0,0,ratio,0,0
  );

  const W=rect.width;
  const H=rect.height;

  ctx.clearRect(
    0,0,W,H
  );

  const pad={
    l:46,
    r:12,
    t:12,
    b:22
  };

  const plotW=
    W-pad.l-pad.r;

  const plotH=
    H-pad.t-pad.b;


  if(bars.length<2){

    ctx.fillStyle='#777';

    ctx.font=
      '14px sans-serif';

    ctx.fillText(
      '과거/실시간 체결 준비 중...',
      18,
      32
    );

    return;
  }


  bars=
    bars.slice(-180);


  const I=
    indicators(bars);

  const trend=
    vwapTrendSeries(I.vwap);


  const values=[];

  bars.forEach(b=>{

    values.push(
      b.high,
      b.low
    );
  });

  Object.values(I)
    .forEach(series=>{

      series.forEach(x=>{

        if(Number.isFinite(x)){
          values.push(x);
        }

      });

    });


  let min=
    Math.min(...values);

  let max=
    Math.max(...values);

  const extra=
    (max-min)*0.08 || 1;

  min-=extra;
  max+=extra;


  const X=i=>
    pad.l+
    (i+0.5)*
    (plotW/bars.length);


  const Y=value=>
    pad.t+
    (max-value)/
    (max-min)*
    plotH;


  /* GRID */

  ctx.strokeStyle='#ececec';
  ctx.lineWidth=1;

  for(let g=0;g<=5;g++){

    const y=
      pad.t+
      plotH*g/5;

    ctx.beginPath();

    ctx.moveTo(
      pad.l,
      y
    );

    ctx.lineTo(
      W-pad.r,
      y
    );

    ctx.stroke();
  }


  /* CANDLES
     PC:
     상승 = 빨강
     하락 = 파랑
  */

  const candleWidth=
    Math.max(
      2,
      Math.min(
        7,
        plotW/bars.length*0.68
      )
    );


  bars.forEach((b,i)=>{

    const up=
      b.close>=b.open;

    const color=
      up
      ? '#d94b4b'
      : '#2f6fe4';


    ctx.strokeStyle=color;
    ctx.fillStyle=color;

    ctx.lineWidth=0.8;


    ctx.beginPath();

    ctx.moveTo(
      X(i),
      Y(b.high)
    );

    ctx.lineTo(
      X(i),
      Y(b.low)
    );

    ctx.stroke();


    const yo=
      Y(b.open);

    const yc=
      Y(b.close);


    ctx.fillRect(
      X(i)-candleWidth/2,
      Math.min(yo,yc),
      candleWidth,
      Math.max(
        1,
        Math.abs(yc-yo)
      )
    );
  });


  /* EMA */

  const emaSpec=[
    ['e5','#2f80ed',1.2],
    ['e10','#f2994a',1.2],
    ['e20','#27ae60',1.4],
    ['e60','#eb5757',1.3],
    ['e120','#9b51e0',1.3]
  ];


  emaSpec.forEach(
    ([key,color,width])=>{

      ctx.strokeStyle=color;
      ctx.lineWidth=width;
      ctx.setLineDash([]);

      ctx.beginPath();

      let started=false;

      I[key].forEach(
        (value,i)=>{

          if(
            !Number.isFinite(value)
          ){
            return;
          }

          if(!started){

            ctx.moveTo(
              X(i),
              Y(value)
            );

            started=true;

          }else{

            ctx.lineTo(
              X(i),
              Y(value)
            );
          }
        }
      );

      ctx.stroke();
    }
  );


  /* =====================================================
     VWAP COLOR ONLY

     상승 = 청록 실선
     하락 = 빨강 실선
     평탄 = 형광 노랑 점선

     BUY / SELL / READY / CONFIRM
     마킹 없음
     ===================================================== */

  const UP_COLOR='#00A6D6';

  const DOWN_COLOR='#E53935';

  const FLAT_COLOR='#FFD400';


  for(let i=1;i<I.vwap.length;i++){

    const state=
      trendState(trend[i]);

    if(state==='UP'){

      ctx.strokeStyle=
        UP_COLOR;

      ctx.lineWidth=3.0;

      ctx.setLineDash([]);

    }else if(state==='DOWN'){

      ctx.strokeStyle=
        DOWN_COLOR;

      ctx.lineWidth=3.0;

      ctx.setLineDash([]);

    }else{

      ctx.strokeStyle=
        FLAT_COLOR;

      ctx.lineWidth=4.0;

      ctx.setLineDash(
        [7,5]
      );
    }


    ctx.beginPath();

    ctx.moveTo(
      X(i-1),
      Y(I.vwap[i-1])
    );

    ctx.lineTo(
      X(i),
      Y(I.vwap[i])
    );

    ctx.stroke();
  }


  ctx.setLineDash([]);


  /* 진행봉 표시 */

  const last=
    bars.at(-1);

  if(
    last &&
    !last.complete
  ){

    const x=
      X(bars.length-1);

    ctx.fillStyle=
      'rgba(0,0,0,0.04)';

    ctx.fillRect(
      x-candleWidth,
      pad.t,
      candleWidth*2,
      plotH
    );
  }


  /* PRICE SCALE */

  ctx.fillStyle='#555';

  ctx.font=
    '11px sans-serif';

  ctx.fillText(
    max.toFixed(1),
    3,
    pad.t+4
  );

  ctx.fillText(
    min.toFixed(1),
    3,
    pad.t+plotH
  );
}


/* =========================================================
   STATUS
   ========================================================= */

function latestVWAP(){

  const a=
    allBars(C[240]);

  if(a.length<10){

    return{
      state:'FLAT',
      pct:NaN
    };
  }

  const I=
    indicators(a);

  const t=
    vwapTrendSeries(I.vwap);

  const pct=
    t.at(-1);

  return{
    state:
      trendState(pct),
    pct
  };
}


/* =========================================================
   RENDER
   ========================================================= */

function render(){

  draw(
    E.c960,
    allBars(C[960])
  );

  draw(
    E.c240,
    allBars(C[240])
  );


  E.p240.textContent=
    `${C[240].cur?.count||0}/240 · 완성 ${C[240].done.length}`;


  E.p960.textContent=
    `${C[960].cur?.count||0}/960 · 완성 ${C[960].done.length}`;


  const s=
    latestVWAP();


  const pctText=
    Number.isFinite(s.pct)
      ? `${s.pct>=0?'+':''}${s.pct.toFixed(3)}%`
      : '-';


  E.v.textContent=
    `VWAP20 ${s.state} ${pctText}`;


  E.v.className=
    'badge '+
    (
      s.state==='UP'
      ? 'up'
      : s.state==='DOWN'
      ? 'down'
      : 'flat'
    );


  if(E.sig){

    E.sig.textContent=
      'VWAP COLOR ONLY';

    E.sig.className=
      'signal wait';
  }
}


/* =========================================================
   ADD TRADE
   ========================================================= */

function add(raw){

  const t={

    p:
      Number(raw.trade_price),

    q:
      Number(raw.trade_volume)||0,

    s:
      raw.ask_bid||'',

    ts:
      Number(raw.timestamp)||
      Date.now(),

    sid:
      raw.sequential_id??null,

    seq:
      seq++
  };


  C[240].add(t);

  C[960].add(t);


  if(t.sid!=null){

    lastSid=t.sid;
  }
}


/* =========================================================
   SAVE / RESTORE
   ========================================================= */

function saveState(){

  try{

    localStorage.setItem(
      STATE_KEY,
      JSON.stringify({
        v:VERSION,
        seq,
        lastSid,
        b240:C[240],
        b960:C[960]
      })
    );

    E.save.textContent=
      '자동 저장됨';

  }catch(e){

    E.save.textContent=
      '저장 실패';
  }
}


function loadState(){

  try{

    const state=
      JSON.parse(
        localStorage.getItem(
          STATE_KEY
        )||'null'
      );


    if(
      !state ||
      state.v!==VERSION
    ){
      return false;
    }


    seq=
      state.seq||0;

    lastSid=
      state.lastSid??null;


    Object.assign(
      C[240],
      state.b240||{}
    );

    Object.assign(
      C[960],
      state.b960||{}
    );


    return !!(
      C[240].done.length ||
      C[960].done.length
    );


  }catch(e){

    return false;
  }
}


/* =========================================================
   CLOUDFLARE WORKER REST
   ========================================================= */

async function fetchPage(cursor=null){

  const u=
    new URL(PROXY);

  u.searchParams.set(
    'market',
    MARKET
  );

  u.searchParams.set(
    'count',
    String(PAGE_SIZE)
  );


  if(cursor!=null){

    u.searchParams.set(
      'cursor',
      String(cursor)
    );
  }


  const response=
    await fetch(
      u.toString(),
      {
        cache:'no-store'
      }
    );


  if(!response.ok){

    throw new Error(
      'HTTP '+
      response.status
    );
  }


  return await response.json();
}


/* =========================================================
   INITIAL 120,000 TRADE PREFILL
   ========================================================= */

async function prefill(){

  if(historyLoading)return;

  historyLoading=true;


  E.conn.textContent=
    '과거데이터 준비';


  let rows=[];
  let cursor=null;


  try{

    const maxPages=
      Math.ceil(
        TOTAL_TARGET/PAGE_SIZE
      )+10;


    for(
      let page=0;
      page<maxPages &&
      rows.length<TOTAL_TARGET;
      page++
    ){

      const data=
        await fetchPage(cursor);


      if(
        !Array.isArray(data) ||
        !data.length
      ){
        break;
      }


      for(const r of data){

        rows.push({
          trade_price:
            r.trade_price,

          trade_volume:
            r.trade_volume,

          ask_bid:
            r.ask_bid,

          timestamp:
            r.timestamp,

          sequential_id:
            r.sequential_id
        });


        if(
          rows.length>=TOTAL_TARGET
        ){
          break;
        }
      }


      cursor=
        data.at(-1)
          ?.sequential_id;


      E.hist.textContent=
        `과거체결 ${rows.length.toLocaleString()}/${TOTAL_TARGET.toLocaleString()}`;


      E.hb.textContent=
        `${Math.min(
          100,
          rows.length/
          TOTAL_TARGET*100
        ).toFixed(0)}%`;


      await sleep(
        DELAY_MS
      );
    }


    /* API: 최신 → 과거
       차트: 과거 → 최신 */

    rows.reverse();


    C[240].reset();
    C[960].reset();

    seq=0;
    lastSid=null;


    for(
      let i=0;
      i<rows.length;
      i++
    ){

      add(rows[i]);


      if(i%5000===0){

        E.hist.textContent=
          `봉 생성 ${i.toLocaleString()}/${rows.length.toLocaleString()}`;

        render();

        await sleep(0);
      }
    }


    saveState();

    render();


    E.hist.textContent=
      `과거 ${rows.length.toLocaleString()}건 · 240T ${C[240].done.length}봉 · 960T ${C[960].done.length}봉`;


    E.hb.textContent=
      `${Math.min(
        100,
        rows.length/
        TOTAL_TARGET*100
      ).toFixed(0)}%`;


  }catch(e){

    console.warn(e);

    E.hist.textContent=
      `과거데이터 일시중단 · ${rows.length.toLocaleString()}건`;

    E.hb.textContent=
      `${Math.min(
        100,
        rows.length/
        TOTAL_TARGET*100
      ).toFixed(0)}%`;

  }finally{

    historyLoading=false;
  }
}


/* =========================================================
   GAP BACKFILL
   ========================================================= */

async function backfillGap(){

  if(lastSid==null)return;


  try{

    let rows=[];
    let cursor=null;
    let found=false;


    for(
      let page=0;
      page<300;
      page++
    ){

      const data=
        await fetchPage(cursor);


      if(!data.length){
        break;
      }


      for(const r of data){

        if(
          String(
            r.sequential_id
          )===
          String(
            lastSid
          )
        ){

          found=true;
          break;
        }

        rows.push(r);
      }


      if(found){
        break;
      }


      cursor=
        data.at(-1)
          ?.sequential_id;


      await sleep(
        DELAY_MS
      );
    }


    rows.reverse();


    rows.forEach(add);


    if(rows.length){

      E.hist.textContent=
        `누락 ${rows.length.toLocaleString()}건 보충`;

      saveState();

      render();
    }


  }catch(e){

    console.warn(e);

    E.hist.textContent=
      '누락 보충 실패 · 실시간 계속';
  }
}


/* =========================================================
   WEBSOCKET
   ========================================================= */

async function parseMessage(data){

  try{

    if(data instanceof Blob){

      return JSON.parse(
        await data.text()
      );
    }


    if(
      data instanceof ArrayBuffer
    ){

      return JSON.parse(
        new TextDecoder()
        .decode(data)
      );
    }


    return JSON.parse(data);


  }catch(e){

    return null;
  }
}


function connect(){

  if(ws){

    try{
      ws.close();
    }catch(e){}
  }


  E.conn.textContent=
    '연결 중';


  ws=
    new WebSocket(WS);


  ws.binaryType=
    'arraybuffer';


  ws.onopen=()=>{

    ws.send(
      JSON.stringify([
        {
          ticket:
            'xrp-v4-3-'+
            Date.now()
        },
        {
          type:'trade',
          codes:[MARKET],
          is_only_realtime:true
        },
        {
          format:'DEFAULT'
        }
      ])
    );


    E.conn.textContent=
      '실시간 연결';

    E.conn.className=
      'badge up';
  };


  ws.onmessage=
    async event=>{

      const m=
        await parseMessage(
          event.data
        );


      if(
        !m ||
        m.type!=='trade' ||
        m.code!==MARKET
      ){
        return;
      }


      if(
        lastSid!=null &&
        m.sequential_id!=null &&
        String(
          m.sequential_id
        )===
        String(
          lastSid
        )
      ){
        return;
      }


      add(m);

      liveCount++;


      E.price.textContent=
        `${Number(
          m.trade_price
        ).toLocaleString()} KRW`;


      E.count.textContent=
        `실시간 ${liveCount.toLocaleString()}`;


      render();


      clearTimeout(
        saveTimer
      );


      saveTimer=
        setTimeout(
          saveState,
          1000
        );
    };


  ws.onclose=()=>{

    E.conn.textContent=
      '재연결 대기';

    E.conn.className=
      'badge flat';


    setTimeout(
      connect,
      3000
    );
  };


  ws.onerror=()=>{

    E.conn.textContent=
      '연결 오류';
  };
}


/* =========================================================
   START
   ========================================================= */

async function start(){

  const restored=
    loadState();


  if(restored){

    E.hist.textContent=
      `저장 복원 · 240T ${C[240].done.length}봉 · 960T ${C[960].done.length}봉`;

    E.hb.textContent=
      '100%';

    render();

    await backfillGap();

  }else{

    await prefill();

    await backfillGap();
  }


  connect();
}


/* =========================================================
   EVENTS
   ========================================================= */

E.re.onclick=
  async()=>{

    await backfillGap();

    connect();
  };


addEventListener(
  'resize',
  render
);


document.addEventListener(
  'visibilitychange',
  async()=>{

    if(
      document.visibilityState===
      'visible'
    ){

      await backfillGap();


      if(
        !ws ||
        ws.readyState>1
      ){
        connect();
      }

    }else{

      saveState();
    }
  }
);


addEventListener(
  'beforeunload',
  saveState
);


if(
  'serviceWorker' in navigator
){

  navigator.serviceWorker
    .register('./sw.js')
    .catch(()=>{});
}


start();


setInterval(
  render,
  1000
);

})();
