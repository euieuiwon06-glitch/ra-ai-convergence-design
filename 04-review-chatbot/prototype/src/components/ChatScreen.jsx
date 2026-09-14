import { useCallback, useEffect, useRef } from 'react';
import InputBar from './InputBar.jsx';
import MessageBubble from './MessageBubble.jsx';
import { STORE } from '../data/qa.js';
import './ChatScreen.css';

export default function ChatScreen({ messages, onAsk, onBack, isPending }) {
  const listRef = useRef(null);
  const inputBarRef = useRef(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const focusInput = useCallback(() => {
    inputBarRef.current?.focus();
  }, []);

  return (
    <div className="chat">
      <div className="chat__header">
        <button className="chat__back" onClick={onBack} aria-label="뒤로가기">
          ←
        </button>
        <p className="chat__title">{STORE.name}</p>
      </div>

      <div className="chat__messages" ref={listRef}>
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} onRetry={focusInput} />
        ))}
      </div>

      <InputBar ref={inputBarRef} onSend={onAsk} disabled={isPending} />
    </div>
  );
}
