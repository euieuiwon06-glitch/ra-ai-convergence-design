import { useState } from 'react';
import { submitReview } from '../data/reviewSubmit.js';
import './AddReview.css';

const MIN_LENGTH = 5;
const MAX_LENGTH = 1000;

function toneClass(tone) {
  if (tone === '긍정') return 'pos';
  if (tone === '부정') return 'neg';
  if (tone === '판단보류') return 'pending';
  return 'neutral';
}

function ConfidenceBar({ avgConfidence, sentimentFinal }) {
  return (
    <div className="confidence-bar">
      <div className="confidence-bar__track">
        <div
          className={`confidence-bar__fill confidence-bar__fill--${toneClass(sentimentFinal)}`}
          style={{ width: `${avgConfidence}%` }}
        />
      </div>
    </div>
  );
}

export default function AddReview() {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const submit = () => {
    const content = text.trim();
    if (content.length < MIN_LENGTH) {
      setError(`${MIN_LENGTH}자 이상 적어주세요.`);
      return;
    }
    if (content.length > MAX_LENGTH) {
      setError(`${MAX_LENGTH}자 이하로 적어주세요.`);
      return;
    }
    setError('');
    setResult(submitReview(content));
    setText('');
  };

  return (
    <div className="add-review">
      <div className="add-review__form">
        <textarea
          className="add-review__textarea"
          placeholder="다녀온 경험을 자유롭게 남겨주세요"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {error && <p className="add-review__error">{error}</p>}
        <button className="add-review__submit" onClick={submit}>
          등록하기
        </button>
      </div>

      {result && (
        <div className="add-review__result">
          <div className="add-review__result-header">
            <span className={`add-review__badge add-review__badge--${toneClass(result.sentimentFinal)}`}>
              {result.sentimentFinal === '판단보류' ? '검토중' : result.sentimentFinal}
            </span>
            <span className="add-review__confidence-pct">긍정 확률 {result.avgConfidence}%</span>
            {result.topicTags.map((tag) => (
              <span key={tag} className="add-review__tag">
                {tag}
              </span>
            ))}
          </div>

          <ConfidenceBar avgConfidence={result.avgConfidence} sentimentFinal={result.sentimentFinal} />
          <p className="add-review__confidence-detail">
            GPT {result.confidenceScores.gpt} · Claude {result.confidenceScores.claude} · Gemini{' '}
            {result.confidenceScores.gemini}
          </p>

          <p className="add-review__content">&ldquo;{result.content}&rdquo;</p>
          <p className="add-review__message">{result.message}</p>
        </div>
      )}
    </div>
  );
}
