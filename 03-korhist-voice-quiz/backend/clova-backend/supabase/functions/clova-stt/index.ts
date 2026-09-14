// Supabase Edge Function: clova-stt
// -----------------------------------------------------------
// 브라우저가 녹음한 WAV(16kHz mono)를 받아 네이버 CLOVA STT로 변환해 { text } 반환.
// CLOVA 키는 Supabase 시크릿에만 저장 → 클라이언트에 절대 노출되지 않음.
//
// 기본: CLOVA Speech Recognition(CSR) REST (짧은 문장 STT).
//   필요 시크릿:  CLOVA_CLIENT_ID, CLOVA_CLIENT_SECRET
//   (NCP 콘솔 > AI·Application Service > CLOVA Speech Recognition > 인증 정보의
//    X-NCP-APIGW-API-KEY-ID / X-NCP-APIGW-API-KEY)

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  const CLIENT_ID = Deno.env.get("CLOVA_CLIENT_ID");
  const CLIENT_SECRET = Deno.env.get("CLOVA_CLIENT_SECRET");
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return json({ error: "CLOVA_CLIENT_ID / CLOVA_CLIENT_SECRET 시크릿이 설정되지 않았습니다." }, 500);
  }

  try {
    const audio = new Uint8Array(await req.arrayBuffer());
    if (audio.byteLength === 0) return json({ error: "빈 오디오" }, 400);

    // CLOVA Speech Recognition (CSR) — 한국어(Kor)
    const url = "https://naveropenapi.apigw.ntruss.com/recog/v1/stt?lang=Kor";
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "X-NCP-APIGW-API-KEY-ID": CLIENT_ID,
        "X-NCP-APIGW-API-KEY": CLIENT_SECRET,
        "Content-Type": "application/octet-stream",
      },
      body: audio,
    });

    const text = await resp.text();
    let data: any = {};
    try { data = JSON.parse(text); } catch { /* CSR 오류 시 평문일 수 있음 */ }

    if (!resp.ok) {
      return json({ error: "CLOVA 오류", status: resp.status, detail: data.error || text }, 502);
    }
    // CSR 성공 응답: { "text": "인식 결과" }
    return json({ text: data.text ?? "" });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
