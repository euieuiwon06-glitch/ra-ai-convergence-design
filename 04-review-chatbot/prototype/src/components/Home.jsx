import { useState } from 'react';
import { Avatar, Dot } from './Icons.jsx';
import InputBar from './InputBar.jsx';
import AddReview from './AddReview.jsx';
import { EXAMPLE_QUESTIONS } from '../data/qa.js';
import './Home.css';

const TABS = ['리뷰 물어보기', '내 리뷰 추가하기'];

export default function Home({ onAsk }) {
  const [activeTab, setActiveTab] = useState(TABS[0]);

  return (
    <div className="home">
      <div className="home__header">
        <div className="home__top-row">
          <p className="home__greeting">안녕하세요</p>
          <Avatar />
        </div>
        <p className="home__title">단디 스터디카페</p>
      </div>

      <div className="home__segment">
        {TABS.map((tab) => (
          <button
            key={tab}
            className={`home__seg-chip ${activeTab === tab ? 'is-active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === TABS[0] ? (
        <>
          <div className="home__list">
            <div className="home__tip">
              <Dot size={8} />
              <p>방문 전 궁금한 점을 자유롭게 물어보세요</p>
            </div>

            <div className="home__examples">
              <p className="home__examples-label">이런 걸 물어볼 수 있어요</p>
              <div className="home__example-list">
                {EXAMPLE_QUESTIONS.map((q) => (
                  <button key={q} className="home__example-row" onClick={() => onAsk(q)}>
                    <Dot size={6} />
                    <span>{q}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <InputBar onSend={onAsk} />
        </>
      ) : (
        <AddReview />
      )}
    </div>
  );
}
