import React, { useState } from 'react';

export function PasswordField({
  value,
  onChange,
  label,
  error,
  showLabel,
  hideLabel,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  label: string;
  error?: boolean;
  showLabel: string;
  hideLabel: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className={`field ${error ? 'error' : ''}`}>
      <label htmlFor="password">{label}</label>
      <input
        id="password"
        type={show ? 'text' : 'password'}
        autoComplete="current-password"
        value={value}
        onChange={onChange}
        autoFocus
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        aria-pressed={show}
        aria-label={show ? hideLabel : showLabel}
        style={{
          position: 'absolute',
          right: '15px',
          top: '50%',
          transform: 'translateY(-50%)',
          background: 'none',
          border: 0,
          cursor: 'pointer',
          color: 'var(--muted)',
          fontSize: '13px',
          fontWeight: 600,
        }}
      >
        {show ? hideLabel : showLabel}
      </button>
    </div>
  );
}
