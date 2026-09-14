import { classifyTopics } from './qa.js';
import { addUserReview } from './reviews.js';

// "내 리뷰 추가하기": 실제 GPT/Claude/Gemini 호출 없이, 백엔드의 신뢰도(%) 판단 로직과
// 같은 규칙(각 모델이 긍정확률 0~100을 매기고 평균, 70/30 기준으로 확정)을 흉내 낸
// 프론트 목업이다. 긍정/부정 이분법 대신 확률로 판단해서 애매한 리뷰가 억지로 한쪽으로
// 분류되는 걸 줄인다 — 이 임계값(70/30)은 Q&A 갈림판단(judgeSplit)과 동일하다.
const POSITIVE_WORDS = [
  '좋아요', '좋았', '편하', '친절', '만족', '깨끗', '넉넉', '조용', '추천', '최고', '넓', '저렴', '편했다',
];
const NEGATIVE_WORDS = [
  '별로', '아쉽', '불편', '비싸', '좁', '시끄', '더럽', '불친절', '최악', '부족', '안 좋', '안좋',
];

const HIGH_THRESHOLD = 70; // 이 이상이면 확실 긍정 (app.qa.constants.SPLIT_THRESHOLD_HIGH와 동일)
const LOW_THRESHOLD = 30; // 이 이하면 확실 부정 (app.qa.constants.SPLIT_THRESHOLD_LOW와 동일)

function scoreText(text) {
  const pos = POSITIVE_WORDS.filter((w) => text.includes(w)).length;
  const neg = NEGATIVE_WORDS.filter((w) => text.includes(w)).length;
  return pos - neg;
}

// 입력값에 따라 매번 같은 결과가 나오도록(데모 재현성) Math.random 대신 문자열 해시를 쓴다
function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return hash;
}

function clamp(n) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

// 키워드 점수를 0~100 기준선으로 변환한다 (0점 = 애매한 50% 근처)
function baselineConfidence(score) {
  const clampedScore = Math.max(-3, Math.min(3, score));
  return 50 + clampedScore * 15;
}

// 모델 3개가 완전히 같은 숫자를 내지 않도록, 텍스트 해시로 모델별 약간의 편차를 준다
function jitter(text, modelName) {
  const h = hashCode(`${modelName}:${text}`);
  return (Math.abs(h) % 11) - 5; // -5 ~ +5
}

function simulateThreeModelConfidence(text) {
  const baseline = baselineConfidence(scoreText(text));
  return {
    gpt: clamp(baseline + jitter(text, 'gpt')),
    claude: clamp(baseline + jitter(text, 'claude')),
    gemini: clamp(baseline + jitter(text, 'gemini')),
  };
}

function finalFromAverage(avgConfidence) {
  if (avgConfidence >= HIGH_THRESHOLD) return '긍정';
  if (avgConfidence <= LOW_THRESHOLD) return '부정';
  return '판단보류';
}

function buildMessage(sentimentFinal, avgConfidence, topics) {
  if (sentimentFinal === '판단보류') {
    return `리뷰가 저장됐어요. 긍정 확률 평균 ${avgConfidence}%로 애매해서 검토 후 반영될 예정이에요.`;
  }
  const base = `리뷰가 저장됐어요. 긍정 확률 ${avgConfidence}% → ${sentimentFinal}으로 판단했어요.`;
  return topics.length > 0 ? `${base} 관련 토픽: ${topics.join(', ')}` : base;
}

// 등록 즉시: 신뢰도(%) 판단(3-LLM 평균 목업) + 토픽 태깅 -> REVIEWS에 반영 -> 결과 반환
export function submitReview(text) {
  const content = text.trim();
  const confidenceScores = simulateThreeModelConfidence(content);
  const avgConfidence = clamp(
    (confidenceScores.gpt + confidenceScores.claude + confidenceScores.gemini) / 3,
  );
  const sentimentFinal = finalFromAverage(avgConfidence);
  const topicTags = classifyTopics(content);

  addUserReview({ text: content, categories: topicTags, tone: sentimentFinal });

  return {
    content,
    sentimentFinal,
    confidenceScores,
    avgConfidence,
    topicTags,
    message: buildMessage(sentimentFinal, avgConfidence, topicTags),
  };
}
