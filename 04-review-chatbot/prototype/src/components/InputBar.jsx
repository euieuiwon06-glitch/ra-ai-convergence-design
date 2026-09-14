import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { SendIcon } from './Icons.jsx';
import './InputBar.css';

const InputBar = forwardRef(function InputBar({ onSend, disabled }, ref) {
  const [value, setValue] = useState('');
  const inputRef = useRef(null);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
  }));

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue('');
  };

  return (
    <div className="input-bar">
      <div className="input-bar__field">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          placeholder="질문을 입력하세요"
          disabled={disabled}
        />
      </div>
      <button className="input-bar__send" onClick={submit} disabled={disabled} aria-label="전송">
        <SendIcon />
      </button>
    </div>
  );
});

export default InputBar;
