/*
 * ClovaRecorder — 브라우저 오디오 캡처 유틸 (CLOVA STT 연동용)
 * -----------------------------------------------------------
 * - getUserMedia 스트림에서 Web Audio로 PCM을 직접 캡처
 * - 간단한 음성활동감지(VAD): 일정 시간 무발화 → onNoSpeech,
 *   발화 후 2초 침묵 → 자동 종료 → 16kHz 16bit mono WAV 로 인코딩해 onResult(wavBlob)
 * - CLOVA CSR REST가 WAV를 안정적으로 받으므로 webm/opus 대신 WAV로 보냄
 *
 * app.js가 이 모듈을 호출한다. Web Speech 경로와 독립적이며,
 * config.js의 clovaEndpoint가 설정된 경우에만 사용된다.
 */
window.ClovaRecorder = (function () {
  "use strict";

  let ctx = null, source = null, proc = null, zeroGain = null;
  let chunks = [], inRate = 44100;
  let started = 0, sawVoice = false, silenceStart = 0;
  let cfg = null, cb = null, stopped = true;

  function rms(buf) {
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }

  function start(stream, config, callbacks) {
    cfg = Object.assign({ waitMs: 3000, silenceMs: 2000, voiceThreshold: 0.015 }, config || {});
    cb = callbacks || {};
    chunks = [];
    sawVoice = false;
    silenceStart = 0;
    stopped = false;
    started = performance.now();

    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    if (ctx.state === "suspended" && ctx.resume) ctx.resume();
    inRate = ctx.sampleRate;
    source = ctx.createMediaStreamSource(stream);
    proc = ctx.createScriptProcessor(4096, 1, 1);
    // 마이크가 스피커로 새어나가지 않도록 게인 0으로 목적지 연결(노드 유지용)
    zeroGain = ctx.createGain();
    zeroGain.gain.value = 0;
    source.connect(proc);
    proc.connect(zeroGain);
    zeroGain.connect(ctx.destination);

    proc.onaudioprocess = function (e) {
      if (stopped) return;
      const input = e.inputBuffer.getChannelData(0);
      chunks.push(new Float32Array(input));
      const level = rms(input);
      if (cb.onLevel) cb.onLevel(level);

      const now = performance.now();
      if (level > cfg.voiceThreshold) {
        if (!sawVoice) { sawVoice = true; if (cb.onSpeechStart) cb.onSpeechStart(); }
        silenceStart = 0;
      } else if (sawVoice) {
        if (!silenceStart) silenceStart = now;
        else if (now - silenceStart >= cfg.silenceMs) finish();
      } else if (now - started >= cfg.waitMs) {
        noSpeech();
      }
    };
  }

  function cleanup() {
    stopped = true;
    try { if (proc) { proc.onaudioprocess = null; proc.disconnect(); } } catch (e) {}
    try { if (source) source.disconnect(); } catch (e) {}
    try { if (zeroGain) zeroGain.disconnect(); } catch (e) {}
    try { if (ctx && ctx.close) ctx.close(); } catch (e) {}
  }

  function finish() {
    if (stopped) return;
    const wav = encodeWav();
    cleanup();
    if (cb.onResult) cb.onResult(wav);
  }

  function noSpeech() {
    if (stopped) return;
    cleanup();
    if (cb.onNoSpeech) cb.onNoSpeech();
  }

  // 사용자가 마이크 버튼을 눌러 즉시 종료
  function forceStop() {
    if (stopped) return;
    if (sawVoice) finish();
    else noSpeech();
  }

  function abort() { if (!stopped) cleanup(); }

  // ---- Float32 PCM → 16kHz 16bit mono WAV ----
  function downsample(buf, from, to) {
    if (to >= from) return buf;
    const ratio = from / to;
    const outLen = Math.floor(buf.length / ratio);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) out[i] = buf[Math.floor(i * ratio)];
    return out;
  }

  function encodeWav() {
    let len = 0;
    for (const c of chunks) len += c.length;
    const merged = new Float32Array(len);
    let off = 0;
    for (const c of chunks) { merged.set(c, off); off += c.length; }

    const outRate = 16000;
    const pcm = downsample(merged, inRate, outRate);

    const buffer = new ArrayBuffer(44 + pcm.length * 2);
    const view = new DataView(buffer);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, "RIFF");
    view.setUint32(4, 36 + pcm.length * 2, true);
    ws(8, "WAVE");
    ws(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);          // PCM
    view.setUint16(22, 1, true);          // mono
    view.setUint32(24, outRate, true);
    view.setUint32(28, outRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    ws(36, "data");
    view.setUint32(40, pcm.length * 2, true);
    let p = 44;
    for (let i = 0; i < pcm.length; i++) {
      let s = Math.max(-1, Math.min(1, pcm[i]));
      view.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      p += 2;
    }
    return new Blob([view], { type: "audio/wav" });
  }

  return { start: start, forceStop: forceStop, abort: abort };
})();
