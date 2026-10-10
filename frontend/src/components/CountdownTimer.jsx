import React, { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';

export function CountdownTimer({ endTime, onExpire, compact = false }) {
  const [timeLeft, setTimeLeft] = useState(() => calculateTimeLeft(endTime));

  function calculateTimeLeft(targetDate) {
    const diff = new Date(targetDate) - new Date();
    if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, isEnded: true };

    return {
      days: Math.floor(diff / (1000 * 60 * 60 * 24)),
      hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
      minutes: Math.floor((diff / 1000 / 60) % 60),
      seconds: Math.floor((diff / 1000) % 60),
      isEnded: false,
      isUrgent: diff < 5 * 60 * 1000, // less than 5 mins
    };
  }

  useEffect(() => {
    const timer = setInterval(() => {
      const remaining = calculateTimeLeft(endTime);
      setTimeLeft(remaining);

      if (remaining.isEnded) {
        clearInterval(timer);
        onExpire?.();
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [endTime, onExpire]);

  if (timeLeft.isEnded) {
    return (
      <span className="badge-ended">
        <Clock size={14} /> Auction Ended
      </span>
    );
  }

  const pad = (n) => String(n).padStart(2, '0');

  if (compact) {
    return (
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '5px 12px',
        borderRadius: '9999px',
        fontSize: '0.8rem',
        fontWeight: '700',
        background: timeLeft.isUrgent ? 'rgba(239, 68, 68, 0.25)' : 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        color: timeLeft.isUrgent ? '#fca5a5' : '#c7d2fe',
        border: `1px solid ${timeLeft.isUrgent ? 'rgba(239, 68, 68, 0.5)' : 'rgba(129, 140, 248, 0.4)'}`,
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
      }}>
        <Clock size={13} className={timeLeft.isUrgent ? 'animate-beacon' : ''} />
        {timeLeft.days > 0 && `${timeLeft.days}d `}
        {pad(timeLeft.hours)}:{pad(timeLeft.minutes)}:{pad(timeLeft.seconds)}
      </span>
    );
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '8px 14px',
      background: timeLeft.isUrgent ? 'rgba(239, 68, 68, 0.12)' : 'rgba(15, 23, 42, 0.7)',
      border: `1px solid ${timeLeft.isUrgent ? 'rgba(239, 68, 68, 0.35)' : 'var(--border-dim)'}`,
      borderRadius: 'var(--radius-md)',
      boxShadow: timeLeft.isUrgent ? '0 0 15px rgba(239, 68, 68, 0.2)' : 'none',
    }}>
      <Clock size={16} color={timeLeft.isUrgent ? '#ef4444' : '#818cf8'} />
      <div style={{ display: 'flex', gap: '6px', fontSize: '0.95rem', fontWeight: '700', fontVariantNumeric: 'tabular-nums' }}>
        {timeLeft.days > 0 && (
          <span>{timeLeft.days}<span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>d</span></span>
        )}
        <span>{pad(timeLeft.hours)}<span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>h</span></span>
        <span>:</span>
        <span>{pad(timeLeft.minutes)}<span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>m</span></span>
        <span>:</span>
        <span style={{ color: timeLeft.isUrgent ? '#ef4444' : 'inherit' }}>
          {pad(timeLeft.seconds)}<span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>s</span>
        </span>
      </div>
    </div>
  );
}
