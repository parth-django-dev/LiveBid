import React from 'react';
import { Zap, User as UserIcon, LogOut, ShieldCheck, Flame, Plus, LayoutDashboard } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export function Navbar({ onNavigate, currentView, activeAuctionCount = 0, onOpenCreateModal }) {
  const { user, isAuthenticated, logout, openAuth } = useAuth();

  return (
    <header style={{
      position: 'sticky',
      top: 0,
      zIndex: 50,
      backgroundColor: 'rgba(7, 10, 18, 0.85)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      borderBottom: '1px solid var(--border-dim)',
      padding: '12px 24px',
    }}>
      <div style={{
        maxWidth: '1280px',
        margin: '0 auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        {/* Brand Logo & Navigation Links */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
          <div 
            onClick={() => onNavigate('catalog')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              cursor: 'pointer',
            }}
          >
            <div style={{
              width: '38px',
              height: '38px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, #6366f1 0%, #06b6d4 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 15px rgba(99, 102, 241, 0.4)',
            }}>
              <Zap size={22} color="#ffffff" fill="#ffffff" />
            </div>
            <div>
              <div style={{
                fontSize: '1.25rem',
                fontWeight: '900',
                letterSpacing: '-0.03em',
                lineHeight: 1.1,
              }}>
                LIVE<span className="text-gradient-accent">BID</span>
              </div>
              <div style={{
                fontSize: '0.68rem',
                color: 'var(--text-dim)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                fontWeight: '600',
              }}>
                Real-Time Arena
              </div>
            </div>
          </div>

          {/* Navigation Links */}
          <nav style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={() => onNavigate('catalog')}
              style={{
                background: currentView === 'catalog' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                color: currentView === 'catalog' ? '#ffffff' : 'var(--text-muted)',
                border: 'none',
                padding: '8px 14px',
                borderRadius: 'var(--radius-md)',
                fontSize: '0.9rem',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              Auctions
            </button>

            <button
              onClick={() => {
                if (!isAuthenticated) {
                  openAuth('login');
                } else {
                  onNavigate('dashboard');
                }
              }}
              style={{
                background: currentView === 'dashboard' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                color: currentView === 'dashboard' ? '#ffffff' : 'var(--text-muted)',
                border: 'none',
                padding: '8px 14px',
                borderRadius: 'var(--radius-md)',
                fontSize: '0.9rem',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.2s ease',
              }}
            >
              <LayoutDashboard size={15} /> My Bids
            </button>
          </nav>
        </div>

        {/* Right Action Bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {/* List Item CTA Button */}
          <button
            onClick={() => {
              if (!isAuthenticated) {
                openAuth('login');
              } else {
                onOpenCreateModal();
              }
            }}
            className="btn btn-primary"
            style={{ padding: '8px 16px', fontSize: '0.88rem' }}
          >
            <Plus size={16} /> List Item
          </button>

          {/* User Profile / Auth State */}
          {isAuthenticated ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div 
                onClick={() => onNavigate('dashboard')}
                title="Open Dashboard"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '6px 14px',
                  borderRadius: 'var(--radius-md)',
                  background: 'rgba(99, 102, 241, 0.12)',
                  border: '1px solid rgba(99, 102, 241, 0.3)',
                  color: '#c7d2fe',
                  fontSize: '0.9rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                <ShieldCheck size={16} color="#818cf8" />
                <span>{user.username}</span>
              </div>
              <button 
                onClick={logout}
                title="Log Out"
                className="btn btn-secondary"
                style={{ padding: '8px', borderRadius: 'var(--radius-md)' }}
              >
                <LogOut size={16} color="#94a3b8" />
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                id="nav-login-btn"
                data-testid="nav-login-btn"
                onClick={() => openAuth('login')}
                className="btn btn-secondary"
                style={{ padding: '8px 16px', fontSize: '0.88rem' }}
              >
                Sign In
              </button>
              <button
                onClick={() => openAuth('register')}
                className="btn btn-primary"
                style={{ padding: '8px 16px', fontSize: '0.88rem' }}
              >
                Register
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
