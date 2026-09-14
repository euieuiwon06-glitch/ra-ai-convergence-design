# CLOVA STT 연동 (Supabase Edge Function)

브라우저에서 녹음한 음성을 **네이버 CLOVA STT**로 변환하는 백엔드입니다.
프론트(프로토타입)는 오디오를 이 함수로 보내고 텍스트만 돌려받습니다. **CLOVA 키는 여기(서버)에만** 두고 클라이언트에는 절대 넣지 않습니다.

```
브라우저(prototype)  ──WAV 오디오──▶  Supabase Edge Function(clova-stt)  ──▶  CLOVA STT
        ▲                                                                   │
        └────────────────────  { text: "인식 결과" }  ◀──────────────────────┘
```

> 채점 로직은 그대로(키워드 매칭)입니다. 이 함수는 "음성 → 텍스트"만 담당합니다.

---

## 1. 네이버 클라우드(NCP) 키 발급

1. [NCP 콘솔](https://console.ncloud.com) 로그인
2. **AI·Application Service > CLOVA Speech Recognition (CSR)** 이용 신청
3. **Application 등록** 후 인증 정보에서 아래 두 값 확보:
   - `X-NCP-APIGW-API-KEY-ID`  → 아래 `CLOVA_CLIENT_ID`
   - `X-NCP-APIGW-API-KEY`     → 아래 `CLOVA_CLIENT_SECRET`

> CSR은 짧은 문장(최대 60초) STT라 이 퀴즈(한두 문장 답변)에 적합합니다.

## 2. Supabase 함수 배포

```bash
# Supabase CLI 설치돼 있다고 가정 (npm i -g supabase)
supabase login
supabase link --project-ref <프로젝트_REF>

# 이 폴더 구조(supabase/functions/clova-stt/index.ts)를 그대로 사용
# 시크릿 등록 (클라이언트에 노출 안 됨)
supabase secrets set CLOVA_CLIENT_ID=발급받은_KEY_ID
supabase secrets set CLOVA_CLIENT_SECRET=발급받은_KEY

# 배포 — 브라우저에서 인증 없이 호출하려면 --no-verify-jwt
supabase functions deploy clova-stt --no-verify-jwt
```

배포되면 함수 URL이 나옵니다:
```
https://<프로젝트_REF>.supabase.co/functions/v1/clova-stt
```

## 3. 프론트에 URL 연결

`prototype/config.js` 를 열고 URL을 넣습니다:
```js
window.APP_CONFIG = {
  clovaEndpoint: "https://<프로젝트_REF>.supabase.co/functions/v1/clova-stt",
  supabaseAnonKey: ""   // --no-verify-jwt 로 배포했으면 빈 값
};
```
- `--no-verify-jwt` 없이 배포했다면 `supabaseAnonKey` 에 Supabase anon key를 넣으세요.
- `clovaEndpoint` 가 비어 있으면 앱은 기존처럼 **브라우저 Web Speech API**를 씁니다(안전한 기본값).

## 4. 테스트

1. `prototype`을 로컬 서버로 실행 (`python -m http.server 8123`) 후 접속
2. 퀴즈 진행 → 말하면 듣기 화면에 "인식 중…" 후 결과가 채점됨
3. 함수 로그 확인: `supabase functions logs clova-stt`

함수만 단독 테스트(마이크 없이 WAV 파일로):
```bash
curl -X POST "https://<REF>.supabase.co/functions/v1/clova-stt" \
  -H "Content-Type: application/octet-stream" \
  --data-binary "@sample.wav"
# → {"text":"..."}
```

---

## 참고 / 트러블슈팅

- **오디오 포맷**: 프론트가 16kHz·16bit·mono **WAV**로 보내므로 CSR이 바로 처리합니다(webm/opus 변환 이슈 없음).
- **CORS**: 함수에 이미 허용 헤더가 들어있습니다. 특정 도메인만 허용하려면 `Access-Control-Allow-Origin`을 좁히세요.
- **비용**: CSR은 사용량 기반 과금(+무료 제공량). 데모/수업 규모면 부담 적습니다.
- **실시간 자막**: 이 방식은 "발화 종료 후 한 번" 변환이라 실시간 interim 자막은 없습니다.
  실시간 자막이 꼭 필요하면 CLOVA Speech **gRPC 스트리밍** + 상시 백엔드(Node)로 가야 하며, Supabase Edge Function으로는 부적합합니다.
- **CLOVA Speech(장문) 대안**: 더 긴 음성/화자분리 등이 필요하면 CSR 대신 CLOVA Speech(long) REST(`recognizer/upload`)로 교체할 수 있습니다. 이 경우 `index.ts`의 호출부만 바꾸면 됩니다.
