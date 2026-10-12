import React from 'react';

export function OtpField({
  value,
  onChange,
  label,
  error,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  label: string;
  error?: boolean;
}) {
  return (
    <div className={`field ${error ? 'error' : ''}`}>
      <label htmlFor="otp">{label}</label>
      <input
        id="otp"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={value}
        onChange={onChange}
        autoFocus
        style={{ letterSpacing: '0.3em', fontWeight: 700 }}
      />
    </div>
  );
}
