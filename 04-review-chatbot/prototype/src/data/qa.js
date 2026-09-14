import { CATEGORIES, reviewsByCategory } from './reviews.js';

// 매장 정보 (Figma 챗 헤더 및 네이버 링크에 사용)
export const STORE = {
  name: '단디스터디카페 전농점',
  naverMapUrl:
    'https://map.naver.com/p/entry/place/2076839402?placePath=%2Fhome%3Fentry%3Dplt%26from%3Dmap%26fromPanelNum%3D1%26additionalHeight%3D76%26timestamp%3D202607291021%26locale%3Dko%26svcName%3Dmap_pcv5&searchType=place&lng=127.0598699&lat=37.5776010&c=15.00,0,0,0,dh',
};

// 홈 화면에 노출되는 예시 질문 (Figma 디자인 그대로)
export const EXAMPLE_QUESTIONS = [
  '시험기간에도 자리 있어?',
  '주차장 있나요?',
  '2층이랑 4층 중 어디가 조용해?',
];

const norm = (s) => s.replace(/\s+/g, '').toLowerCase();

// 카테고리 분류용 키워드. 리뷰 문장에 실제로 쓰인 단어 + 자연스러운 질문 표현을 함께 담았다.
const CATEGORY_KEYWORDS = {
  혼잡도: [
    '자리', '붐비', '붐빔', '혼잡', '한산', '한적', '사람', '만석', '대기', '줄',
    '노쇼', '예약', '전세', '경쟁', '북적', '몰린다', '몰려', '빈자리',
  ],
  소음: [
    '소음', '조용', '시끄', '방음', '헤드폰', '통화', '타이핑', '백색소음',
    '도로', '여닫', '에어컨소리', '대화소리', '음악', '소리',
  ],
  시설: [
    '콘센트', '전원', '충전기', '충전', '주차', '주차장', '발렛', '차량',
    '와이파이', 'wifi', '의자', '모니터', '화장실', '프린터', '사물함', '캐비닛', '짐보관',
    '냉난방', '정수기', '조명', '스탠드', '책상', '안마의자', '칸막이',
    '노트북', '카페형', '세미나실', '캐럴', '락커', '가격', '요금', '할인', '환불',
    '정기권', '1일권', '회원권', '직원', '청소', '관리', '입구', '엘리베이터',
    '접근성', '편의점', '시설',
  ],
  몰입환경: [
    '인테리어', '분위기', '자연광', '산만', '향', '집중', '창가', '공간', '넓',
    '스터디그룹', '몰입', '안정감', '냄새', '문구', '오픈된구조', '골목', '안전',
    '무섭', '눈이아프',
  ],
  운영시간: [
    '24시간', '24시', '운영시간', '영업시간', '새벽', '문을닫', '문을열', '연장',
    '명절', '자정', '365일', '오전', '심야', '할증', '오픈시간', '마감', '몇시',
    '언제까지', '언제부터', '휴무',
  ],
};

// 카테고리별 자연어 표현 (답변 문장 생성에 사용)
const CATEGORY_INFO = {
  혼잡도: { topic: '혼잡도', posLabel: '여유', negLabel: '붐빔' },
  소음: { topic: '소음', posLabel: '조용함', negLabel: '시끄러움' },
  시설: { topic: '시설', posLabel: '만족', negLabel: '불만' },
  몰입환경: { topic: '몰입 환경', posLabel: '좋음', negLabel: '아쉬움' },
  운영시간: { topic: '운영시간', posLabel: '만족', negLabel: '불편' },
};

// 카테고리 대부분은 통째로 한 유형(사실형 fact / 맥락형 context)이지만, "시설"은
// 유무 확인 질문("콘센트 있어요?")과 품질/경험 판단 질문("직원 친절해요?")이 섞여 있어서
// 카테고리 단위가 아니라 질문에 실제로 쓰인 키워드 단위로 나눈다(백엔드 classify_question_type과 동일 기준).
const CATEGORY_QUESTION_TYPE = {
  운영시간: 'fact',
  혼잡도: 'context',
  소음: 'context',
  몰입환경: 'context',
};

