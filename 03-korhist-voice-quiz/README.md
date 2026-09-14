# 03 · 소리 내어 외우는 한국사

**음성 기반 UX 분석 및 UI 디자인**

사건 이름이 화면에 잠깐 나타났다 사라지면 사용자가 소리 내어 설명하고, 음성을 텍스트로 바꾼 뒤 **핵심어가 들어갔는지**로 채점하는 인터랙티브 암기 퀴즈입니다.
직접 소리 내어 답을 떠올릴 때 기억이 더 오래 남는다는 **발화 효과·생성 효과**에 근거했습니다.

- 🖥️ **웹 프로토타입:** https://euieuiwon06-glitch.github.io/ra-ai-convergence-design/03-korhist-voice-quiz/prototype/ (Chrome · Edge 권장, 마이크가 안 되면 키보드로 답하기)

![카드 노출 화면](design/3%20·%20카드%20노출.png)

| 항목 | 내용 |
|---|---|
| 타깃 | 한국사능력검정시험을 준비하는 학습자 |
| 흐름 | 스플래시 → 홈 → 단원 선택 → [카드 노출 3초 → 듣는 중 → 피드백] × 5 → 결과 요약 → 학습 통계 |
| 기술 | HTML/CSS/JS, Web Speech API, 네이버 CLOVA Speech, Supabase Edge Function, kiwipiepy, TextRank |

## 핵심 원칙 — AI는 변환에만, 채점은 규칙으로

LLM은 정답 판정에 쓰지 않습니다. AI는 음성을 텍스트로 바꾸는 데만 쓰고, 맞고 틀림은 정해 둔 키워드가 몇 개 들어 있는지 세는 규칙으로 정합니다.

| 일치 개수 (키워드 5개 중) | 결과 |
|---|---|
| 5개 | 완전정답 |
| 3개 이상 | 통과 |
| 1~2개 | 부분정답 |
| 0개 | 모름 |

처음에는 "1개 이상 통과"여서 사건 이름만 말해도 통과되는 문제가 있었습니다. 교수님 피드백을 반영해 통과 기준을 5개 중 3개로 올렸고, 이제는 연도·계기·내용을 실제로 설명해야 통과합니다.

## 핵심 키워드를 알고리즘으로 추출

손으로 고른 키워드는 주관적이라는 지적을 받아 자동 추출로 바꿨습니다.

1. **원문 확보:** 한능검 공식 해설·기출 제시문
2. **형태소 분석:** 명사만 추출 (kiwipiepy)
3. **TextRank:** 함께 등장하는 관계로 그래프를 만들고 단어 중요도를 계산 (PageRank 원리)
4. **공통 일반어 억제:** '조선', '일본'처럼 3개 이상 문항에 나오는 단어 제외
5. **보정 규칙:** 5칸 중 1칸은 연도로 고정, 상위 랭크 핵심 인물 포함

TextRank 원본 결과(`textrank_결과.json`)와 보정 후 최종 키워드를 구분해 [추출 근거표](data/keyword-extraction/)로 남겼습니다.

## 음성 인식 연동

- **1차:** 설치 없이 동작하는 브라우저 Web Speech API (ko-KR)
- **2차:** 정확도를 높이려고 네이버 CLOVA Speech 연동
  - CLOVA는 브라우저에서 직접 호출할 수 없고 비밀키를 노출하면 안 되므로 **Supabase Edge Function(`clova-stt`)** 을 중간 서버로 둠
  - 브라우저 녹음(webm)을 앱에서 **16kHz WAV로 직접 인코딩**해 전송
  - 키는 Supabase 시크릿에만 저장하고, 앱 설정에는 함수 URL만 넣음
  - 서버 오류가 나면 자동으로 키보드 입력 모드로 전환
- 문항마다 권한을 다시 묻던 문제를 고쳐, 시작할 때 한 번만 권한을 받고 마이크 스트림을 유지

## 학습 통계

`localStorage`에 누적: 총 학습 횟수, 누적 정답률, 연속 학습일, 최근 7회 추이, **자주 놓치는 핵심어 Top3**.

## 폴더

```
prototype/                 index.html · app.js(상태 머신·타이머·채점) · data.js(문항) · clova.js(WAV 녹음) · config.js
backend/clova-backend/     Supabase Edge Function 소스와 배포 방법
design/                    화면 UI
data/keyword-extraction/   원문, TextRank 결과, 추출 과정, 근거표(xlsx), 추출 스크립트
docs/                      개발 과정 정리
handout/                   유인물 docx
slides/                    강의 슬라이드
```

### 실행

`prototype/앱 실행.bat`을 더블클릭하면 Python 로컬 서버를 켜고 브라우저를 엽니다. 직접 실행하려면:

```bash
cd prototype
python -m http.server 8123   # http://localhost:8123
```

`config.js`의 `clovaEndpoint`를 비우면 Web Speech API만 사용합니다.
