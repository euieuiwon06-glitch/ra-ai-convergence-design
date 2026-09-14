/* =========================================================
   소리 내어 외우는 한국사 — 프로토타입 로직
   - 화면 상태 머신 (스플래시→홈→단원→[카드→듣기→피드백]×5→결과)
   - STT: Web Speech API(ko-KR). 미지원/실패 시 키보드 입력 폴백.
   - 채점: LLM 아님. data.js의 정답_키워드 하드코딩 매칭.
   ========================================================= */

(function () {
  "use strict";

  /* ---------- 조정 가능한 타이밍 (기획 스펙 §3) ---------- */
  const CONFIG = {
    CARD_MS: 3000,        // 카드 노출 시간
    SPEECH_WAIT_MS: 3000, // 이 시간 안에 발화 없으면 '모름' 처리
    SILENCE_MS: 2000      // 발화 후 이만큼 침묵하면 자동 채점
  };

  const DATA = window.QUIZ_DATA;
  const QUESTIONS = DATA.문항;

  /* ---------- 결과 유형 메타 ---------- */
  const RESULT_META = {
    complete: { theme: "green",  emblem: "✓", title: "완전 정답!", sub: "핵심어를 모두 말했어요",              tag: "완전정답", tagClass: "tag-green"  },
    pass:     { theme: "green",  emblem: "✓", title: "통과",       sub: "핵심어 하나를 놓쳤어요 · 보충해 두세요", tag: "통과",     tagClass: "tag-green"  },
    partial:  { theme: "orange", emblem: "!", title: "부분 정답",  sub: "맞춘 부분은 인정 · 핵심어가 부족했어요", tag: "부분정답", tagClass: "tag-orange" },
    unknown:  { theme: "gray",   emblem: "?", title: "모름",       sub: "괜찮아요. 정답을 눈으로 익혀 두세요",    tag: "모름",     tagClass: "tag-gray"   }
  };

  /* ---------- 세션 상태 ---------- */
  let currentIndex = 0;
  let results = [];       // 각 문항의 결과 key
  let matchedByIndex = []; // 각 문항에서 맞춘 키워드 목록
  let statsReturnTo = "home"; // 통계 화면에서 뒤로가기 목적지

  /* ---------- STT 런타임 상태 ---------- */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let finalTranscript = "";
  let waitTimer = null;
  let silenceTimer = null;
  let cardTimer = null;
  let graded = false;
  let forceKeyboard = false;   // 문항별 수동 키보드 전환
  let sttDenied = false;       // 세션 전체: 권한 거부/불가 시 이후 계속 키보드
  let micPrimed = false;       // 마이크 권한 사전 확보 여부
  let micStream = null;        // 퀴즈 내내 유지하는 마이크 스트림(문항마다 재요청 방지)
  let clovaActive = false;     // 현재 문항에서 CLOVA 녹음 진행 중인지

  /* ---------- DOM 헬퍼 ---------- */
  const $ = (sel) => document.querySelector(sel);
  const el = (id) => document.getElementById(id);

  function showScreen(name) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    el("screen-" + name).classList.add("active");
  }

  function normalize(s) {
    return (s || "").replace(/\s+/g, "");
  }

  /* =======================================================
     내비게이션 / 초기화
     ======================================================= */
  function init() {
    buildWave();
    bindEvents();
    // 스플래시 → 홈 자동 전환
    setTimeout(() => showScreen("home"), 1700);
  }

  function bindEvents() {
    el("btn-home-start").addEventListener("click", () => showScreen("unit"));
    el("btn-unit-start").addEventListener("click", startQuiz);
    el("unit-open").addEventListener("click", startQuiz);
    el("btn-next").addEventListener("click", nextQuestion);
    el("btn-retry").addEventListener("click", startQuiz);

    // data-nav="home" 버튼들
    document.querySelectorAll('[data-nav="home"]').forEach((b) =>
      b.addEventListener("click", () => { stopEverything(); showScreen("home"); })
    );

    // 해설 / 원문 버튼
    document.querySelectorAll("[data-doc]").forEach((b) =>
      b.addEventListener("click", () => openSheet(b.getAttribute("data-doc")))
    );

    // 마이크 버튼: 지금 바로 채점(=발화 종료)
    el("mic-btn").addEventListener("click", () => {
      if (graded || forceKeyboard) return;
      if (clovaActive) window.ClovaRecorder.forceStop();
      else finishSpeech();
    });

    // 키보드 폴백
    el("kb-toggle").addEventListener("click", enableKeyboardMode);
    el("kb-submit").addEventListener("click", () => {
      const t = el("kb-input").value.trim();
      grade(t);
    });

    // 팝업 닫기
    el("sheet-overlay").addEventListener("click", (e) => {
      if (e.target === el("sheet-overlay")) closeSheet();
    });

    // 통계 화면 진입 / 이탈 (결과 요약 화면의 "전체 통계 보기"로만 진입)
    el("result-stats-link").addEventListener("click", () => showStats("result"));
    el("stats-back").addEventListener("click", () => showScreen(statsReturnTo));
  }

  /* =======================================================
     퀴즈 진행
     ======================================================= */
  async function startQuiz() {
    currentIndex = 0;
    results = [];
    matchedByIndex = [];
    await primeMic();   // 마이크 권한을 퀴즈 시작 시 '한 번만' 요청
    showCard();
  }

  // CLOVA STT 사용 여부: config.js에 Edge Function URL이 있고 녹음 가능하면 사용
  function useClova() {
    return !!(window.APP_CONFIG && window.APP_CONFIG.clovaEndpoint &&
              window.ClovaRecorder && navigator.mediaDevices &&
              navigator.mediaDevices.getUserMedia);
  }

  // 마이크 권한 사전 확보: 시작 시 한 번 요청하고 스트림을 '계속 열어둔다'.
  // 스트림을 유지하면 문항마다 새 음성인식이 시작돼도 권한을 다시 묻지 않는다.
  async function primeMic() {
    if (sttDenied) return;
    if (!useClova() && !SR) return;                 // 음성 경로가 전혀 없으면 스킵
    if (micPrimed && micStream) return;             // 이미 확보돼 있으면 재사용
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micPrimed = true;                             // 스트림은 유지(끄지 않음)
    } catch (e) {
      sttDenied = true; // 거부/불가 → 이후 전부 키보드 모드
    }
  }

  // 퀴즈 종료/이탈 시 마이크 해제 (녹음 표시 제거)
  function stopMic() {
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
      micStream = null;
    }
    micPrimed = false;
  }

  function renderSegbar(containerId) {
    const c = el(containerId);
    c.innerHTML = "";
    for (let i = 0; i < QUESTIONS.length; i++) {
      const seg = document.createElement("div");
      seg.className = "seg" + (i <= currentIndex ? " done" : "");
      c.appendChild(seg);
    }
  }

  function showCard() {
    graded = false;
    forceKeyboard = false;
    const q = QUESTIONS[currentIndex];

    el("card-index").textContent = currentIndex + 1 + " / " + QUESTIONS.length;
    el("event-name").textContent = q.사건명;
    renderSegbar("card-segbar");

    const card = el("event-card");
    card.classList.remove("out");

    // 타이머 바 재시작
    const fill = el("card-timer-fill");
    fill.classList.remove("run");
    void fill.offsetWidth; // reflow
    fill.style.animationDuration = CONFIG.CARD_MS + "ms";
    fill.classList.add("run");

    showScreen("card");

    clearTimeout(cardTimer);
    cardTimer = setTimeout(() => {
      card.classList.add("out");
      setTimeout(showListen, 350);
    }, CONFIG.CARD_MS);
  }

  function showListen() {
    const q = QUESTIONS[currentIndex];
    el("listen-index").textContent = currentIndex + 1 + " / " + QUESTIONS.length;
    renderSegbar("listen-segbar");

    // UI 초기화
    finalTranscript = "";
    graded = false;
    el("recog-text").textContent = "말을 시작하면 여기에 표시돼요…";
    el("recog-text").className = "text empty";
    el("kb-fallback").classList.remove("show");
    el("kb-input").value = "";
    el("kb-toggle").style.display = "inline-flex";
    el("listen-status-text").textContent = "듣는 중";
    el("wave").classList.remove("paused");
    el("mic-btn").classList.add("rec");

    showScreen("listen");
    startSTT();
  }

  /* =======================================================
     STT (Web Speech API) + 폴백
     ======================================================= */
  function startSTT() {
    clovaActive = false;
    if (forceKeyboard || sttDenied) {
      enableKeyboardMode(sttDenied);
      return;
    }
    // CLOVA 경로 (config.js에 endpoint 설정 + 마이크 확보 시)
    if (useClova() && micStream) {
      startClovaSTT();
      return;
    }
    // Web Speech 경로
    if (!SR) {
      enableKeyboardMode(true); // 미지원 브라우저
      return;
    }
    try {
      recognition = new SR();
      recognition.lang = "ko-KR";
      recognition.interimResults = true;
      recognition.continuous = true;

      recognition.onstart = () => {
        // 마이크가 '실제로' 켜진 뒤부터 무발화 카운트 시작
        // (권한 팝업이 떠 있는 동안 타이머가 소진돼 자동으로 넘어가던 문제 방지)
        clearTimeout(waitTimer);
        waitTimer = setTimeout(() => {
          if (!graded && !finalTranscript.trim()) {
            stopRecognition();
            grade(""); // 모름
          }
        }, CONFIG.SPEECH_WAIT_MS);
      };
      recognition.onresult = onSpeechResult;
      recognition.onerror = onSpeechError;
      recognition.onend = () => {
        // 발화가 있었는데 아직 채점 전이면 채점
        if (!graded && finalTranscript.trim()) grade(finalTranscript);
      };

      recognition.start();
    } catch (err) {
      enableKeyboardMode(true);
    }
  }

  // ---- CLOVA STT 경로: PCM 녹음 → WAV → Edge Function → 텍스트 → 채점 ----
  function startClovaSTT() {
    clovaActive = true;
    window.ClovaRecorder.start(
      micStream,
      { waitMs: CONFIG.SPEECH_WAIT_MS, silenceMs: CONFIG.SILENCE_MS },
      {
        onSpeechStart: () => {
          const box = el("recog-text");
          box.className = "text";
          box.textContent = "듣는 중…";
        },
        onNoSpeech: () => {
          clovaActive = false;
          if (!graded) grade(""); // 무발화 → 모름
        },
        onResult: async (wavBlob) => {
          clovaActive = false;
          el("wave").classList.add("paused");
          const box = el("recog-text");
          box.className = "text";
          box.textContent = "인식 중…";
          try {
            const text = await sendToClova(wavBlob);
            if (!graded) grade(text || "");
          } catch (e) {
            // 서버/네트워크 오류 → 키보드 폴백
            enableKeyboardMode(true);
          }
        }
      }
    );
  }

  async function sendToClova(wavBlob) {
    const cfg = window.APP_CONFIG || {};
    const headers = { "Content-Type": "application/octet-stream" };
    if (cfg.supabaseAnonKey) {
      headers["Authorization"] = "Bearer " + cfg.supabaseAnonKey;
      headers["apikey"] = cfg.supabaseAnonKey;
    }
    const resp = await fetch(cfg.clovaEndpoint, { method: "POST", headers, body: wavBlob });
    if (!resp.ok) throw new Error("STT 서버 오류: " + resp.status);
    const data = await resp.json();
    return (data && data.text) ? data.text : "";
  }

  function onSpeechResult(e) {
    clearTimeout(waitTimer); // 발화 감지 → 무발화 타이머 해제
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const chunk = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalTranscript += chunk;
      else interim += chunk;
    }
    const box = el("recog-text");
    box.className = "text";
    box.innerHTML =
      escapeHtml(finalTranscript) +
      (interim ? '<span class="interim">' + escapeHtml(interim) + "</span>" : "");

    // 발화 후 침묵 타이머 리셋
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(finishSpeech, CONFIG.SILENCE_MS);
  }

  function onSpeechError(e) {
    if (e.error === "no-speech") {
      if (!graded) { stopRecognition(); grade(""); }
      return;
    }
    // 권한 거부는 세션 전체에 적용해 문항마다 다시 묻지 않도록 함
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      sttDenied = true;
    }
    // network / audio-capture 등 → 키보드 폴백
    enableKeyboardMode(true);
  }

  function finishSpeech() {
    clearTimeout(silenceTimer);
    stopRecognition();
    if (!graded) grade(finalTranscript);
  }

  function stopRecognition() {
    if (recognition) {
      try { recognition.onend = null; recognition.stop(); } catch (e) {}
      recognition = null;
    }
    if (clovaActive && window.ClovaRecorder) {
      try { window.ClovaRecorder.abort(); } catch (e) {}
      clovaActive = false;
    }
    clearTimeout(waitTimer);
    clearTimeout(silenceTimer);
  }

  function enableKeyboardMode(showNotice) {
    forceKeyboard = true;
    stopRecognition();
    el("mic-btn").classList.remove("rec");
    el("wave").classList.add("paused");
    el("listen-status-text").textContent = "키보드 입력";
    el("kb-toggle").style.display = "none";
    el("kb-fallback").classList.add("show");
    if (showNotice) {
      el("recog-text").className = "text empty";
      el("recog-text").textContent =
        "이 브라우저/환경에서는 음성 인식을 쓸 수 없어요. 아래에 답을 입력해 주세요.";
    }
    el("kb-input").focus();
  }

  /* =======================================================
     채점 (하드코딩 키워드 매칭 — LLM 아님)
     ======================================================= */
  function grade(rawText) {
    if (graded) return;
    graded = true;
    stopRecognition();
    clearTimeout(cardTimer);
    el("wave").classList.add("paused");
    el("mic-btn").classList.remove("rec");

    const q = QUESTIONS[currentIndex];
    const normText = normalize(rawText);

    const matched = q.정답_키워드.filter((kw) => normText.includes(normalize(kw)));
    const count = matched.length;
    const total = q.정답_키워드.length;
    const pass = q.통과_기준;

    let key;
    if (count === total) key = "complete";
    else if (count >= pass) key = "pass";
    else if (count > 0) key = "partial";
    else key = "unknown";

    results[currentIndex] = key;
    matchedByIndex[currentIndex] = matched;
    renderFeedback(key, q, matched);
  }

  /* =======================================================
     피드백 화면 렌더
     ======================================================= */
  function chip(text, kind, mark) {
    const m = mark ? '<span>' + mark + "</span>" : "";
    return '<span class="chip ' + kind + '">' + m + escapeHtml(text) + "</span>";
  }

  function renderFeedback(key, q, matched) {
    const meta = RESULT_META[key];
    const isMissed = (kw) => matched.indexOf(kw) === -1;

    const fb = el("screen-feedback");
    fb.className = "screen fb active " + meta.theme;
    document.querySelectorAll(".screen").forEach((s) => { if (s !== fb) s.classList.remove("active"); });

    el("fb-emblem").textContent = meta.emblem;
    el("fb-title").textContent = meta.title;
    el("fb-sub").textContent = meta.sub;

    // 다음 버튼 색상
    const nextBtn = el("btn-next");
    nextBtn.className = "btn " + (meta.theme === "green" ? "green" : meta.theme);

    // 정답 카드 본문
    const head =
      '<div class="answer-top"><span class="name">' + escapeHtml(q.사건명) +
      '</span><span class="year">' + escapeHtml(q.연도) + "</span></div>";

    let body = "";
    if (key === "complete") {
      body =
        '<p class="answer-label">말한 핵심어</p><div class="chips">' +
        q.정답_키워드.map((kw) => chip(kw, "hit", "✓")).join("") +
        "</div>";
    } else if (key === "pass") {
      body =
        '<p class="answer-label">말한 핵심어</p><div class="chips">' +
        q.정답_키워드.map((kw) =>
          isMissed(kw) ? chip(kw, "miss", "+") : chip(kw, "hit", "✓")
        ).join("") +
        "</div>" +
        '<div class="supplement"><span class="tag">보충</span><p>' +
        escapeHtml(q.보충) + "</p></div>";
    } else if (key === "partial") {
      const hits = q.정답_키워드.filter((kw) => !isMissed(kw));
      const misses = q.정답_키워드.filter((kw) => isMissed(kw));
      body =
        '<div class="two-col">' +
        '<div class="col hit-col"><h5>맞춘 핵심어</h5><div class="chips">' +
        hits.map((kw) => chip(kw, "hit", "✓")).join("") +
        "</div></div>" +
        '<div class="col miss-col"><h5>놓친 핵심어</h5><div class="chips">' +
        misses.map((kw) => chip(kw, "miss orange-miss", "+")).join("") +
        "</div></div></div>";
    } else {
      body =
        '<p class="answer-label">정답 핵심어</p><div class="chips">' +
        q.정답_키워드.map((kw) => chip(kw, "reveal")).join("") +
        '</div><p class="one-liner">' + escapeHtml(q.한줄정리) + "</p>";
    }

    el("fb-answer-card").innerHTML = head + body;
  }

  function nextQuestion() {
    currentIndex++;
    if (currentIndex < QUESTIONS.length) showCard();
    else showResult();
  }

  /* =======================================================
     결과 요약
     ======================================================= */
  function showResult() {
    const counts = { complete: 0, pass: 0, partial: 0, unknown: 0 };
    results.forEach((k) => counts[k]++);
    const passed = counts.complete + counts.pass;

    stopMic(); // 퀴즈 완료 → 마이크 해제

    // 통계 누적 (실제 데이터 — localStorage)
    recordSession(passed);

    el("result-sub").textContent = DATA.단원명 + " · " + QUESTIONS.length + "문항";
    el("result-pass").textContent = passed;
    el("stat-complete").textContent = counts.complete;
    el("stat-pass").textContent = counts.pass;
    el("stat-partial").textContent = counts.partial;
    el("stat-unknown").textContent = counts.unknown;

    const list = el("result-list");
    list.innerHTML = QUESTIONS.map((q, i) => {
      const meta = RESULT_META[results[i]];
      return (
        '<div class="result-item"><span class="idx">' + (i + 1) +
        '</span><span class="nm">' + escapeHtml(q.사건명) +
        '</span><span class="tag ' + meta.tagClass + '">' + meta.tag + "</span></div>"
      );
    }).join("");

    showScreen("result");
  }

  /* =======================================================
     팝업 (해설 / 원문)
     ======================================================= */
  function openSheet(kind) {
    const q = QUESTIONS[currentIndex];
    const sheet = el("sheet");
    const meta = '<span class="sheet-meta">' + escapeHtml(q.사건명) + " · " + escapeHtml(q.연도) + "</span>";

    if (kind === "explain") {
      sheet.innerHTML =
        '<div class="sheet-grip"></div>' +
        '<div class="sheet-head"><h3>📖 해설</h3><button class="sheet-close" data-close>✕</button></div>' +
        meta +
        '<p class="sheet-body">' + escapeHtml(q.해설) + "</p>" +
        '<p class="sheet-kw-label">핵심 키워드</p>' +
        '<div class="sheet-kw">' + q.정답_키워드.map((k) => "<span>" + escapeHtml(k) + "</span>").join("") + "</div>" +
        '<button class="btn" data-close>확인</button>';
    } else {
      const lines = q.원문;
      const quote = lines.map((ln, i) =>
        i === lines.length - 1
          ? '<p class="cite">' + escapeHtml(ln) + "</p>"
          : "<p>" + escapeHtml(ln) + "</p>"
      ).join("");
      sheet.innerHTML =
        '<div class="sheet-grip"></div>' +
        '<div class="sheet-head"><h3>📄 기출 원문</h3><button class="sheet-close" data-close>✕</button></div>' +
        meta +
        '<div class="doc-quote">' + quote + "</div>" +
        '<p class="sheet-source">' + escapeHtml(q.원문_출처) + "</p>" +
        '<button class="btn" data-close>확인</button>';
    }

    sheet.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeSheet));
    el("sheet-overlay").classList.add("show");
  }

  function closeSheet() {
    el("sheet-overlay").classList.remove("show");
  }

  /* =======================================================
     학습 통계 (실제 데이터 누적 — localStorage)
     ======================================================= */
  const STATS_KEY = "korhist_stats_v1";

  function loadStats() {
    try {
      return JSON.parse(localStorage.getItem(STATS_KEY)) || { sessions: [], missed: {} };
    } catch (e) {
      return { sessions: [], missed: {} };
    }
  }

  function saveStats(s) {
    try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch (e) {}
  }

  // 퀴즈 1회 완료 시 호출: 통과 문항 수 + 이번 세션에서 놓친 핵심어 누적
  function recordSession(passCount) {
    const s = loadStats();
    s.sessions.push({ date: todayStr(), pass: passCount, total: QUESTIONS.length });
    QUESTIONS.forEach((q, i) => {
      const matched = matchedByIndex[i] || [];
      q.정답_키워드.forEach((kw) => {
        if (matched.indexOf(kw) === -1) s.missed[kw] = (s.missed[kw] || 0) + 1;
      });
    });
    saveStats(s);
  }

  function computeStreak(sessions) {
    if (!sessions.length) return 0;
    const days = Array.from(new Set(sessions.map((x) => x.date))).sort();
    let streak = 1;
    for (let i = days.length - 1; i > 0; i--) {
      const diff = (new Date(days[i]) - new Date(days[i - 1])) / 86400000;
      if (Math.round(diff) === 1) streak++;
      else break;
    }
    return streak;
  }

  function showStats(from) {
    statsReturnTo = from || "home";
    const s = loadStats();
    const count = s.sessions.length;
    const totalPass = s.sessions.reduce((a, x) => a + x.pass, 0);
    const totalQ = s.sessions.reduce((a, x) => a + (x.total || QUESTIONS.length), 0);
    const rate = totalQ ? Math.round((totalPass / totalQ) * 100) : 0;

    el("st-count").textContent = count;
    el("st-rate").textContent = rate;
    el("st-streak").textContent = computeStreak(s.sessions);

    // 정답률 추이 (최근 7회)
    const trend = s.sessions.slice(-7);
    const bars = el("trend-bars");
    if (!trend.length) {
      bars.innerHTML = '<p class="empty-note">아직 학습 기록이 없어요</p>';
    } else {
      el("trend-range").textContent = "최근 " + trend.length + "회";
      bars.innerHTML = trend.map((x, i) => {
        const isLast = i === trend.length - 1;
        const total = x.total || QUESTIONS.length;
        const h = Math.max(6, Math.round((x.pass / total) * 96));
        const parts = x.date.split("-");
        const label = parseInt(parts[1], 10) + "/" + parseInt(parts[2], 10);
        return (
          '<div class="bar-col2' + (isLast ? " last" : "") + '">' +
          '<span class="v">' + x.pass + "</span>" +
          '<div class="bar" style="height:' + h + 'px"></div>' +
          '<span class="d">' + label + "</span></div>"
        );
      }).join("");
    }

    // 자주 놓치는 핵심어 Top3
    const topMissed = Object.keys(s.missed)
      .map((k) => [k, s.missed[k]])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    const list = el("kw-list");
    if (!topMissed.length) {
      list.innerHTML = '<p class="empty-note">아직 놓친 핵심어가 없어요 👍</p>';
      el("kw-hint").style.display = "none";
    } else {
      el("kw-hint").style.display = "";
      const max = topMissed[0][1];
      list.innerHTML = topMissed.map((row, i) => {
        const pct = Math.round((row[1] / max) * 100);
        return (
          '<div class="kw-row2"><div class="kw-top"><div class="kw-left">' +
          '<span class="rank">' + (i + 1) + "</span>" +
          '<span class="kw-name">' + escapeHtml(row[0]) + "</span></div>" +
          '<span class="kw-count">' + row[1] + "회 놓침</span></div>" +
          '<div class="kw-track"><div class="kw-fill" style="width:' + pct + '%"></div></div></div>'
        );
      }).join("");
    }

    showScreen("stats");
  }

  function todayStr() {
    const d = new Date();
    const p = (n) => (n < 10 ? "0" + n : "" + n);
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  /* =======================================================
     유틸
     ======================================================= */
  function stopEverything() {
    stopRecognition();
    stopMic();
    clearTimeout(cardTimer);
    graded = true;
  }

  function buildWave() {
    const wave = el("wave");
    const heights = [24, 48, 80, 110, 70, 120, 54, 96, 40, 72, 110, 60, 90, 34, 64];
    wave.innerHTML = "";
    heights.forEach((h, i) => {
      const bar = document.createElement("i");
      bar.style.height = h + "px";
      bar.style.animationDelay = (i * 0.07).toFixed(2) + "s";
      wave.appendChild(bar);
    });
  }

  function escapeHtml(s) {
    return (s || "").replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
    );
  }

  document.addEventListener("DOMContentLoaded", init);
})();
