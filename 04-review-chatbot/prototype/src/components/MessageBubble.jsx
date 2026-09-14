import { useState } from 'react';
import { Dot } from './Icons.jsx';
import './MessageBubble.css';

function TypingDots() {
  return (
    <div className="bubble bubble--typing">
      <span className="typing-dot" />
      <span className="typing-dot" />
      <span className="typing-dot" />
    </div>
  );
}

function ReviewCard({ text, meta, tone }) {
  return (
    <div className={`review-card review-card--${tone}`}>
      <Dot color={tone === 'pos' ? 'var(--color-mint)' : 'var(--color-orange)'} />
      <div className="review-card__col">
        <p className="review-card__text">{text}</p>
        <p className="review-card__meta">{meta}</p>
      </div>
    </div>
  );
}

function EvidenceQuote({ evidence }) {
  const { text, highlightStart, highlightEnd } = evidence;
  return (
    <div className="evidence">
      <p className="evidence__label">원문 리뷰</p>
      <p className="evidence__quote">
        {'"'}
        {text.slice(0, highlightStart)}
        <strong>{text.slice(highlightStart, highlightEnd)}</strong>
        {text.slice(highlightEnd)}
        {'"'}
      </p>
    </div>
  );
}

function ConfidentBubble({ text, badge, evidence, naverMapUrl }) {
  return (
    <div className="bubble bubble--ai">
      <p className="bubble__text">{text}</p>
      <span className="badge badge--confident">{badge}</span>
      {evidence && <EvidenceQuote evidence={evidence} />}
      <div className="naver-links">
        <a className="pill-chip-light" href={naverMapUrl} target="_blank" rel="noreferrer">
          네이버지도 →
        </a>
        <p className="naver-links__caption">지도를 열면 리뷰도 바로 확인할 수 있어요</p>
      </div>
    </div>
  );
}

function SplitBubble({ summaryText, text, posLabel, negLabel, posRatio, negRatio, pos, neg, posReviews, negReviews }) {
  const [expanded, setExpanded] = useState(false);

  if (expanded) {
    return (
      <>
        <button className="bubble bubble--summary" onClick={() => setExpanded(false)}>
          <p className="bubble__text bubble__text--muted">{summaryText} 원문을 펼쳐볼게요 ▴</p>
        </button>
        <div className="review-group">
          <p className="review-group__label review-group__label--pos">
            {posLabel} 의견 ({pos})
          </p>
          <div className="review-group__list">
            {posReviews.map((r) => (
              <ReviewCard key={r.text} text={r.text} meta={r.meta} tone="pos" />
            ))}
          </div>
        </div>
        <div className="review-group">
          <p className="review-group__label review-group__label--neg">
            {negLabel} 의견 ({neg})
          </p>
          <div className="review-group__list">
            {negReviews.map((r) => (
              <ReviewCard key={r.text} text={r.text} meta={r.meta} tone="neg" />
            ))}
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="bubble bubble--ai">
      <span className="badge badge--warn">⚠ 의견 갈림</span>
      <p className="bubble__text">{text}</p>
      <div className="ratio-labels">
        <span className="ratio-labels__pos">
          {posLabel} {posRatio}%
        </span>
        <span className="ratio-labels__neg">
          {negLabel} {negRatio}%
        </span>
      </div>
      <div className="ratio-bar">
        <div className="ratio-bar__pos" style={{ width: `${posRatio}%` }} />
      </div>
      <button className="expand-btn" onClick={() => setExpanded(true)}>
        리뷰 원문 보기 ▾
      </button>
    </div>
  );
}

function InsufficientBubble({ text, naverMapUrl }) {
  return (
    <div className="bubble bubble--ai">
      <p className="bubble__text">{text}</p>
      {naverMapUrl && (
        <div className="naver-links">
          <a className="pill-chip-light" href={naverMapUrl} target="_blank" rel="noreferrer">
            네이버지도 →
          </a>
        </div>
      )}
    </div>
  );
}

function LocationLinkBubble({ text, naverMapUrl }) {
  return (
    <div className="bubble bubble--ai">
      <p className="bubble__text">{text}</p>
      <div className="naver-links">
        <a className="pill-chip-light" href={naverMapUrl} target="_blank" rel="noreferrer">
          네이버지도 →
        </a>
      </div>
    </div>
  );
}

function FailBubble({ text, example, onRetry }) {
  return (
    <div className="bubble bubble--ai">
      <p className="bubble__text">{text}</p>
      {example && <p className="bubble__example">{example}</p>}
      <button className="pill-chip-light" onClick={onRetry}>
        다시 질문하기
      </button>
    </div>
  );
}

export default function MessageBubble({ message, onRetry }) {
  if (message.role === 'user') {
    return (
      <div className="message-row message-row--user">
        <div className="bubble bubble--user">
          <p className="bubble__text">{message.text}</p>
        </div>
      </div>
    );
  }

  if (message.type === 'loading') {
    return (
      <div className="message-row message-row--ai">
        <TypingDots />
      </div>
    );
  }

  return (
    <div className="message-row message-row--ai">
      {message.type === 'confident' && <ConfidentBubble {...message} />}
      {message.type === 'split' && <SplitBubble {...message} />}
      {message.type === 'insufficient' && <InsufficientBubble {...message} />}
      {message.type === 'location_link' && <LocationLinkBubble {...message} />}
      {message.type === 'fail' && <FailBubble {...message} onRetry={onRetry} />}
    </div>
  );
}
