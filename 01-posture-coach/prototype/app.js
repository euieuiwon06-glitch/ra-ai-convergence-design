(() => {
  "use strict";

  const MODEL_URL = "https://teachablemachine.withgoogle.com/models/R2fWwzGSA/";
  const KNOWN_CLASSES = ["Normal", "Slouch", "Lean", "Chin", "Away"];

  // Prototype timing (see footnote — production spec is 5 minutes)
  const CONFIRM_MS = 5000;
  const POPUP_MS = 10000;
  const ALARM_MS = 20000;

  const CLASS_META = {
    Normal: { message: null, notice: false, alarm: false },
    Slouch: { message: "허리 펴세요", notice: false, alarm: true },
    Lean: { message: "자세를 바로잡아주세요", notice: false, alarm: true },
    Chin: { message: "고개 드세요", notice: false, alarm: true },
    Away: { message: "자리를 비우셨어요", notice: true, alarm: false },
  };

  const CLASS_COLOR = {
    Normal: "#0075de",
    Slouch: "#dd5b00",
    Lean: "#391c57",
    Chin: "#ff64c8",
    Away: "#a39e98",
  };

  const CLASS_FILL_SELECTOR = {
    Normal: "fill-normal",
    Slouch: "fill-slouch",
    Lean: "fill-lean",
    Chin: "fill-chin",
    Away: "fill-away",
  };

  const POSE_CONNECTIONS = [
    ["leftShoulder", "rightShoulder"],
    ["leftShoulder", "leftElbow"], ["leftElbow", "leftWrist"],
    ["rightShoulder", "rightElbow"], ["rightElbow", "rightWrist"],
    ["leftShoulder", "leftHip"], ["rightShoulder", "rightHip"], ["leftHip", "rightHip"],
    ["leftHip", "leftKnee"], ["leftKnee", "leftAnkle"],
    ["rightHip", "rightKnee"], ["rightKnee", "rightAnkle"],
    ["nose", "leftEye"], ["nose", "rightEye"], ["leftEye", "leftEar"], ["rightEye", "rightEar"],
  ];

  // ---- DOM refs ----
  const btnStart = document.getElementById("btnStart");
  const btnEnd = document.getElementById("btnEnd");
  const stageHint = document.getElementById("stageHint");
  const webcamContainer = document.getElementById("webcamContainer");
  const webcamEmpty = document.getElementById("webcamEmpty");
  const poseCanvas = document.getElementById("poseCanvas");
  const classBadge = document.getElementById("classBadge");
  const classBadgeDot = document.getElementById("classBadgeDot");
  const classBadgeText = document.getElementById("classBadgeText");
  const popupAnchor = document.getElementById("popupAnchor");
  const titlebarStatusDot = document.getElementById("titlebarStatusDot");
  const titlebarStatusText = document.getElementById("titlebarStatusText");
  const streakMeterFill = document.getElementById("streakMeterFill");
  const streakHint = document.getElementById("streakHint");
  const timelineSteps = Array.from(document.querySelectorAll(".timeline-step"));
  const calibrationOverlay = document.getElementById("calibrationOverlay");
  const calibrationCount = document.getElementById("calibrationCount");
  const reportOverlay = document.getElementById("reportOverlay");
  const reportUprightPct = document.getElementById("reportUprightPct");
  const reportBreakdown = document.getElementById("reportBreakdown");
  const reportDuration = document.getElementById("reportDuration");
  const btnCloseReport = document.getElementById("btnCloseReport");
  const btnRestart = document.getElementById("btnRestart");

  // ---- State ----
  let model = null;
  let webcam = null;
  let intervalId = null;
  const DETECT_INTERVAL_MS = 300;
  let isRunning = false;
  let isCalibrating = false;
  let lastFrameTime = 0;

  let historyBuffer = [];
  const HISTORY_LEN = 6;

  let streak = { cls: null, start: 0 };
  let popupShown = false;
  let alarmShown = false;

  let classDurations = { Normal: 0, Slouch: 0, Lean: 0, Chin: 0, Away: 0 };

  let audioCtx = null;
  let alarmIntervalId = null;

  let notificationPermissionGranted = false;
  let currentOsNotification = null;

  // ---- Audio (synthesized beep — no sound file needed) ----
  function unlockAudio() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
  }

  function beep() {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.22, audioCtx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.35);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.4);
  }

  function startAlarmSound() {
    beep();
    if (alarmIntervalId) clearInterval(alarmIntervalId);
    alarmIntervalId = setInterval(beep, 1500);
  }

  function stopAlarmSound() {
    if (alarmIntervalId) {
      clearInterval(alarmIntervalId);
      alarmIntervalId = null;
    }
  }

  // ---- Popup (OS-style notification) ----
  function showPopup(cls) {
    const meta = CLASS_META[cls];
    popupAnchor.innerHTML = "";
    const popup = document.createElement("div");
    popup.className = "os-popup" + (meta.notice ? " notice" : "");
    popup.innerHTML =
      '<div class="os-popup-icon">' + (meta.notice ? "○" : "!") + "</div>" +
      '<div class="os-popup-body">' +
      '<p class="os-popup-title"></p>' +
      '<p class="os-popup-subtitle"></p>' +
      "</div>" +
      '<button class="os-popup-close" aria-label="닫기" type="button">×</button>';
    popup.querySelector(".os-popup-title").textContent = meta.message || (cls + " 감지됨");
    popup.querySelector(".os-popup-subtitle").textContent = cls + " 자세가 지속되고 있어요";
    popup.querySelector(".os-popup-close").addEventListener("click", () => {
      closePopup();
      stopAlarmSound();
    });
    popupAnchor.appendChild(popup);
  }

  function markPopupAlarm() {
    const el = popupAnchor.querySelector(".os-popup");
    if (el) el.classList.add("alarm");
  }

  function closePopup() {
    popupAnchor.innerHTML = "";
  }

  // ---- Background alert (fires while another app has focus) ----
  // Inside the Electron desktop build, window.electronAPI drives a real
  // always-on-top window we position ourselves (top-center of the screen).
  // In a plain browser tab there's no way to control where a notification
  // renders, so it falls back to the OS-positioned Notification API.
  const isElectron = typeof window !== "undefined" && !!window.electronAPI;

  async function requestNotificationPermission() {
    if (isElectron) return;
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") {
      notificationPermissionGranted = true;
      return;
    }
    if (Notification.permission !== "denied") {
      const result = await Notification.requestPermission();
      notificationPermissionGranted = result === "granted";
    }
  }

  function showOsNotification(cls) {
    const meta = CLASS_META[cls];
    const title = meta.message || (cls + " 감지됨");
    const subtitle = cls + " 자세가 지속되고 있어요";

    if (isElectron) {
      window.electronAPI.showAlert({ title, subtitle, notice: meta.notice });
      return;
    }

    if (!notificationPermissionGranted) return;
    try {
      currentOsNotification = new Notification("자세 코치 · " + title, {
        body: subtitle,
        tag: "posture-coach-alert",
      });
    } catch (e) { /* some platforms restrict Notification from a background tab */ }
  }

  function closeOsNotification() {
    if (isElectron) {
      window.electronAPI.closeAlert();
      return;
    }
    if (currentOsNotification) {
      try { currentOsNotification.close(); } catch (e) { /* already closed */ }
      currentOsNotification = null;
    }
  }

  // ---- UI helpers ----
  function setTitlebarStatus(mode) {
    titlebarStatusDot.className = "status-dot" + (mode === "live" ? " live" : mode === "warn" ? " warn" : "");
    titlebarStatusText.textContent = mode === "live" ? "실시간 감지 중" : mode === "warn" ? "주의 필요" : "대기 중";
  }

  function updateTimelineUI(stageReached) {
    timelineSteps.forEach((el, i) => el.classList.toggle("reached", i < stageReached));
  }

  function updateMeter(elapsedMs, isBad) {
    const pct = isBad ? Math.min(100, (elapsedMs / ALARM_MS) * 100) : 0;
    streakMeterFill.style.width = pct + "%";
    streakMeterFill.classList.remove("warn", "alarm");
    if (isBad && elapsedMs >= ALARM_MS) streakMeterFill.classList.add("alarm");
    else if (isBad && elapsedMs >= POPUP_MS) streakMeterFill.classList.add("warn");
  }

  function updateClassBadge(cls, prob) {
    classBadgeText.textContent = cls + " · " + Math.round(prob * 100) + "%";
    classBadgeDot.style.background = CLASS_COLOR[cls] || "#a39e98";
  }

  function updateConfidenceUI(predictions) {
    predictions.forEach((p) => {
      const cls = normalizeClassName(p.className);
      const row = document.querySelector('.confidence-row[data-class="' + cls + '"]');
      if (!row) return;
      const pct = Math.round(p.probability * 100);
      const fillCls = CLASS_FILL_SELECTOR[cls];
      const fillEl = row.querySelector("." + fillCls);
      if (fillEl) fillEl.style.width = pct + "%";
      row.querySelector(".confidence-pct").textContent = pct + "%";
    });
  }

  function normalizeClassName(raw) {
    const found = KNOWN_CLASSES.find((k) => k.toLowerCase() === String(raw).toLowerCase());
    return found || raw;
  }

  function resetSessionUI() {
    classBadgeText.textContent = "대기 중";
    classBadgeDot.style.background = "#a39e98";
    updateTimelineUI(0);
    updateMeter(0, false);
    streakHint.textContent = "감지 대기 중";
    document.querySelectorAll(".confidence-row").forEach((row) => {
      row.querySelector(".confidence-fill").style.width = "0%";
      row.querySelector(".confidence-pct").textContent = "0%";
    });
    closePopup();
    closeOsNotification();
    stopAlarmSound();
  }

  // ---- Pose skeleton drawing ----
  function drawPose(pose) {
    const ctx = poseCanvas.getContext("2d");
    ctx.clearRect(0, 0, poseCanvas.width, poseCanvas.height);
    if (!pose) return;
    const byName = {};
    pose.keypoints.forEach((kp) => { byName[kp.part] = kp; });

    ctx.strokeStyle = "rgba(0, 117, 222, 0.85)";
    ctx.lineWidth = 2;
    POSE_CONNECTIONS.forEach(([a, b]) => {
      const ka = byName[a], kb = byName[b];
      if (ka && kb && ka.score > 0.5 && kb.score > 0.5) {
        ctx.beginPath();
        ctx.moveTo(ka.position.x, ka.position.y);
        ctx.lineTo(kb.position.x, kb.position.y);
        ctx.stroke();
      }
    });

    ctx.fillStyle = "#0075de";
    pose.keypoints.forEach((kp) => {
      if (kp.score > 0.5) {
        ctx.beginPath();
        ctx.arc(kp.position.x, kp.position.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // ---- Smoothing ----
  function pushHistory(cls) {
    historyBuffer.push(cls);
    if (historyBuffer.length > HISTORY_LEN) historyBuffer.shift();
  }

  function majorityClass() {
    const counts = {};
    let best = null, bestCount = -1;
    historyBuffer.forEach((c) => {
      counts[c] = (counts[c] || 0) + 1;
      if (counts[c] > bestCount) { best = c; bestCount = counts[c]; }
    });
    return best;
  }

  // ---- State machine ----
  function handlePosture(cls, now) {
    if (cls !== streak.cls) {
      streak = { cls, start: now };
      popupShown = false;
      alarmShown = false;
      closePopup();
      closeOsNotification();
      stopAlarmSound();
    }
    const elapsed = now - streak.start;

    if (cls === "Normal") {
      updateTimelineUI(0);
      updateMeter(0, false);
      streakHint.textContent = "바른 자세를 유지하고 있어요";
      setTitlebarStatus("live");
      return;
    }

    updateMeter(elapsed, true);
    const elapsedSec = (elapsed / 1000).toFixed(1);
    if (elapsed < CONFIRM_MS) {
      updateTimelineUI(0);
      streakHint.textContent = cls + " 감지 중 (판정 대기)";
    } else if (elapsed < POPUP_MS) {
      updateTimelineUI(1);
      streakHint.textContent = cls + " 확정 · " + elapsedSec + "초 지속";
    } else if (elapsed < ALARM_MS) {
      updateTimelineUI(2);
      streakHint.textContent = cls + " 지속 " + elapsedSec + "초 · 팝업 표시 중";
    } else {
      updateTimelineUI(3);
      streakHint.textContent = cls + " 지속 " + elapsedSec + "초 · 경고음 발생 중";
    }

    if (elapsed >= POPUP_MS) {
      if (!popupShown) {
        popupShown = true;
        setTitlebarStatus(CLASS_META[cls].notice ? "idle" : "warn");
      }
      // re-check focus every tick (not just once) — if the user switches to
      // another app mid-streak, escalate from the in-page popup to a real
      // OS notification, and vice versa if they switch back
      if (document.hasFocus()) {
        closeOsNotification();
        if (!popupAnchor.querySelector(".os-popup")) {
          showPopup(cls);
          if (alarmShown) markPopupAlarm();
        }
      } else {
        closePopup();
        if (!currentOsNotification) showOsNotification(cls);
      }
    }
    if (!CLASS_META[cls].notice && elapsed >= ALARM_MS && !alarmShown) {
      startAlarmSound();
      alarmShown = true;
      markPopupAlarm();
    }
  }

  // ---- Prediction loop ----
  async function predict(timestamp) {
    if (!model || !webcam) return;
    const { pose, posenetOutput } = await model.estimatePose(webcam.canvas);
    const predictions = await model.predict(posenetOutput);

    drawPose(pose);
    updateConfidenceUI(predictions);

    let best = predictions[0];
    predictions.forEach((p) => { if (p.probability > best.probability) best = p; });
    const rawCls = normalizeClassName(best.className);
    pushHistory(rawCls);
    const majority = majorityClass() || rawCls;

    updateClassBadge(rawCls, best.probability);

    const now = timestamp;
    const dt = lastFrameTime ? now - lastFrameTime : 0;
    lastFrameTime = now;

    if (!isCalibrating) {
      if (classDurations[majority] === undefined) classDurations[majority] = 0;
      classDurations[majority] += dt;
      handlePosture(majority, now);
    }
  }

  // setInterval (not requestAnimationFrame) so detection keeps running while
  // the tab is minimized or another app has focus — rAF fully pauses then.
  // Browsers clamp background-tab timers to ~1/sec, which is still well
  // within the 5s/10s/20s thresholds.
  function loop() {
    if (!isRunning) return;
    webcam.update();
    predict(performance.now());
  }

  // ---- Calibration ----
  function runCalibration() {
    return new Promise((resolve) => {
      isCalibrating = true;
      calibrationOverlay.hidden = false;
      let count = 3;
      calibrationCount.textContent = String(count);
      const timer = setInterval(() => {
        count -= 1;
        if (count <= 0) {
          clearInterval(timer);
          calibrationOverlay.hidden = true;
          isCalibrating = false;
          const now = performance.now();
          lastFrameTime = now;
          streak = { cls: null, start: now };
          resolve();
        } else {
          calibrationCount.textContent = String(count);
        }
      }, 1000);
    });
  }

  // ---- Model loading ----
  async function loadModel() {
    if (model) return model;
    stageHint.textContent = "AI 모델을 불러오는 중...";
    model = await tmPose.load(MODEL_URL + "model.json", MODEL_URL + "metadata.json");
    return model;
  }

  // ---- Session control ----
  async function startWebcam() {
    unlockAudio();
    await requestNotificationPermission();
    btnStart.disabled = true;
    btnStart.textContent = "카메라 준비 중...";
    stageHint.textContent = "카메라 권한을 확인해주세요.";

    try {
      await loadModel();
      webcam = new tmPose.Webcam(480, 360, true);
      await webcam.setup();
      await webcam.play();
    } catch (err) {
      stageHint.textContent = "웹캠을 시작할 수 없습니다: " + (err && err.message ? err.message : "카메라 권한을 확인해주세요.");
      btnStart.disabled = false;
      btnStart.textContent = "웹캠 시작";
      return;
    }

    webcamEmpty.hidden = true;
    webcamContainer.innerHTML = "";
    webcam.canvas.style.width = "100%";
    webcam.canvas.style.height = "100%";
    webcam.canvas.style.display = "block";
    webcamContainer.appendChild(webcam.canvas);
    poseCanvas.width = webcam.canvas.width;
    poseCanvas.height = webcam.canvas.height;

    classDurations = { Normal: 0, Slouch: 0, Lean: 0, Chin: 0, Away: 0 };
    historyBuffer = [];
    resetSessionUI();

    btnStart.textContent = "웹캠 시작";
    btnEnd.disabled = false;
    isRunning = true;

    stageHint.textContent = "바른 자세로 앉아 캘리브레이션을 진행해주세요.";
    await runCalibration();
    setTitlebarStatus("live");
    stageHint.textContent = "실시간으로 자세를 감지하고 있습니다.";

    intervalId = setInterval(loop, DETECT_INTERVAL_MS);
  }

  function endSession() {
    isRunning = false;
    if (intervalId) { clearInterval(intervalId); intervalId = null; }
    stopAlarmSound();
    closeOsNotification();
    if (webcam) {
      try { webcam.stop(); } catch (e) { /* already stopped */ }
    }
    webcam = null;
    setTitlebarStatus("idle");

    btnEnd.disabled = true;
    btnStart.disabled = false;
    btnStart.textContent = "웹캠 시작";
    stageHint.textContent = "웹캠을 시작하면 캘리브레이션이 진행됩니다.";

    // clear the frozen last camera frame so the empty-state placeholder
    // isn't shown floating over a stale photo of the previous session
    webcamContainer.innerHTML = "";
    poseCanvas.getContext("2d").clearRect(0, 0, poseCanvas.width, poseCanvas.height);
    webcamEmpty.hidden = false;
    resetSessionUI();

    showReport();
  }

  // ---- Report ----
  function showReport() {
    const total = KNOWN_CLASSES.reduce((sum, c) => sum + (classDurations[c] || 0), 0);
    const uprightPct = total > 0 ? Math.round(((classDurations.Normal || 0) / total) * 100) : 0;
    reportUprightPct.textContent = uprightPct + "%";

    reportBreakdown.innerHTML = "";
    KNOWN_CLASSES.forEach((cls) => {
      const dur = classDurations[cls] || 0;
      const pct = total > 0 ? Math.round((dur / total) * 100) : 0;
      const color = CLASS_COLOR[cls];
      const row = document.createElement("div");
      row.className = "report-row";
      row.innerHTML =
        '<span class="report-row-label"><span class="dot-swatch" style="background:' + color + '"></span>' + cls + "</span>" +
        '<div class="report-row-track"><div class="report-row-fill" style="width:' + pct + "%;background:" + color + '"></div></div>' +
        '<span class="report-row-pct">' + pct + "%</span>";
      reportBreakdown.appendChild(row);
    });

    const totalSec = Math.round(total / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    reportDuration.textContent = "총 세션 시간: " + (min > 0 ? min + "분 " : "") + sec + "초";

    reportOverlay.hidden = false;
  }

  // ---- Wire up events ----
  btnStart.addEventListener("click", startWebcam);
  btnEnd.addEventListener("click", endSession);
  btnCloseReport.addEventListener("click", () => { reportOverlay.hidden = true; });
  btnRestart.addEventListener("click", () => {
    reportOverlay.hidden = true;
    startWebcam();
  });
})();