const FACILITY_FACT_KEYWORDS = [
  '콘센트', '전원', '충전기', '충전', '주차', '주차장', '발렛', '차량',
  '사물함', '락커', '캐비닛', '짐보관', '와이파이', 'wifi', '화장실',
  '프린터', '냉난방', '정수기', '엘리베이터', '편의점', '스탠드', '노트북',
  '카페형', '세미나실', '캐럴', '정기권', '1일권', '회원권', '안마의자', '모니터',
];

const FACILITY_CONTEXT_KEYWORDS = [
  '의자', '조명', '책상', '칸막이', '가격', '요금', '할인', '환불',
  '직원', '청소', '관리', '입구', '접근성', '시설',
];

// 질문 유형(사실형/맥락형) 판단 — "시설"만 질문 키워드로 세분화하고, 나머지는 카테고리 기본값
function classifyQuestionType(question, category) {
  if (category !== '시설') return CATEGORY_QUESTION_TYPE[category] ?? 'context';

  const q = norm(question);
  if (FACILITY_FACT_KEYWORDS.some((kw) => q.includes(norm(kw)))) return 'fact';
  if (FACILITY_CONTEXT_KEYWORDS.some((kw) => q.includes(norm(kw)))) return 'context';
  return 'context'; // 어느 쪽인지 특정 못하면 안전하게 맥락형(3개 기준)
}

// 위치/오시는 길 질문 — 카테고리 분류보다 먼저 체크해서, 리뷰 데이터 유무와 무관하게
// 항상 네이버지도 링크로 답한다("위치가 어디야?"는 애초에 리뷰로 답할 질문이 아니다).
// 주의: 바로 "어디"만 넣으면 "2층이랑 4층 중 어디가 조용해?" 같은 비교 질문("어디가" = 어느 쪽이)까지
// 위치 질문으로 오인한다. 그래서 "어디" 뒤에 위치를 묻는 말투가 붙는 구체적인 형태만 넣는다.
const LOCATION_KEYWORDS = [
  '위치', '지도', '오시는길', '오시는 길', '찾아오', '길찾기',
  '어디야', '어디예요', '어디에요', '어디임', '어디있', '어딘가요', '어디로', '어디쯤',
];

function isLocationQuestion(question) {
  const q = norm(question);
  return LOCATION_KEYWORDS.some((kw) => q.includes(norm(kw)));
}

// 카테고리 키워드에는 안 걸리지만 "스터디카페 얘기이긴 하다"를 판단하기 위한 폭넓은 키워드
// (예: 주차장처럼, 카테고리 데이터는 없지만 스터디카페 관련 질문인 경우)
const GENERAL_RELEVANCE_KEYWORDS = [
  ...new Set(Object.values(CATEGORY_KEYWORDS).flat()),
  '스터디카페', '스카', '카페', '이용', '주차', '대여', '회원', '리뷰',
];

// 질문 토큰 매칭에서 무시할 흔한 조사/어미류
const STOPWORDS = new Set([
  '있어', '있어요', '있나요', '있나', '있을까요', '있을까', '되나요', '되나',
  '돼요', '인가요', '인가', '어때', '어때요', '좋아요', '좋아', '나요', '해요',
  '인지', '는지', '거야', '거에요', '줘', '알려줘', '궁금해요', '궁금합니다',
  '합니까', '습니까', '없나요', '없어요', '정말', '진짜', '너무', '그리고',
  '근데', '혹시', '여기', '거기', '저기', '그거',
]);

function extractTokens(str) {
  const cleaned = str.replace(/[?!.,~"'`]/g, ' ');
  return cleaned
    .split(/\s+/)
    .map((w) => norm(w))
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w));
}

// 완전히 같은 단어는 아니어도 (조사/어미 변형) 같은 주제로 볼 수 있는지 느슨하게 판단
function looksRelated(a, b) {
  if (a === b) return true;
  if (a.length >= 2 && b.length >= 2 && (a.includes(b) || b.includes(a))) return true;
  return a.slice(0, 2) === b.slice(0, 2) && a.slice(0, 2).length === 2;
}

// "내 리뷰 추가하기"의 토픽 태깅에서 재사용 — 질문 하나의 대표 카테고리를 고르는
// classifyCategory와 달리, 리뷰 문장에 해당하는 카테고리를 전부(0개 이상) 반환한다.
export function classifyTopics(text) {
  const q = norm(text);
  return CATEGORIES.filter((category) =>
    CATEGORY_KEYWORDS[category].some((kw) => q.includes(norm(kw))),
  );
}

