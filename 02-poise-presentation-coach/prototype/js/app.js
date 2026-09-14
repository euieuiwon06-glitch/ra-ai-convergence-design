/* ===== Poise · app controller ===== */
(() => {
const CLS = { eye:'시선 회피', head:'고개 움직임', body:'상체 흔들림', mouth:'발화 멈춤' };
const COL = { eye:'#5566FF', head:'#4CA6C7', body:'#7A6CF0', mouth:'#8892B0' };
const $=(s,r=document)=>r.querySelector(s); const $$=(s,r=document)=>[...r.querySelectorAll(s)];

/* ===== Supabase (영상·기록 영구 저장) =====
 * 아래 두 값이 채워지면 녹화본을 Storage에, 세션 기록을 DB에 저장하고 재접속 후에도 불러온다.
 * 비어 있으면(공유 데모/아티팩트) 지금처럼 localStorage 데모로 동작한다. */
const SUPABASE_URL  = 'https://uwgpmarptqsbukwkjjcr.supabase.co';
const SUPABASE_ANON = 'sb_publishable_XqsgnaeKc6Ju4TN63Poh4g_rpyjQxBf';
const sb = (SUPABASE_URL && SUPABASE_ANON && window.supabase)
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON) : null;
const BUCKET = 'recordings';

/* ---------- state / storage ---------- */
const KEY='poise.sessions.v1';
function load(){ try{ return JSON.parse(localStorage.getItem(KEY))||[]; }catch(e){ return []; } }
function save(list){ localStorage.setItem(KEY, JSON.stringify(list)); }
function seed(){
  const base=new Date(2026,7,1); // 2026-08-01
  const demo=[
    ['2026-08-01',222, {eye:6,head:4,body:4,mouth:8}],
    ['2026-08-03',250, {eye:11,head:5,body:5,mouth:4}],
    ['2026-08-05',195, {eye:7,head:9,body:5,mouth:3}],
    ['2026-08-08',242, {eye:8,head:4,body:4,mouth:3}],
    ['2026-08-09',192, {eye:7,head:4,body:5,mouth:3}],
    ['2026-08-10',220, {eye:8,head:5,body:3,mouth:2}],
  ];
  return demo.map((d,i)=>mkSession(new Date(d[0]+'T15:40:00'), d[1], d[2], i));
}
function mkSession(date, durationSec, counts, id){
  const total=counts.eye+counts.head+counts.body+counts.mouth;
  const timeline=[];
  Object.keys(counts).forEach(c=>{ for(let k=0;k<counts[c];k++) timeline.push({t:Math.round(Math.random()*durationSec),cls:c}); });
  return { id: id!=null?('d'+id):('s'+Date.now()), date:date.toISOString(), durationSec, counts, total, timeline };
}
let sessions = load(); if(!sessions.length){ sessions=seed(); save(sessions); }
sessions.sort((a,b)=>new Date(a.date)-new Date(b.date));
let viewingId = sessions[sessions.length-1].id;

const topHabitOf = c => { let k='eye',v=-1; for(const x in c) if(c[x]>v){v=c[x];k=x;} return k; };
const fmtDate = iso => { const d=new Date(iso); return `${d.getMonth()+1}월 ${d.getDate()}일`; };
const fmtDur = s => `${Math.floor(s/60)}분 ${String(s%60).padStart(2,'0')}초`;
const ampm = iso => { const d=new Date(iso); const h=d.getHours(); const ap=h<12?'오전':'오후'; const hh=((h+11)%12)+1; return `${ap} ${hh}:${String(d.getMinutes()).padStart(2,'0')}`; };
const WD=['일','월','화','수','목','금','토'];
// 받침 유무로 주격조사 이/가 선택
function subjP(w){ const c=w.charCodeAt(w.length-1); const hasBatchim=(c>=0xAC00&&c<=0xD7A3)&&((c-0xAC00)%28!==0); return w+(hasBatchim?'이':'가'); }

/* ---------- navigation ---------- */
let cur='splash';
let navStack=[];
const REAL=new Set(['home','report','calendar','list']); // 히스토리에 남길 "실제" 화면
function go(name, isBack){
  if(name===cur) return;
  const prev=$(`.screen[data-screen="${cur}"]`); const next=$(`.screen[data-screen="${name}"]`);
  if(!next) return;
  if(cur==='recording' && name!=='recording' && coachOn) stopCoach(true);
  if(cur==='report' && name!=='report') rpStop();
  // 뒤로가기가 아니고, 떠나는 화면이 실제 화면이면 히스토리에 저장
  if(!isBack && REAL.has(cur) && navStack[navStack.length-1]!==cur) navStack.push(cur);
  prev&&prev.classList.remove('is-active'); next.classList.add('is-active'); next.scrollTop=0; cur=name;
  const tc=document.querySelector('meta[name=theme-color]'); if(tc) tc.setAttribute('content', next.classList.contains('screen--camera')?'#1B2246':'#5566FF');
  if(name==='home'){ navStack=[]; renderHome(); }
  if(name==='report') renderReport();
  if(name==='calendar') renderCalendar();
  if(name==='list') renderList();
  if(name==='countdown') startCountdown();
  if(name==='analyzing') runAnalyzing();
}
function goBack(){ const prev=navStack.pop(); go(prev||'home', true); }
document.addEventListener('click', e=>{
  if(e.target.closest('[data-back]')){ goBack(); return; }
  const t=e.target.closest('[data-go]'); if(t){ go(t.getAttribute('data-go')); }
});

/* ---------- splash auto ---------- */
setTimeout(()=>{ if(cur==='splash') go('onboarding'); }, 1900);

/* ---------- home ---------- */
function renderHome(){
  const s=sessions[sessions.length-1]; const prev=sessions[sessions.length-2];
  viewingId=s.id;
  $('#homeCount').textContent=s.total;
  const meta=`${fmtDate(s.date)} ${ampm(s.date)} · ${fmtDur(s.durationSec)} 연습`; $('#homeMeta').textContent=meta;
  const d=prev?prev.total-s.total:0; const chip=$('#homeDelta');
  if(!prev){ chip.textContent='첫 세션'; }
  else if(d>0){ chip.textContent=`지난 회차보다 ${d} ↓`; chip.className='chip chip--good'; }
  else if(d<0){ chip.textContent=`지난 회차보다 ${-d} ↑`; chip.className='chip'; chip.style.background='#FDECD9'; chip.style.color='#C0552B'; }
  else chip.textContent='지난 회차와 동일';
}

/* ---------- countdown ---------- */
let cdTimer=null;
function startCountdown(){
  const num=$('#cdNum'); let n=3; num.textContent=n;   // 링은 CSS로 시계방향 회전
  clearInterval(cdTimer);
  cdTimer=setInterval(()=>{ n--; if(n<=0){ clearInterval(cdTimer); go('recording'); return; } num.textContent=n; },1000);
}

/* ---------- camera coaching (05 recording · 12 real-time) ---------- */
let coachOn=false, coachMode=null, holdRAF=null;
const mmss = s => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(Math.floor(s%60)).padStart(2,'0')}`;

/* ---------- 영상 녹화(MediaRecorder) — 다시보기에서 실제 녹화본 재생 ---------- */
let mediaRec=null, recChunks=[];
const videoUrls={};   // sessionId -> objectURL (메모리 전용; 새로고침하면 사라짐)
function startVideoRec(videoEl){
  recChunks=[]; mediaRec=null;
  try{
    const stream=videoEl && videoEl.srcObject;
    if(!stream || !window.MediaRecorder) return;                 // 카메라 없음 → 녹화 없음(자리표시자)
    const cands=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm','video/mp4'];
    const mime=cands.find(m=>{ try{return MediaRecorder.isTypeSupported(m);}catch(e){return false;} });
    mediaRec=new MediaRecorder(stream, mime?{mimeType:mime}:undefined);
    mediaRec.ondataavailable=e=>{ if(e.data && e.data.size) recChunks.push(e.data); };
    mediaRec.start();
  }catch(err){ mediaRec=null; }
}
function stopVideoRec(){
  return new Promise(resolve=>{
    if(!mediaRec || mediaRec.state==='inactive'){ mediaRec=null; resolve(null); return; }
    mediaRec.onstop=()=>{
      try{
        if(!recChunks.length){ resolve(null); return; }
        const blob=new Blob(recChunks,{type:recChunks[0].type||'video/webm'});
        resolve(URL.createObjectURL(blob));
      }catch(e){ resolve(null); } finally{ mediaRec=null; recChunks=[]; }
    };
    try{ mediaRec.stop(); }catch(e){ mediaRec=null; resolve(null); }
  });
}
function abortVideoRec(){ if(mediaRec){ try{ mediaRec.onstop=null; mediaRec.ondataavailable=null; if(mediaRec.state!=='inactive') mediaRec.stop(); }catch(e){} mediaRec=null; recChunks=[]; } }

async function startCoach(){
  coachOn=true;
  PoseEngine.setPaused(false); PoseEngine.setSound(true);
  const info = await PoseEngine.init($('#recCam'), $('#recOverlay'));
  if(info.cameraOK) startVideoRec($('#recCam'));                   // 실제 영상 녹화 시작
  $('#recModelHint').textContent = info.cameraOK
    ? (info.modelOK?'녹화 중 · MoveNet 실시간 감지':'녹화 중 · 각도 기반 감지')
    : '카메라를 사용할 수 없어 데모 모드로 녹화합니다';
  PoseEngine.start(onRecTick);
}
// 녹화 화면: 시간 표시 + 문제 감지 시 경고 배너·틴트(소리는 pose.js가 재생) — 실시간 감지 통합
function onRecTick(st){
  $('#recTime').textContent = mmss(st.elapsed);
  const tint=$('#alertTint'); if(tint) tint.className='alert-tint'+(st.level>=3?' danger':st.level>=1?' warn':'');
  const banner=$('#warnBanner');
  if(banner){
    if(st.level>=2){ banner.hidden=false; banner.classList.toggle('danger',st.level>=3);
      $('#warnTitle').textContent=st.title; $('#warnSub').textContent=st.sub; }
    else banner.hidden=true;
  }
}
// 세션 종료(공통). discard=true면 결과 폐기(실시간 코칭), false면 데이터 반환(녹화)
function stopCoach(discard){
  if(!coachOn) return null;
  abortVideoRec();
  const data=PoseEngine.end(); PoseEngine.stopCamera(); coachOn=false;
  const banner=$('#warnBanner'); if(banner) banner.hidden=true;
  const tint=$('#alertTint'); if(tint) tint.className='alert-tint';
  return discard?null:data;
}

/* 05 Recording — 길게 눌러 종료 → 분석 → 리포트 */
const recStop=$('#recStop'), recArc=$('#recStopArc'); const REC_C=207.3;
function recHoldStart(e){ e.preventDefault(); const start=performance.now(); const DUR=800;
  const anim=()=>{ const p=Math.min(1,(performance.now()-start)/DUR); recArc.style.strokeDashoffset=REC_C*(1-p);
    if(p>=1){ finishRecording(); return; } holdRAF=requestAnimationFrame(anim); };
  holdRAF=requestAnimationFrame(anim); }
function recHoldEnd(){ if(holdRAF)cancelAnimationFrame(holdRAF); recArc.style.strokeDashoffset=REC_C; }
recStop.addEventListener('pointerdown',recHoldStart); recStop.addEventListener('pointerup',recHoldEnd); recStop.addEventListener('pointerleave',recHoldEnd);
async function finishRecording(){ recHoldEnd();
  const videoUrl=await stopVideoRec();          // 카메라 정지 전에 녹화본 확보
  const data=stopCoach(false);
  if(data){ const s=mkSession(new Date(), data.durationSec, data.counts); s.timeline=data.timeline;
    sessions.push(s); viewingId=s.id;
    if(videoUrl) videoUrls[s.id]=videoUrl;      // 즉시 재생용(로컬 objectURL)
    if(sb) uploadSession(s, videoUrl);          // Supabase: Storage 업로드 + DB 저장(백그라운드)
    else save(sessions); }
  go('analyzing'); }
/* Supabase 업로드: 영상 → Storage, 세션 → DB. 실패해도 메모리엔 남아 이번 세션 재생은 가능 */
async function uploadSession(s, objUrl){
  if(!sb) return;
  try{
    let publicUrl=null;
    if(objUrl){
      const blob=await (await fetch(objUrl)).blob();
      const ext=(blob.type&&blob.type.includes('mp4'))?'mp4':'webm';
      const path=`${s.id}.${ext}`;
      const up=await sb.storage.from(BUCKET).upload(path, blob, {contentType:blob.type||'video/webm', upsert:true});
      if(!up.error) publicUrl=sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    }
    await sb.from('sessions').insert({ id:s.id, date:s.date, duration_sec:s.durationSec,
      counts:s.counts, total:s.total, timeline:s.timeline, video_path:publicUrl });
    if(publicUrl){ videoUrls[s.id]=publicUrl;   // 영구 URL로 교체(새로고침 후에도 재생)
      if(cur==='report') renderReport(); }
  }catch(e){ /* 업로드 실패: 이번 세션 메모리 재생은 유지 */ }
}

// 녹화 화면 진입 시 카메라 세션 시작 (녹화 + 실시간 감지 통합)
(function(){ const el=$('.screen[data-screen="recording"]');
  new MutationObserver(()=>{ if(el.classList.contains('is-active') && !coachOn) startCoach(); })
    .observe(el,{attributes:true,attributeFilter:['class']}); })();

/* ---------- analyzing ---------- */
function runAnalyzing(){
  const steps=['시선 흐름 분석','고개 움직임 분석','상체 흔들림 분석','발화 흐름 분석'];
  $('#anaList').innerHTML=steps.map(s=>`<div class="ana-item"><span class="l"><span class="ana-dot"></span>${s}</span><span class="st">대기</span></div>`).join('');
  let pct=0; const items=$$('#anaItem, .ana-item');
  const fill=$('#anaFill'), num=$('#anaPct');
  const t=setInterval(()=>{ pct=Math.min(100,pct+ (6+Math.random()*10)); num.textContent=Math.round(pct)+'%'; fill.style.transform='scaleX('+(pct/100)+')';
    const done=Math.floor(pct/25); $$('#anaList .ana-item').forEach((it,i)=>{ const d=it.querySelector('.ana-dot'),s=it.querySelector('.st');
      if(i<done){ d.classList.add('done'); s.textContent='완료'; s.classList.add('done'); } else if(i===done){ s.textContent='진행 중'; } });
    if(pct>=100){ clearInterval(t); setTimeout(()=>go('report'),450); } },260);
}

/* ---------- report ---------- */
function getViewing(){ return sessions.find(s=>s.id===viewingId)||sessions[sessions.length-1]; }
function makeDonut(counts,total){
  const order=['eye','head','body','mouth']; const C=2*Math.PI*58; const gap=6; let cum=0; let arcs='';
  order.forEach(k=>{ const share=total?counts[k]/total:0; const len=Math.max(0,share*C-gap);
    arcs+=`<circle cx="75" cy="75" r="58" fill="none" stroke="${COL[k]}" stroke-width="20" stroke-linecap="butt" stroke-dasharray="${len} ${C-len}" stroke-dashoffset="${-cum*C}" transform="rotate(-90 75 75)"/>`;
    cum+=share; });
  return `<svg viewBox="0 0 150 150" width="150" height="150">${arcs}</svg><div class="donut-center"><b class="num-grad">${total}</b><span>회 감지</span></div>`;
}
function renderReport(){
  const s=getViewing(); const idx=sessions.indexOf(s); const prev=sessions[idx-1];
  $('#repMeta').textContent=`${fmtDate(s.date)} · ${fmtDur(s.durationSec)}`;
  $('#repDonut').innerHTML=makeDonut(s.counts,s.total);
  $('#repLegend').innerHTML=['eye','head','body','mouth'].map(k=>
    `<div class="lr"><span class="ln"><i style="background:${COL[k]}"></i>${CLS[k]}</span><span class="lc">${s.counts[k]}</span></div>`).join('');
  const top=topHabitOf(s.counts);
  $('#repComment').textContent = `${subjP(CLS[top])} 가장 잦았어요. ` + ({
    eye:'청중을 천천히 둘러보는 연습을 해봐요.',head:'어깨와 수평을 맞춰 정면을 보는 연습을 해봐요.',
    body:'발을 어깨너비로 딛고 상체를 고정해 보세요.',mouth:'호흡을 고르고 문장을 이어가는 연습을 해봐요.'}[top]);
  // delta
  const box=$('#deltaRows'); const dCard=$('#deltaCard');
  if(prev){ dCard.style.display='';
    const rows=['eye','head','body'].map(k=>({k,d:prev.counts[k]-s.counts[k]})).sort((a,b)=>Math.abs(b.d)-Math.abs(a.d)).slice(0,2);
    box.innerHTML=rows.map(r=>{ let cls='flat',tx='– 유지'; if(r.d>0){cls='down';tx='▼ 개선';} else if(r.d<0){cls='up';tx='▲ 주의';}
      return `<div class="delta-row"><span class="dn">${CLS[r.k]}</span><span class="dc">${prev.counts[r.k]} → ${s.counts[r.k]}회</span><span class="ds ${cls}">${tx}</span></div>`;}).join('');
  } else dCard.style.display='none';
  renderTimeline();   // 녹화 다시보기 + 구간 타임라인
  renderStats();      // 전체 통계 (한 화면에 함께)
}
function renderTimeline(){
  const s=getViewing(); const dur=s.durationSec;
  $('#tlDur').textContent=`총 ${fmtDur(dur)}`;
  $('#tlMid').textContent=`${Math.floor(dur/2/60)}:${String(Math.floor((dur/2)%60)).padStart(2,'0')}`;
  $('#tlEnd').textContent=`${Math.floor(dur/60)}:${String(dur%60).padStart(2,'0')}`;
  // density area graph from timeline
  const bins=12; const arr=new Array(bins).fill(0);
  s.timeline.forEach(e=>{ const b=Math.min(bins-1,Math.floor(e.t/dur*bins)); arr[b]++; });
  const mx=Math.max(1,...arr); const W=300,H=96;
  const pts=arr.map((v,i)=>[i/(bins-1)*W, H-8-(v/mx)*(H-22)]);
  let d='M'+pts.map(p=>p.map(Math.round).join(' ')).join(' L ');
  $('#tlGraph').innerHTML=`<svg viewBox="0 0 ${W} ${H+8}" preserveAspectRatio="none">
    <path d="${d} L ${W} ${H} L 0 ${H} Z" fill="url(#tg)" opacity=".9"/>
    <path d="${d}" fill="none" stroke="#5566FF" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    <defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#5566FF" stop-opacity=".34"/><stop offset="1" stop-color="#5566FF" stop-opacity="0"/></linearGradient></defs></svg>`;
  // tracks
  $('#tlTracks').innerHTML=['eye','head','body','mouth'].map(k=>{
    const marks=s.timeline.filter(e=>e.cls===k).map(e=>`<span class="tl-mark" data-t="${e.t}" style="left:${(e.t/dur*100).toFixed(1)}%;background:${COL[k]}"></span>`).join('');
    return `<div class="tl-row"><span class="tl-name">${CLS[k]}</span><span class="tl-track"><span class="base" style="background:${COL[k]}"></span>${marks}</span></div>`;
  }).join('');
  $$('#tlTracks .tl-mark').forEach(m=>m.addEventListener('click',()=>rpSeek(+m.dataset.t/dur)));
  renderReplay(s);
}

