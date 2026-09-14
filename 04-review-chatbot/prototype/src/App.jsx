import { useCallback, useRef, useState } from 'react';
import Home from './components/Home.jsx';
import ChatScreen from './components/ChatScreen.jsx';
import { resolveAnswer } from './data/qa.js';
import './App.css';

let idCounter = 0;
const nextId = () => `msg-${++idCounter}`;

function App() {
  const [screen, setScreen] = useState('home'); // 'home' | 'chat'
  const [messages, setMessages] = useState([]);
  const [isPending, setIsPending] = useState(false);
  const pendingTimer = useRef(null);

  const askQuestion = useCallback((rawText) => {
    const text = rawText.trim();
    if (!text) return;

    setScreen('chat');
    setIsPending(true);

    const userMessage = { id: nextId(), role: 'user', text };
    const loadingId = nextId();
    const loadingMessage = { id: loadingId, role: 'ai', type: 'loading' };
    setMessages((prev) => [...prev, userMessage, loadingMessage]);

    if (pendingTimer.current) clearTimeout(pendingTimer.current);
    pendingTimer.current = setTimeout(() => {
      const answer = resolveAnswer(text);
      setMessages((prev) =>
        prev.map((m) => (m.id === loadingId ? { id: loadingId, role: 'ai', ...answer } : m)),
      );
      setIsPending(false);
    }, 900 + Math.random() * 500);
  }, []);

  const goHome = useCallback(() => {
    if (pendingTimer.current) clearTimeout(pendingTimer.current);
    setIsPending(false);
    setMessages([]);
    setScreen('home');
  }, []);

  return (
    <div className="phone">
      {screen === 'home' ? (
        <Home onAsk={askQuestion} />
      ) : (
        <ChatScreen messages={messages} onAsk={askQuestion} onBack={goHome} isPending={isPending} />
      )}
    </div>
  );
}

export default App;
