# RA · AI 융합디자인 과목 설계 프로젝트

**AI 융합디자인 1** 과목의 실습 예제를 만드는 RA(연구보조원) 활동에서 진행한 프로젝트 4개를 모았습니다.
각 프로젝트는 과목 가이드라인의 10단계(UX 문제 정의 → 사례 조사 → 입력 신호 선정 → 시나리오 → 데이터 수집·레이블링 → 모델 학습·검증 → 피드백 전략 → UI 디자인 → AI-UI 연동 → 사용성 평가)를 따라 기획부터 동작하는 프로토타입, 학생용 유인물까지 만들었습니다.

> 활동 기간 2026년 6월 ~ 8월 · 작성자 정원의

🔗 **프로토타입 모음 (GitHub Pages):** https://euieuiwon06-glitch.github.io/ra-ai-convergence-design/

## 프로젝트

| # | 프로젝트 | 트랙 | 한 줄 요약 | 핵심 기술 | 데모 |
|---|---|---|---|---|---|
| 01 | [자세 코치 (PostureCoach)](01-posture-coach/) | 컴퓨터 비전 · 자세 | 온라인 학습 중 흐트러진 자세를 웹캠으로 감지해 방해 없이 알려주는 데스크톱 앱 | Teachable Machine Pose, Electron | [웹](https://euieuiwon06-glitch.github.io/ra-ai-convergence-design/01-posture-coach/prototype/) · [exe](https://github.com/euieuiwon06-glitch/ra-ai-convergence-design/releases) |
| 02 | [Poise · 발표 습관 코칭](02-poise-presentation-coach/) | 컴퓨터 비전 · 움직임 | 발표 연습 영상을 녹화하면 시선·고개·상체·정지 습관을 감지해 리포트를 주는 앱 | MoveNet, MediaRecorder, Supabase | [라이브](https://poise-deploy.vercel.app) |
| 03 | [소리 내어 외우는 한국사](03-korhist-voice-quiz/) | 음성 | 사건 카드를 보고 소리 내어 설명하면 STT + 핵심어 규칙으로 채점하는 암기 퀴즈 | Web Speech API, CLOVA STT, TextRank | [웹](https://euieuiwon06-glitch.github.io/ra-ai-convergence-design/03-korhist-voice-quiz/prototype/) |
| 04 | [스터디카페 리뷰 챗봇](04-review-chatbot/) | 텍스트 · 생성형 AI | 리뷰를 근거로 질문에 답하고, 의견이 갈리면 비율과 원문을 함께 보여주는 Q&A 챗봇 | 3-LLM 교차검증 레이블링, React, FastAPI | [웹](https://euieuiwon06-glitch.github.io/ra-ai-convergence-design/04-review-chatbot/demo/) |

## 폴더 구성

프로젝트마다 같은 구조로 정리했습니다. 해당 자료가 없는 폴더는 생략했습니다.

```
0X-project/
├── README.md     프로젝트 요약 (문제 정의 · 설계 · 구현 · 한계)
├── prototype/    동작하는 프로토타입 소스
├── backend/      서버 코드 (03, 04)
├── design/       UI 화면 디자인 (시안 · 확정)
├── data/         데이터 수집 · 레이블링 · 검증 자료
├── docs/         최종 기획안 · 진행 과정 정리 (프로젝트당 1개)
├── handout/      학생용 최종 유인물
└── slides/       강의 슬라이드 (PDF)
```

## 공통으로 얻은 설계 원칙

- **순간이 아니라 지속 시간으로 판단한다.** 한 프레임의 인식 결과에 바로 반응하지 않고 같은 상태가 일정 시간 이어질 때만 확정해, 모델의 순간 오분류가 잘못된 알림으로 이어지지 않게 했습니다. (자세 코치, Poise)
- **알림은 약하게 시작해 단계적으로 강해진다.** 즉각적인 경고음이 오히려 피로와 방해를 준다는 선행 연구를 반영해 5초 확정 → 10초 시각 알림 → 20초 소리 순서로 개입합니다. (자세 코치, Poise)
- **AI의 판단은 설명할 수 있어야 한다.** AI는 음성·텍스트를 변환하고 분류하는 데 쓰고, 정답 여부나 답변 상태는 사용자에게 설명할 수 있는 규칙(핵심어 개수, 긍정:부정 7:3 기준)으로 정했습니다. (한국사 퀴즈, 리뷰 챗봇)
- **데이터 기준은 한 사람의 판단에 기대지 않는다.** 리뷰 레이블은 GPT · Claude · Gemini 교차검증과 다수결로, 암기 키워드는 TextRank 알고리즘으로 정해 주관성을 줄였습니다. (리뷰 챗봇, 한국사 퀴즈)

## 저장소에 넣지 않은 자료

- 100MB가 넘는 유인물 PDF (03, 04): 같은 내용의 `.docx`를 대신 넣었습니다.
- 자세 모델 학습용 웹캠 촬영 이미지, 리뷰 원문 스크린샷 (개인정보·제3자 작성 콘텐츠)
- 01의 Windows 실행 파일(67MB): [Releases](https://github.com/euieuiwon06-glitch/ra-ai-convergence-design/releases)에 올렸습니다.