/* ---------- 녹화 다시보기 (replay) ----------
 * 실제 녹화본(videoUrls[id])이 있으면 <video>를 재생하고, 없으면(데모/카메라 없음) 실루엣 목업을 재생 */
let rpRAF=null, rpFrac=0, rpPlaying=false, rpDur=0, rpMarks=[], rpVideoMode=false;
const clock=sec=>{ sec=Math.max(0,Math.round(sec)); return Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0'); };
const hexA=(hex,a)=>{ const n=parseInt(hex.slice(1),16); return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`; };
function renderReplay(s){
  rpStop(); rpDur=s.durationSec; rpFrac=0;
  rpMarks=[...s.timeline].sort((a,b)=>a.t-b.t);
  $('#rpMarks').innerHTML=rpMarks.map((e,i)=>`<span class="rp-mark" data-i="${i}" style="left:${(e.t/rpDur*100).toFixed(1)}%;background:${COL[e.cls]}"></span>`).join('');
  $$('#rpMarks .rp-mark').forEach(m=>m.addEventListener('click',ev=>{ ev.stopPropagation(); rpSeek(rpMarks[+m.dataset.i].t/rpDur); }));
  const vurl=videoUrls[s.id], vid=$('#rpVideo'), sil=$('#rpSil');
  if(vurl && vid){                                  // 실제 녹화본 재생
    rpVideoMode=true; sil.style.display='none'; vid.hidden=false; vid.src=vurl;
    vid.onloadedmetadata=()=>{ if(isFinite(vid.duration)&&vid.duration>0) rpDur=vid.duration; rpApply(); };
    vid.ontimeupdate=()=>{ if(vid.duration){ rpFrac=vid.currentTime/vid.duration; rpApply(); } };
    vid.onended=()=>{ rpPlaying=false; $('#rpPlay').classList.remove('playing'); };
    vid.onerror=()=>{ rpVideoMode=false; vid.hidden=true; sil.style.display=''; rpApply(); };
  } else {                                          // 데모: 실루엣 목업
    rpVideoMode=false;
    if(vid){ vid.hidden=true; vid.removeAttribute('src'); try{vid.load();}catch(e){} }
    if(sil) sil.style.display='';
  }
  rpApply();
}
function rpApply(){
  const cur=rpFrac*rpDur;
  $('#rpTime').textContent=`${clock(cur)} / ${clock(rpDur)}`;
  $('#rpFill').style.width=(rpFrac*100).toFixed(2)+'%';
  $('#rpHead').style.left=(rpFrac*100).toFixed(2)+'%';
  const near=rpMarks.find(e=>Math.abs(e.t-cur)<=2.5);
  const stage=$('#rpStage'), badge=$('#rpBadge'), sil=$('#rpSil');
  if(near){ stage.classList.add('flagged'); stage.style.setProperty('--rp-tint',hexA(COL[near.cls],.5));
    badge.hidden=false; badge.querySelector('i').style.background=COL[near.cls]; badge.querySelector('b').textContent=CLS[near.cls];
    if(!rpVideoMode) sil.style.transform = near.cls==='head'?'rotate(7deg)':near.cls==='body'?'translateX(11px)':near.cls==='eye'?'translateX(-9px)':'scale(.985)';
  } else { stage.classList.remove('flagged'); badge.hidden=true; if(!rpVideoMode&&sil) sil.style.transform='none'; }
}
function rpSeek(frac){ rpFrac=Math.min(1,Math.max(0,frac));
  if(rpVideoMode){ const v=$('#rpVideo'); if(v&&v.duration) v.currentTime=frac*v.duration; }
  rpApply(); }
function rpStart(){ rpPlaying=true; $('#rpPlay').classList.add('playing');
  if(rpVideoMode){ const v=$('#rpVideo'); if(v){ if(rpFrac>=1) v.currentTime=0; v.play().catch(()=>{}); } return; }
  if(rpFrac>=1) rpFrac=0; let last=performance.now(); const PLAY_SEC=22;
  const step=now=>{ const dt=(now-last)/1000; last=now; rpFrac+=dt/PLAY_SEC;
    if(rpFrac>=1){ rpFrac=1; rpApply(); rpStop(); return; } rpApply(); rpRAF=requestAnimationFrame(step); };
  rpRAF=requestAnimationFrame(step);
}
function rpStop(){ rpPlaying=false; if(rpRAF){cancelAnimationFrame(rpRAF);rpRAF=null;}
  if(rpVideoMode){ const v=$('#rpVideo'); if(v){ try{v.pause();}catch(e){} } }
  const p=$('#rpPlay'); if(p)p.classList.remove('playing'); }
$('#rpPlay').addEventListener('click',()=>{ rpPlaying?rpStop():rpStart(); });
$('#rpScrub').addEventListener('click',e=>{ if(e.target.classList.contains('rp-mark'))return; const r=e.currentTarget.getBoundingClientRect(); rpSeek((e.clientX-r.left)/r.width); });

/* ---------- stats ---------- */
function renderStats(){
  const totalPractices=sessions.length;
  const avg=(sessions.reduce((a,s)=>a+s.total,0)/totalPractices).toFixed(1);
  const oldest=sessions[0].total, newest=sessions[sessions.length-1].total;
  const imp=Math.round((oldest-newest)/oldest*100);
  $('#statTiles').innerHTML=[
    [totalPractices,'총 연습(회)'],[avg,'평균 신호'],[(imp>=0?'+':'')+imp+'%','개선률']
  ].map(t=>`<div class="stat-tile"><b>${t[0]}</b><span>${t[1]}</span></div>`).join('');
  const recent=sessions.slice(-6); const mx=Math.max(...recent.map(s=>s.total));
  $('#barChart').innerHTML=recent.map(s=>{ const h=Math.round(s.total/mx*104);
    return `<div class="bar-col"><span class="bv">${s.total}</span><span class="bb" style="height:${h}px"></span><span class="bl">${new Date(s.date).getMonth()+1}/${new Date(s.date).getDate()}</span></div>`;}).join('');
  // top habit aggregate
  const agg={eye:0,head:0,body:0,mouth:0}; let all=0;
  sessions.forEach(s=>['eye','head','body','mouth'].forEach(k=>{agg[k]+=s.counts[k];all+=s.counts[k];}));
  const top=topHabitOf(agg);
  $('#topDot').style.background=COL[top]; $('#topName').textContent=CLS[top];
  $('#topPct').textContent=`전체의 ${Math.round(agg[top]/all*100)}%`;
  $('#stackBar').innerHTML=['eye','head','body','mouth'].map(k=>`<i style="width:${(agg[k]/all*100).toFixed(1)}%;background:${COL[k]}"></i>`).join('');
  $('#topTip').textContent = {eye:'시선을 천천히 옮기는 연습이 도움돼요. 청중을 3~4구역으로 나눠 바라보세요.',
    head:'거울 앞에서 고개를 고정하는 연습을 해보세요.',body:'발을 어깨너비로 딛고 상체를 고정해 보세요.',
    mouth:'호흡을 고르고 문장 사이 공백을 줄여보세요.'}[top];
}

/* ---------- calendar ---------- */
function renderCalendar(){
  const y=2026,m=7; $('#calMonth').textContent='2026. 8';
  const first=new Date(y,m,1).getDay(); const days=new Date(y,m+1,0).getDate();
  const byDay={}; sessions.forEach(s=>{ const d=new Date(s.date); if(d.getFullYear()===y&&d.getMonth()===m) byDay[d.getDate()]=s; });
  const sel=new Date(getViewing().date).getDate();
  let cells='';
  for(let i=0;i<first;i++) cells+='<div class="cal-cell"></div>';
  for(let d=1;d<=days;d++){ const has=byDay[d]; const isSel=has&&d===sel;
    cells+=`<div class="cal-cell ${isSel?'sel':''}" data-day="${d}"><span class="cn">${d}</span>${has?'<span class="cd"></span>':''}</div>`; }
  $('#calGrid').innerHTML=cells;
  $$('#calGrid .cal-cell[data-day]').forEach(c=>c.addEventListener('click',()=>{ const s=byDay[+c.dataset.day]; if(s){ viewingId=s.id; renderCalendar(); renderDayCard(s); } }));
  renderDayCard(byDay[sel]||sessions[sessions.length-1]);
}
function renderDayCard(s){ const top=topHabitOf(s.counts);
  $('#calDayCard').innerHTML=`<span class="accentbar"></span><div class="mid">
    <div class="row-between"><b>${fmtDate(s.date)} ${WD[new Date(s.date).getDay()]}요일</b><span class="chev">›</span></div>
    <span class="micro">${ampm(s.date)} · ${fmtDur(s.durationSec)} 연습</span>
    <div class="r3"><span class="num-row"><b class="num-grad" style="font-size:24px">${s.total}</b><span class="unit" style="font-size:12px">회 감지</span></span>
    <span class="chip" style="background:#E9ECFF;color:#3A45C4;font-size:11px">${CLS[top]}가 최다</span></div></div>`;
  $('#calDayCard').onclick=()=>{ viewingId=s.id; go('report'); };
}

/* ---------- list ---------- */
function renderList(){
  const arr=[...sessions].reverse();
  $('#listWrap').innerHTML=arr.map((s,i)=>{ const top=topHabitOf(s.counts); const prev=arr[i+1];
    let tcls='flat',tx='—'; if(prev){ const d=prev.total-s.total; if(d>0){tcls='down';tx='▼ '+d;} else if(d<0){tcls='up';tx='▲ '+(-d);} }
    return `<button class="list-card ${i===0?'hl':''}" data-id="${s.id}">${i===0?'<span class="acc"></span>':''}
      <div class="lc-l"><b>${fmtDate(s.date)} ${WD[new Date(s.date).getDay()]}</b><p>${fmtDur(s.durationSec)} · ${CLS[top]} 최다</p></div>
      <div class="lc-r"><div class="n">${s.total}<small> 회</small></div><div class="t ${tcls}">${tx}</div></div></button>`;
  }).join('');
  $$('#listWrap .list-card').forEach(c=>c.addEventListener('click',()=>{ viewingId=c.dataset.id; go('report'); }));
}

/* ---------- Supabase: 저장된 기록/영상 불러오기 (데모 데이터에 병합) ---------- */
function reRender(){ if(cur==='home')renderHome(); else if(cur==='list')renderList();
  else if(cur==='stats')renderStats(); else if(cur==='calendar')renderCalendar(); else if(cur==='report')renderReport(); }
async function loadRemote(){
  if(!sb) return;
  try{
    const { data, error } = await sb.from('sessions').select('*').order('date',{ascending:true});
    if(error || !data || !data.length) return;
    const ids=new Set(sessions.map(s=>s.id));
    data.forEach(r=>{ if(ids.has(r.id) || String(r.id).startsWith('__')) return;   // 내부/테스트 id 무시
      sessions.push({ id:r.id, date:r.date, durationSec:r.duration_sec, counts:r.counts,
        total:r.total, timeline:r.timeline||[], video_path:r.video_path });
      if(r.video_path) videoUrls[r.id]=r.video_path;
    });
    sessions.sort((a,b)=>new Date(a.date)-new Date(b.date));
    viewingId=sessions[sessions.length-1].id;
    reRender();
  }catch(e){ /* 실패 시 데모 유지 */ }
}

/* ---------- 프로토타입: 서비스워커/캐시 비활성화 (캐시 꼬임으로 옛 버전이 뜨는 문제 방지) ---------- */
if('serviceWorker' in navigator){ navigator.serviceWorker.getRegistrations().then(rs=>rs.forEach(r=>r.unregister())).catch(()=>{}); }
if(window.caches && caches.keys){ caches.keys().then(ks=>ks.forEach(k=>caches.delete(k))).catch(()=>{}); }

renderHome();
loadRemote();

/* 딥링크(테스트/공유용): index.html#home, #report, #stats ... */
(function(){ const h=location.hash.slice(1); if(h && document.querySelector('.screen[data-screen="'+h+'"]')) go(h); })();
window.addEventListener('hashchange',()=>{ const h=location.hash.slice(1); if(h) go(h); });
})();