function classifyCategory(question) {
  const q = norm(question);
  let bestCategory = null;
  let bestScore = 0;

  for (const category of CATEGORIES) {
    const score = CATEGORY_KEYWORDS[category].reduce(
      (acc, kw) => acc + (q.includes(norm(kw)) ? 1 : 0),
      0,
    );
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  return { category: bestCategory, score: bestScore };
}

// 질문 속 단어와 겹치는 리뷰만 골라 더 구체적인 답을 시도한다.
// 매칭이 하나도 없을 때: 맥락형(예: "시설 어때요?" 같은 포괄적 질문)은 종합 인상을 묻는
// 것이라 카테고리 전체를 대체 근거로 써도 되지만, 사실형(예: "주차장 있어요?", "몇 시까지
// 해요?")은 특정 사실 하나를 콕 집어 묻는 것이라 카테고리 전체로 대체하면 안 된다 —
// 그러면 질문과 실제로는 무관한 리뷰(예: 주차장 질문에 사물함 리뷰, 마감시간 질문에
// 방학중 단축운영 리뷰)가 근거로 둔갑해버린다. 그래서 사실형은 매칭이 없으면 빈 배열을
// 반환해 "정보 없음"으로 정직하게 처리한다(운영시간/위치는 이 경우에도 호출부에서
// 네이버지도 링크를 붙여준다).
function narrowReviews(categoryReviews, question, questionType) {
  const questionTokens = extractTokens(question);
  if (questionTokens.length === 0) return categoryReviews;

  const matched = categoryReviews.filter((r) => {
    const reviewTokens = extractTokens(r.text);
    return reviewTokens.some((rt) => questionTokens.some((qt) => looksRelated(qt, rt)));
  });

  if (matched.length > 0) return matched;
  return questionType === 'fact' ? [] : categoryReviews;
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const INSUFFICIENT_TEXT = '아직 관련 리뷰가 3개 미만이라 답변이 어려워요.';
// 사실형(fact)은 리뷰 1개로도 답변 가능, 맥락형(context)은 기존대로 3개 이상 필요
const MIN_REVIEWS_FACT = 1;
const MIN_REVIEWS_CONTEXT = 3;
const SPLIT_THRESHOLD = 0.3; // 기준 70:30 — 이보다 좁으면(더 팽팽하면) 의견 갈림

// 의견갈림 판단 로직 (기준 7:3). 정확히 70:30인 경우는 "갈림 아님"으로 취급한다(경계값 미포함).
export function judgeSplit(positiveCount, negativeCount) {
  const total = positiveCount + negativeCount;
  if (total === 0) return null;
  const posRatio = positiveCount / total;
  const negRatio = negativeCount / total;
  const isSplit = Math.min(posRatio, negRatio) > SPLIT_THRESHOLD;
  return {
    isSplit,
    posRatio: Math.round(posRatio * 100),
    negRatio: Math.round(negRatio * 100),
  };
}

function buildAnswerFromReviews(category, reviews, questionType) {
  const info = CATEGORY_INFO[category];
  const pos = reviews.filter((r) => r.tone === '긍정');
  const neg = reviews.filter((r) => r.tone === '부정');
  const total = pos.length + neg.length;

  const minRequired = questionType === 'fact' ? MIN_REVIEWS_FACT : MIN_REVIEWS_CONTEXT;
  if (total < minRequired) {
    if (category === '운영시간') {
      // 영업시간은 리뷰로 답을 못 찾아도 링크는 항상 준다 — 네이버지도에 바로 나오는 정보라서
      return {
        type: 'insufficient',
        text: '아직 운영시간 관련 리뷰가 없어서 정확히 답하기 어려워요. 네이버지도에서 영업시간을 바로 확인할 수 있어요.',
        naverMapUrl: STORE.naverMapUrl,
      };
    }
    if (questionType === 'fact') {
      return { type: 'insufficient', text: `아직 ${info.topic} 관련 리뷰가 없어서 확인이 어려워요.` };
    }
    return { type: 'insufficient', text: INSUFFICIENT_TEXT };
  }

  // 사실형(fact): 유무 확인성 질문이라 종합/갈림 판단 없이 다수쪽 의견으로 바로 답변한다
  if (questionType === 'fact') {
    const majorTone = pos.length >= neg.length ? '긍정' : '부정';
    const majorGroup = majorTone === '긍정' ? pos : neg;
    const sample = pickRandom(majorGroup);
    const toneWord = majorTone === '긍정' ? '긍정적인' : '부정적인';

    return {
      type: 'confident',
      text: `${info.topic} 관련 리뷰 ${total}개 중 ${majorGroup.length}개가 ${toneWord} 의견이었어요.`,
      badge: `리뷰 ${total}개 중 ${majorGroup.length}개 근거`,
      evidence: {
        reviewId: sample.id,
        text: sample.text,
        meta: sample.meta,
        highlightStart: 0,
        highlightEnd: sample.text.length,
      },
      naverMapUrl: STORE.naverMapUrl,
    };
  }

  // 맥락형(context): 기존 그대로 — 3개 이상 모이면 70:30 기준으로 확실/갈림 판단
  const { isSplit, posRatio, negRatio } = judgeSplit(pos.length, neg.length);

  if (isSplit) {
    return {
      type: 'split',
      text: `${info.topic} 관련 리뷰 ${total}개 중 의견이 갈려요. (긍정 ${posRatio}% · 부정 ${negRatio}%, 기준 70:30)`,
      summaryText: `${info.topic} 관련 리뷰 ${total}개 중 의견이 갈려요.`,
      posLabel: info.posLabel,
      negLabel: info.negLabel,
      posRatio,
      negRatio,
      pos: pos.length,
      neg: neg.length,
      posReviews: pos.slice(0, 5).map((r) => ({ text: r.text, meta: r.meta })),
      negReviews: neg.slice(0, 5).map((r) => ({ text: r.text, meta: r.meta })),
    };
  }

  const majorTone = pos.length >= neg.length ? '긍정' : '부정';
  const majorGroup = majorTone === '긍정' ? pos : neg;
  const sample = pickRandom(majorGroup);
  const toneWord = majorTone === '긍정' ? '긍정적인' : '부정적인';

  return {
    type: 'confident',
    text: `${info.topic} 관련 리뷰 ${total}개 중 ${majorGroup.length}개가 ${toneWord} 의견이었어요.`,
    badge: `리뷰 ${total}개 중 ${majorGroup.length}개 근거`,
    // 답변 생성에 실제 근거로 쓴 리뷰 원문(요약/재구성 없이 그대로) + 강조 구간
    evidence: {
      reviewId: sample.id,
      text: sample.text,
      meta: sample.meta,
      highlightStart: 0,
      highlightEnd: sample.text.length,
    },
    naverMapUrl: STORE.naverMapUrl,
  };
}

// 질문 텍스트로 답변을 찾는다:
// 0) 위치 질문이면 리뷰 조회 없이 바로 네이버지도 링크로 답한다
// 1) 카테고리 분류 -> 2) 카테고리 리뷰 중 질문과 관련된 리뷰로 좁히기 -> 3) 톤 비율로 확실/갈림/정보부족 판단
// 카테고리를 못 찾았지만 스터디카페 관련 질문이면 정보부족, 아예 관련 없으면 이해실패("맥락 없는 질문")
export function resolveAnswer(question) {
  if (isLocationQuestion(question)) {
    return {
      type: 'location_link',
      text: `${STORE.name} 위치는 아래 링크에서 바로 확인할 수 있어요.`,
      naverMapUrl: STORE.naverMapUrl,
    };
  }

  const { category, score } = classifyCategory(question);

  if (!category || score === 0) {
    const q = norm(question);
    const isGenerallyRelevant = GENERAL_RELEVANCE_KEYWORDS.some((kw) => q.includes(norm(kw)));
    if (isGenerallyRelevant) {
      return { type: 'insufficient', text: INSUFFICIENT_TEXT };
    }
    return {
      type: 'fail',
      text: '스터디카페 관련 질문으로 다시 물어봐주세요.',
      example: '예: "주차장 있어?" "몇 시까지 열어?"',
    };
  }

  const categoryReviews = reviewsByCategory(category);
  const questionType = classifyQuestionType(question, category);
  const narrowed = narrowReviews(categoryReviews, question, questionType);
  return buildAnswerFromReviews(category, narrowed, questionType);
}
