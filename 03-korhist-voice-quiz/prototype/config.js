/*
 * 앱 설정
 * -----------------------------------------------------------
 * clovaEndpoint 를 비워두면(기본값) 브라우저 Web Speech API로 음성 인식.
 * Supabase Edge Function(clova-stt) 배포 후 그 URL을 넣으면 CLOVA STT로 전환된다.
 *   예) "https://<프로젝트ref>.supabase.co/functions/v1/clova-stt"
 *
 * 주의: 여기에는 '함수 URL'만 넣는다. CLOVA 비밀키는 절대 넣지 않는다
 *       (키는 Supabase 시크릿에 저장 — 서버에서만 사용).
 */
window.APP_CONFIG = {
  clovaEndpoint: "https://uwgpmarptqsbukwkjjcr.supabase.co/functions/v1/clova-stt",
  // Edge Function을 --no-verify-jwt 없이 배포했다면 Supabase anon key를 넣는다.
  // --no-verify-jwt 로 배포했으면 빈 값으로 둔다.
  supabaseAnonKey: ""
};
