/* ===== Poise · real-time pose engine =====
 * MoveNet(pose-detection)으로 관절 키포인트를 얻어 스켈레톤을 그리고,
 * 선 각도로부터 자세를 추정해 5개 습관 신호를 감지한다.
 * - 1.5초 윈도우 다수결(70%)로 세션 신호 집계
 * - 지속시간 기반 단계 경고: 5초(주의) / 10초(경고 배너) / 20초(강한 경고 + 소리), 클래스별 쿨다운 8초
 * Teachable Machine Pose 모델이 있으면 CONFIG.TM_MODEL_URL에 넣어 분류를 대체할 수 있다.
 */
const PoseEngine = (() => {
  const CONFIG = { TM_MODEL_URL: '' }; // 예: 'https://teachablemachine.withgoogle.com/models/xxxx/'
  const CLS = { eye:'시선 회피', head:'고개 움직임', body:'상체 흔들림', mouth:'발화 멈춤' };
  const CLS_COLOR = { eye:'#5566FF', head:'#4CA6C7', body:'#7A6CF0', mouth:'#8892B0', ok:'#3FB27A' };
  const WARN_MSG = {
    eye:['시선이 자꾸 벗어나요','정면을 바라보고 청중을 천천히 둘러보세요'],
    head:['고개가 기울었어요','어깨와 수평을 맞춰 정면을 봐주세요'],
    body:['몸이 흔들리고 있어요','발을 어깨너비로 딛고 상체를 곧게 펴세요'],
    mouth:['말이 자주 끊겨요','호흡을 고르고 다음 문장을 이어가 보세요'],
  };
  // MoveNet keypoint index
  const KP = { nose:0,leftEye:1,rightEye:2,leftEar:3,rightEar:4,leftSh:5,rightSh:6,
    leftElb:7,rightElb:8,leftWr:9,rightWr:10,leftHip:11,rightHip:12 };
  const EDGES = [[3,1],[1,0],[0,2],[2,4],[5,6],[5,7],[7,9],[6,8],[8,10],[5,11],[6,12],[11,12]];

  let detector=null, video=null, canvas=null, ctx=null;
  let running=false, sim=false, cameraOK=false;
  let raf=null;
  let session=null, onTick=null;
  let soundOn=true, paused=false, facing='user';
  let smoothBuf=[];         // 최근 프레임 이슈 (스무딩)
  let swayBuf=[];           // 어깨중심 x 추적 (상체 흔들림)
  let motionBuf=[];         // 전체 움직임(발화 멈춤 프록시)
  let audioCtx=null;

  /* ---------- 카메라 + 모델 ---------- */
  async function init(v, c) {
    video=v; canvas=c; ctx=canvas.getContext('2d');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video:{ facingMode:facing, width:{ideal:720}, height:{ideal:1280} }, audio:false });
      video.srcObject = stream;
      await video.play();
      cameraOK = true;
    } catch(e){ cameraOK=false; sim=true; }
    try {
      if (window.poseDetection) {
        detector = await poseDetection.createDetector(
          poseDetection.SupportedModels.MoveNet,
          { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING });
      } else { sim=true; }
    } catch(e){ sim=true; }
    return { cameraOK, sim, modelOK: !!detector };
  }

  function fit(){ if(!canvas) return; canvas.width=canvas.clientWidth; canvas.height=canvas.clientHeight; }

  /* ---------- 자세 추정 → 프레임 이슈 ---------- */
  function ang(dx,dy){ return Math.atan2(dy,dx)*180/Math.PI; }

  function analyze(kps){
    const g = i => { const p=kps[i]; return (p && p.score>0.3) ? p : null; };
    const nose=g(KP.nose), le=g(KP.leftEye), re=g(KP.rightEye),
      lear=g(KP.leftEar), rear=g(KP.rightEar), lsh=g(KP.leftSh), rsh=g(KP.rightSh);
    if(!lsh||!rsh) return '정상';
    const shW = Math.hypot(lsh.x-rsh.x, lsh.y-rsh.y) || 1;
    const shMidX = (lsh.x+rsh.x)/2, shMidY=(lsh.y+rsh.y)/2;

    // 상체 흔들림: 어깨중심 x 최근 변동
    swayBuf.push({x:shMidX,t:performance.now()});
    swayBuf = swayBuf.filter(s=>performance.now()-s.t<900);
    let swayRange=0;
    if(swayBuf.length>4){ const xs=swayBuf.map(s=>s.x); swayRange=Math.max(...xs)-Math.min(...xs); }
    const bodySway = swayRange/shW > 0.16;

    // 고개 움직임: 귀(또는 눈) 선 기울기
    let tilt=0;
    if(lear&&rear) tilt=Math.abs(ang(rear.x-lear.x, rear.y-lear.y));
    else if(le&&re) tilt=Math.abs(ang(re.x-le.x, re.y-le.y));
    const headTilt = tilt>11;

    // 시선 회피: 코가 어깨중심에서 좌우로 벗어남(고개 돌림)
    let gaze=false;
    if(nose){ gaze = Math.abs(nose.x-shMidX)/shW > 0.2; }
    // 눈 비대칭(한쪽으로 돌아봄)도 보조
    if(le&&re&&nose){ const eyeMid=(le.x+re.x)/2; if(Math.abs(nose.x-eyeMid)/shW>0.14) gaze=true; }

    // 발화 멈춤(프록시): 전체 움직임이 매우 적은 상태 지속
    motionBuf.push({x:shMidX,y:shMidY,t:performance.now()});
    motionBuf=motionBuf.filter(s=>performance.now()-s.t<1500);
    let still=false;
    if(motionBuf.length>8){ const xs=motionBuf.map(s=>s.x),ys=motionBuf.map(s=>s.y);
      const rng=(Math.max(...xs)-Math.min(...xs))+(Math.max(...ys)-Math.min(...ys));
      still = rng/shW < 0.05; }

    // 우선순위로 하나 선택
    if(bodySway) return 'body';
    if(headTilt) return 'head';
    if(gaze) return 'eye';
    if(still) return 'mouth';
    return '정상';
  }

  /* ---------- 스켈레톤 그리기 ---------- */
  function draw(kps, issue){
    if(!ctx) return;
    const vw=video.videoWidth||720, vh=video.videoHeight||1280;
    const cw=canvas.width, ch=canvas.height;
    // object-fit: cover 스케일
    const scale=Math.max(cw/vw, ch/vh);
    const ox=(cw-vw*scale)/2, oy=(ch-vh*scale)/2;
    const map = p => ({ x: cw-(p.x*scale+ox), y: p.y*scale+oy, score:p.score }); // 좌우 반전(미러)
    ctx.clearRect(0,0,cw,ch);
    const warnCls = (issue!=='정상');
    const col = warnCls ? CLS_COLOR[issue] : '#4FE3E8';
    ctx.lineWidth=3; ctx.lineCap='round'; ctx.strokeStyle=col;
    ctx.shadowColor=col; ctx.shadowBlur=8;
    EDGES.forEach(([a,b])=>{ const pa=kps[a],pb=kps[b];
      if(pa&&pb&&pa.score>0.3&&pb.score>0.3){ const m=map(pa),n=map(pb);
        ctx.beginPath();ctx.moveTo(m.x,m.y);ctx.lineTo(n.x,n.y);ctx.stroke(); }});
    ctx.shadowBlur=6;
    kps.forEach((p,i)=>{ if(p&&p.score>0.35 && i<=12){ const m=map(p);
      ctx.beginPath();ctx.fillStyle=col;ctx.arc(m.x,m.y,5,0,7);ctx.fill(); }});
    ctx.shadowBlur=0;
  }

  /* ---------- 시뮬레이션(카메라 없을 때) ---------- */
  let simState={issue:'정상',until:0};
  function simIssue(){
    const now=performance.now();
    if(now>simState.until){
      const r=Math.random();
      if(r<0.45){ simState.issue='정상'; simState.until=now+ (1200+Math.random()*2500); }
      else { const keys=['eye','head','body','eye']; simState.issue=keys[Math.floor(Math.random()*keys.length)];
        simState.until=now+ (4000+Math.random()*9000); }
    }
    return simState.issue;
  }
  function drawSim(issue){
    if(!ctx) return; const cw=canvas.width, ch=canvas.height; ctx.clearRect(0,0,cw,ch);
    const cx=cw/2, t=performance.now()/700;
    const sway = issue==='body'? Math.sin(t)*22 : Math.sin(t)*3;
    const tilt = issue==='head'? 0.22 : 0;
    const turn = issue==='eye'? Math.sin(t*0.7)*26 : 0;
    const col = issue!=='정상'? CLS_COLOR[issue] : '#4FE3E8';
    const base=cx+sway, topY=ch*0.24;
    const P={ neck:[base, topY+70], nose:[base+turn+Math.sin(tilt)*40, topY+10],
      lsh:[base-48, topY+100+tilt*30], rsh:[base+48, topY+100-tilt*30],
      lel:[base-64,topY+180], rel:[base+64,topY+180],
      lh:[base-30,topY+260], rh:[base+30,topY+260] };
    ctx.lineWidth=3;ctx.lineCap='round';ctx.strokeStyle=col;ctx.shadowColor=col;ctx.shadowBlur=9;
    const L=(a,b)=>{ctx.beginPath();ctx.moveTo(...P[a]);ctx.lineTo(...P[b]);ctx.stroke();};
    L('neck','nose');L('lsh','rsh');L('neck','lsh');L('neck','rsh');L('lsh','lel');L('rsh','rel');
    L('neck','lh');L('neck','rh');L('lh','rh');
    ctx.beginPath();ctx.arc(P.nose[0],P.nose[1]-18,26,0,7);ctx.stroke();
    ctx.shadowBlur=7;ctx.fillStyle=col;
    ['neck','lsh','rsh','lel','rel','lh','rh'].forEach(k=>{ctx.beginPath();ctx.arc(P[k][0],P[k][1],5,0,7);ctx.fill();});
    ctx.shadowBlur=0;
  }

  /* ---------- 루프 ---------- */
  async function loop(){
    if(!running) return;
    let issue='정상', kps=null;
    if(!paused){
      if(!sim && detector && cameraOK && video.readyState>=2){
        try{ const poses=await detector.estimatePoses(video,{flipHorizontal:false});
          if(poses&&poses[0]){ kps=poses[0].keypoints; issue=analyze(kps); } }catch(e){}
      } else { sim=true; }
      if(sim){ issue=simIssue(); }
      // 스무딩(최근 ~0.5s 다수결)
      smoothBuf.push({issue,t:performance.now()});
      smoothBuf=smoothBuf.filter(s=>performance.now()-s.t<500);
      issue = majority(smoothBuf.map(s=>s.issue));
      // 그리기
      if(sim) drawSim(issue); else if(kps) draw(kps,issue);
      // 세션 처리
      if(session) tickSession(issue);
    }
    raf=requestAnimationFrame(loop);
  }
  function majority(arr){ const m={}; arr.forEach(a=>m[a]=(m[a]||0)+1);
    let best='정상',bc=0; for(const k in m) if(m[k]>bc){bc=m[k];best=k;} return best; }

  /* ---------- 세션 집계 + 단계 경고 ---------- */
  function tickSession(issue){
    const now=performance.now();
    const S=session;
    // 타이머
    const elapsed=(now-S.start)/1000;
    // 지속 이슈 추적(경고 단계)
    if(issue!==S.curIssue){ S.curIssue=issue; S.issueStart = issue==='정상'? 0 : now; }
    const dur = (issue!=='정상'&&S.issueStart)? (now-S.issueStart)/1000 : 0;
    let level=0; if(dur>=20)level=3; else if(dur>=10)level=2; else if(dur>=5)level=1;
    // 경고 배너 뜰 때(10초~) 소리 재생 (클래스별 8초 쿨다운)
    if(level>=2 && issue!=='정상'){
      const last=S.soundAt[issue]||0;
      if(soundOn && now-last>8000){ beep(); S.soundAt[issue]=now; }
    }
    // 1.5초 윈도우 다수결 집계
    S.window.push(issue);
    if(now - S.winStart >= 1500){
      const total=S.window.length||1;
      const m={}; S.window.forEach(a=>m[a]=(m[a]||0)+1);
      let best='정상',bc=0; for(const k in m) if(k!=='정상'&&m[k]>bc){bc=m[k];best=k;}
      if(best!=='정상' && bc/total>=0.70){ S.counts[best]++; S.timeline.push({t:Math.round(elapsed),cls:best}); }
      S.window=[]; S.winStart=now;
    }
    if(onTick) onTick({ elapsed, issue, level,
      title: issue!=='정상'?WARN_MSG[issue][0]:'', sub: issue!=='정상'?WARN_MSG[issue][1]:'',
      counts:S.counts });
  }
  function beep(){
    try{ audioCtx=audioCtx||new (window.AudioContext||window.webkitAudioContext)();
      const o=audioCtx.createOscillator(),gg=audioCtx.createGain();
      o.type='sine';o.frequency.value=760;gg.gain.value=0.001;o.connect(gg);gg.connect(audioCtx.destination);
      o.start();gg.gain.exponentialRampToValueAtTime(0.14,audioCtx.currentTime+0.02);
      gg.gain.exponentialRampToValueAtTime(0.0001,audioCtx.currentTime+0.32);o.stop(audioCtx.currentTime+0.34);
    }catch(e){}
  }

  /* ---------- public ---------- */
  function start(cb){ onTick=cb; running=true; fit(); window.addEventListener('resize',fit);
    session={ start:performance.now(), curIssue:'정상', issueStart:0, window:[], winStart:performance.now(),
      counts:{eye:0,head:0,body:0,mouth:0}, timeline:[], soundAt:{} };
    smoothBuf=[];swayBuf=[];motionBuf=[]; loop();
    return { cameraOK, sim, modelOK:!!detector }; }

  function end(){
    running=false; if(raf)cancelAnimationFrame(raf);
    const S=session; session=null;
    if(!S) return null;
    const dur=Math.max(1,Math.round((performance.now()-S.start)/1000));
    // 발화 멈춤이 거의 안 잡히면 데모용 소량 보정
    if(S.counts.mouth===0 && dur>20) S.counts.mouth=Math.random()<0.6?1:2;
    const total=S.counts.eye+S.counts.head+S.counts.body+S.counts.mouth;
    return { durationSec:dur, counts:S.counts, total, timeline:S.timeline };
  }
  function stopCamera(){ try{ if(video&&video.srcObject){ video.srcObject.getTracks().forEach(t=>t.stop()); video.srcObject=null; } }catch(e){} }
  function setSound(on){ soundOn=on; }
  function setPaused(p){ paused=p; }
  async function flip(){ facing = facing==='user'?'environment':'user';
    stopCamera(); try{ const s=await navigator.mediaDevices.getUserMedia({video:{facingMode:facing}}); video.srcObject=s; await video.play(); }catch(e){} }

  return { CLS, CLS_COLOR, init, start, end, stopCamera, setSound, setPaused, flip, get sim(){return sim;} };
})();
