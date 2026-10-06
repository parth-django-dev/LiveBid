import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, Zap, Shield, Trophy, AlertTriangle, 
  Clock, TrendingUp, User, Wifi, WifiOff, CheckCircle2,
  Volume2, VolumeX, Flame, Gavel 
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useAuctionSocket } from '../hooks/useAuctionSocket';
import { CountdownTimer } from '../components/CountdownTimer';
import { getBidConfig, formatCurrency } from '../utils/bidIncrements';
import { playBidChime, playGavelHit } from '../utils/audioChime';

export function AuctionArena({ itemId: propItemId, onBack: propOnBack }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const itemId = propItemId || id;
  const onBack = propOnBack || (() => navigate('/'));
  const { user, isAuthenticated, openAuth } = useAuth();

  const [item, setItem] = useState(null);
  const [bids, setBids] = useState([]);
  const [currentPrice, setCurrentPrice] = useState(0);
  const [customBid, setCustomBid] = useState('');
  const [loading, setLoading] = useState(true);
  const [errorToast, setErrorToast] = useState(null);
  const [inputError, setInputError] = useState(null);
  const [antiSnipeNotice, setAntiSnipeNotice] = useState(null);
  const [isPricePulsing, setIsPricePulsing] = useState(false);
  const [winnerDeclared, setWinnerDeclared] = useState(null);
  const [highestBidder, setHighestBidder] = useState(null);
  const [isMuted, setIsMuted] = useState(false);

  const priceRef = useRef(null);

  // Dynamic increments and minimum next bid based on price magnitude
  const { minStep, minNextBid, quickIncrements } = getBidConfig(currentPrice);

  // Fetch initial REST details
  const fetchItemDetails = useCallback(async () => {
    try {
      const data = await api.getAuctionDetails(itemId);
      setItem(data);
      setBids(data.bids_List || []);
      const price = Number(data.current_bid !== undefined ? data.current_bid : data.current_price !== undefined ? data.current_price : data.start_price);
      setCurrentPrice(price);
      setHighestBidder(data.highest_bidder || null);
      if (!data.is_active && data.winner) {
        setWinnerDeclared(data.winner);
      }
    } catch (err) {
      console.error('Failed to load auction details:', err);
      setErrorToast('Could not load auction room. Please check connection.');
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => {
    fetchItemDetails();
  }, [fetchItemDetails]);

  // Real-Time WebSocket Handlers
  const handleBidUpdate = useCallback((event) => {
    const newAmount = Number(event.amount);
    setCurrentPrice(newAmount);
    const newLeader = event.highest_bidder || event.user;
    setHighestBidder(newLeader);

    // Play bid chime
    playBidChime(isMuted);

    // Pulse animation
    setIsPricePulsing(true);
    setTimeout(() => setIsPricePulsing(false), 800);

    // Check for Anti-Snipe timer extension
    if (event.extended || event.end_time) {
      if (event.end_time) {
        setItem((prev) => (prev ? { ...prev, end_time: event.end_time } : prev));
      }
      if (event.extended) {
        setAntiSnipeNotice('⚡ Anti-Snipe: Auction extended by 60 seconds!');
        setTimeout(() => setAntiSnipeNotice(null), 7000);
      }
    }

    // Prepend to live bid feed
    setBids((prev) => [
      {
        id: Date.now(),
        user: event.user,
        amount: newAmount,
        bid_time: new Date().toISOString(),
      },
      ...prev,
    ]);

    // Clear previous errors
    setErrorToast(null);
    setInputError(null);
  }, [isMuted]);

  const handleSocketError = useCallback((errorMessage) => {
    setErrorToast(errorMessage);
    setTimeout(() => setErrorToast(null), 5000);
  }, []);

  const handleAuctionEnded = useCallback((event) => {
    const winnerName = event.winner || highestBidder;
    setWinnerDeclared(winnerName);
    setItem((prev) => (prev ? { ...prev, is_active: false, winner: winnerName } : prev));
    playGavelHit(isMuted);
  }, [highestBidder, isMuted]);

  const { isConnected, status, sendBid } = useAuctionSocket(itemId, {
    onBidUpdate: handleBidUpdate,
    onError: handleSocketError,
    onAuctionEnded: handleAuctionEnded,
  });

  // Trigger celebration confetti if winner declared
  useEffect(() => {
    if (winnerDeclared) {
      confetti({
        particleCount: 120,
        spread: 80,
        origin: { y: 0.6 },
        colors: ['#6366f1', '#10b981', '#06b6d4', '#f59e0b'],
      });
    }
  }, [winnerDeclared]);

  const isHighestBidder = Boolean(isAuthenticated && user && highestBidder && user.username === highestBidder);
  const isSeller = Boolean(isAuthenticated && user && item?.seller && user.username === item.seller);

  const handlePlaceBid = (amount) => {
    if (!isAuthenticated) {
      openAuth('login');
      return;
    }

    if (isSeller) {
      setErrorToast('You are the seller of this auction and cannot bid on your own listing.');
      return;
    }

    if (isHighestBidder) {
      setErrorToast('You are currently the highest bidder on this item. You cannot outbid yourself!');
      return;
    }

    if (!isConnected) {
      setErrorToast('Reconnecting to live auction server...');
      return;
    }

    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount < minNextBid) {
      setInputError(`Bid must be at least ₹${minNextBid.toLocaleString('en-IN')} (minimum increment ₹${minStep.toLocaleString('en-IN')}).`);
      return;
    }

    const success = sendBid(numAmount);
    if (success) {
      setCustomBid('');
      setInputError(null);
    }
  };

  const handleSubmitCustomBid = (e) => {
    e.preventDefault();
    if (!customBid) {
      setInputError(`Please enter a bid amount (minimum ₹${minNextBid.toLocaleString('en-IN')}).`);
      return;
    }

    const numAmount = Number(customBid);
    if (isNaN(numAmount) || numAmount < minNextBid) {
      setInputError(`Bid must be at least ₹${minNextBid.toLocaleString('en-IN')} (minimum increment ₹${minStep.toLocaleString('en-IN')}).`);
      return;
    }

    setInputError(null);
    handlePlaceBid(numAmount);
  };

  if (loading) {
    return (
      <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '100px 24px', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-dim)' }}>Loading Auction Arena...</p>
      </div>
    );
  }

  if (!item) {
    return (
      <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '80px 24px', textAlign: 'center' }}>
        <h2>Auction Item Not Found</h2>
        <button onClick={onBack} className="btn btn-secondary" style={{ marginTop: '20px' }}>
          <ArrowLeft size={16} /> Back to Catalog
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '24px 24px 80px' }}>
      {/* Navigation & Header Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px',
        marginBottom: '24px',
      }}>
        <button
          onClick={onBack}
          className="btn btn-secondary"
          style={{ padding: '8px 16px', fontSize: '0.9rem' }}
        >
          <ArrowLeft size={16} /> All Auctions
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Audio Mute/Unmute Toggle */}
          <button
            onClick={() => setIsMuted(!isMuted)}
            className="btn btn-secondary"
            style={{ padding: '6px 14px', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '6px' }}
            title={isMuted ? 'Unmute live bid sound effects' : 'Mute live bid sound effects'}
          >
            {isMuted ? <VolumeX size={15} color="#f87171" /> : <Volume2 size={15} color="#34d399" />}
            <span>{isMuted ? 'Sound Off' : 'Sound On'}</span>
          </button>

          {/* Real-time Connection Indicator */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 14px',
            borderRadius: 'var(--radius-full)',
            background: isConnected ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
            border: `1px solid ${isConnected ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
            fontSize: '0.82rem',
            fontWeight: '600',
            color: isConnected ? '#34d399' : '#f87171',
          }}>
            {isConnected ? (
              <>
                <Wifi size={14} /> Live Stream Connected
              </>
            ) : (
              <>
                <WifiOff size={14} /> {status === 'connecting' ? 'Connecting...' : 'Disconnected'}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Winner Banner (if finalized) */}
      {winnerDeclared && (
        <div 
          className="glass-card animate-slide-down"
          style={{
            padding: '24px',
            marginBottom: '28px',
            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(6, 182, 212, 0.15) 100%)',
            border: '1px solid rgba(16, 185, 129, 0.4)',
            boxShadow: '0 0 35px rgba(16, 185, 129, 0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '16px',
            textAlign: 'center',
          }}
        >
          <Trophy size={36} color="#34d399" />
          <div>
            <h3 style={{ fontSize: '1.4rem', color: '#6ee7b7', marginBottom: '4px' }}>
              Auction Finalized!
            </h3>
            <p style={{ color: 'var(--text-main)', fontSize: '0.95rem' }}>
              Winner: <strong>{winnerDeclared}</strong> with winning bid of <strong>₹{currentPrice.toLocaleString('en-IN')}</strong>.
            </p>
          </div>
        </div>
      )}

      {/* Anti-Snipe Notice */}
      {antiSnipeNotice && (
        <div 
          className="animate-slide-down"
          style={{
            padding: '14px 20px',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(245, 158, 11, 0.18)',
            border: '1px solid rgba(245, 158, 11, 0.45)',
            color: '#fbbf24',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontWeight: '600',
            boxShadow: '0 4px 20px rgba(245, 158, 11, 0.2)',
          }}
        >
          <Flame size={20} color="#f59e0b" />
          <span>{antiSnipeNotice}</span>
        </div>
      )}

      {/* Error Toast Notification */}
      {errorToast && (
        <div 
          className="animate-slide-down"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            padding: '14px 20px',
            background: 'rgba(239, 68, 68, 0.18)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            borderRadius: 'var(--radius-md)',
            color: '#fca5a5',
            marginBottom: '24px',
            boxShadow: '0 4px 20px rgba(239, 68, 68, 0.15)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <AlertTriangle size={18} color="#ef4444" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: '0.92rem', fontWeight: '500' }}>{errorToast}</span>
          </div>
          <button 
            onClick={() => setErrorToast(null)}
            style={{ color: '#fca5a5', fontSize: '0.8rem', textDecoration: 'underline' }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Arena Layout */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
        gap: '32px',
      }}>
        {/* Left Column: Product Showcase & Details */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Item Preview Card */}
          <div className="glass-card" style={{ padding: '32px' }}>
            {item.image && (
              <div style={{
                position: 'relative',
                width: '100%',
                height: '340px',
                borderRadius: 'var(--radius-md)',
                overflow: 'hidden',
                marginBottom: '24px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                background: 'radial-gradient(circle at center, rgba(30, 27, 75, 0.7) 0%, #0b0f19 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 1,
                }}>
                  <Gavel size={80} color="rgba(99, 102, 241, 0.35)" />
                </div>
                <img
                  src={item.image}
                  alt=""
                  aria-hidden="true"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  style={{
                    position: 'absolute',
                    inset: '-20px',
                    width: 'calc(100% + 40px)',
                    height: 'calc(100% + 40px)',
                    objectFit: 'cover',
                    filter: 'blur(24px) brightness(0.25) saturate(1.3)',
                    transform: 'scale(1.15)',
                    pointerEvents: 'none',
                    zIndex: 2,
                  }}
                />
                <img
                  src={item.image}
                  alt={item.title}
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  style={{
                    position: 'relative',
                    zIndex: 3,
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    padding: '16px',
                    filter: 'drop-shadow(0 8px 24px rgba(0, 0, 0, 0.5))',
                    transition: 'transform 0.4s ease',
                  }}
                />
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              {item.is_active && !winnerDeclared ? (
                <span className="badge-live">
                  <span className="dot" /> Live Bidding
                </span>
              ) : (
                <span className="badge-ended">
                  Auction Ended
                </span>
              )}

              {/* Countdown Component */}
              <CountdownTimer 
                endTime={item.end_time} 
                isActive={item.is_active && !winnerDeclared} 
                onExpire={() => {
                  if (!winnerDeclared) {
                    setWinnerDeclared(highestBidder || 'None');
                  }
                }}
              />
            </div>

            <h1 style={{ fontSize: '2rem', fontWeight: '800', marginBottom: '12px' }}>
              {item.title}
            </h1>

            <p style={{
              color: 'var(--text-muted)',
              fontSize: '1rem',
              lineHeight: 1.7,
              marginBottom: '24px',
            }}>
              {item.description || 'Exclusive item on the live auction block.'}
            </p>

            {/* Baseline Starting Price Info */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 20px',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid var(--border-dim)',
            }}>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-dim)' }}>
                Starting Reserve
              </span>
              <span style={{ fontSize: '1.1rem', fontWeight: '700', color: 'var(--text-muted)' }}>
                ₹{Number(item.start_price).toLocaleString('en-IN')}
              </span>
            </div>
          </div>

          {/* Real-time Bid History Ticker */}
          <div className="glass-card" style={{ padding: '24px', flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px' }}>
              <h3 style={{ fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <TrendingUp size={18} color="#6366f1" /> Live Bid Stream
              </h3>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)', fontWeight: '600' }}>
                {bids.length} {bids.length === 1 ? 'Bid' : 'Bids'} Placed
              </span>
            </div>

            <div style={{
              maxHeight: '320px',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              paddingRight: '6px',
            }}>
              {bids.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-dim)' }}>
                  No bids yet. Be the first to bid!
                </div>
              ) : (
                bids.map((b, idx) => {
                  const isLeader = Number(b.amount) === currentPrice;
                  const isMyBid = user && b.user === user.username;

                  return (
                    <div
                      key={b.id || idx}
                      className={idx === 0 ? 'animate-slide-down' : ''}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px 16px',
                        borderRadius: 'var(--radius-md)',
                        background: isLeader 
                          ? 'rgba(99, 102, 241, 0.15)' 
                          : 'rgba(255, 255, 255, 0.02)',
                        border: `1px solid ${isLeader ? 'rgba(99, 102, 241, 0.35)' : 'var(--border-dim)'}`,
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '50%',
                          background: isLeader ? 'rgba(99, 102, 241, 0.3)' : 'rgba(255, 255, 255, 0.05)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}>
                          <User size={15} color={isLeader ? '#a5b4fc' : '#64748b'} />
                        </div>
                        <div>
                          <div style={{ fontSize: '0.92rem', fontWeight: '600' }}>
                            {b.user} {isMyBid && <span style={{ fontSize: '0.72rem', color: '#818cf8' }}>(You)</span>}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                            {new Date(b.bid_time).toLocaleTimeString()}
                          </div>
                        </div>
                      </div>

                      <div style={{ textAlign: 'right' }}>
                        <div style={{
                          fontSize: '1.1rem',
                          fontWeight: '800',
                          color: isLeader ? '#34d399' : 'var(--text-main)',
                        }}>
                          ₹{Number(b.amount).toLocaleString('en-IN')}
                        </div>
                        {isLeader && (
                          <span style={{ fontSize: '0.68rem', color: '#34d399', fontWeight: '700', textTransform: 'uppercase' }}>
                            Current Leader
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Live Interactive Bidding Terminal */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Main Price Card */}
          <div 
            className={`glass-card ${isPricePulsing ? 'animate-bid-pulse' : ''}`}
            style={{
              padding: '32px',
              border: isPricePulsing ? '1px solid #10b981' : '1px solid var(--border-glow)',
              textAlign: 'center',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <span style={{
              fontSize: '0.85rem',
              color: 'var(--text-dim)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              fontWeight: '700',
              display: 'block',
              marginBottom: '8px',
            }}>
              Current Highest Bid
            </span>

            <div 
              ref={priceRef}
              style={{
                fontSize: 'clamp(2.2rem, 5vw, 3.5rem)',
                fontWeight: '900',
                letterSpacing: '-0.04em',
                color: '#34d399',
                textShadow: '0 0 30px rgba(16, 185, 129, 0.3)',
                lineHeight: 1.1,
                marginBottom: '10px',
                transition: 'transform 0.15s ease',
              }}
            >
              ₹{currentPrice.toLocaleString('en-IN')}
            </div>

            <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>
              Next min bid: <strong style={{ color: '#a5b4fc' }}>₹{minNextBid.toLocaleString('en-IN')}</strong>{' '}
              <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                (+₹{minStep.toLocaleString('en-IN')} min step)
              </span>
            </p>
          </div>

          {/* Interactive Bidding Action Box */}
          <div className="glass-card" style={{ padding: '32px' }}>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '18px' }}>
              Place Your Bid
            </h3>

            {/* Highest Bidder Leader Banner */}
            {isHighestBidder && (
              <div style={{
                padding: '14px 18px',
                borderRadius: 'var(--radius-md)',
                background: 'rgba(16, 185, 129, 0.12)',
                border: '1px solid rgba(16, 185, 129, 0.35)',
                color: '#6ee7b7',
                fontSize: '0.92rem',
                marginBottom: '20px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                lineHeight: 1.5,
              }}>
                <Trophy size={20} color="#34d399" style={{ flexShrink: 0 }} />
                <span>
                  <strong>You are currently leading!</strong> You cannot outbid yourself.
                </span>
              </div>
            )}

            {/* Seller Shill Protection Banner */}
            {isSeller && (
              <div style={{
                padding: '14px 18px',
                borderRadius: 'var(--radius-md)',
                background: 'rgba(245, 158, 11, 0.12)',
                border: '1px solid rgba(245, 158, 11, 0.35)',
                color: '#fbbf24',
                fontSize: '0.92rem',
                marginBottom: '20px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                lineHeight: 1.5,
              }}>
                <Shield size={20} color="#f59e0b" style={{ flexShrink: 0 }} />
                <span>
                  <strong>You listed this item.</strong> Shill bidding is prohibited, so bidding is disabled on your own listings.
                </span>
              </div>
            )}

            {/* Dynamic Quick Increments (Scale proportionally with item price) */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-dim)', fontWeight: '600', marginBottom: '8px' }}>
                Quick Increments (Scaled to Current Price)
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${quickIncrements.length}, 1fr)`, gap: '8px' }}>
                {quickIncrements.map(({ increment, targetBid, label }) => (
                  <button
                    key={increment}
                    onClick={() => handlePlaceBid(targetBid)}
                    disabled={!item.is_active || !!winnerDeclared || isHighestBidder || isSeller}
                    className="btn-quick-bid"
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '10px 6px',
                      gap: '2px',
                      opacity: (isHighestBidder || isSeller) ? 0.5 : 1,
                    }}
                    title={`Bid ₹${targetBid.toLocaleString('en-IN')}`}
                  >
                    <span style={{ fontWeight: '700', fontSize: '0.92rem' }}>{label}</span>
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)', opacity: 0.85 }}>
                      ₹{targetBid >= 10000000 
                          ? `${(targetBid / 10000000).toFixed(2)} Cr` 
                          : targetBid >= 100000 
                          ? `${(targetBid / 100000).toFixed(1)}L` 
                          : targetBid.toLocaleString('en-IN')}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Bid Amount Input Form */}
            <form noValidate onSubmit={handleSubmitCustomBid}>
              <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-dim)', fontWeight: '600', marginBottom: '8px' }}>
                Or Custom Bid Amount (₹)
              </label>
              <div style={{ display: 'flex', gap: '10px' }}>
                <input
                  type="number"
                  value={customBid}
                  onChange={(e) => {
                    setCustomBid(e.target.value);
                    if (inputError && Number(e.target.value) >= minNextBid) {
                      setInputError(null);
                    }
                  }}
                  placeholder={
                    isSeller 
                      ? "Bidding disabled for seller" 
                      : isHighestBidder 
                      ? "You are currently leading" 
                      : `Min ₹${minNextBid.toLocaleString('en-IN')}`
                  }
                  disabled={!item.is_active || !!winnerDeclared || isHighestBidder || isSeller}
                  className="input-glass"
                  style={{
                    borderColor: inputError ? 'rgba(239, 68, 68, 0.8)' : undefined,
                    boxShadow: inputError ? '0 0 12px rgba(239, 68, 68, 0.3)' : undefined,
                  }}
                />
              </div>

              {/* Custom In-Arena Glowing Error Feedback (Replacing ugly browser tooltip) */}
              {inputError && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginTop: '10px',
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-md)',
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  color: '#fca5a5',
                  fontSize: '0.85rem',
                  fontWeight: '500',
                  boxShadow: '0 4px 15px rgba(239, 68, 68, 0.2)',
                }}>
                  <AlertTriangle size={16} color="#ef4444" style={{ flexShrink: 0 }} />
                  <span>{inputError}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={!item.is_active || !!winnerDeclared || isHighestBidder || isSeller}
                className="btn btn-primary"
                style={{
                  width: '100%',
                  padding: '14px',
                  fontSize: '1.05rem',
                  letterSpacing: '0.02em',
                  marginTop: '16px',
                  opacity: (isHighestBidder || isSeller) ? 0.6 : 1,
                  cursor: (isHighestBidder || isSeller) ? 'not-allowed' : 'pointer',
                }}
              >
                <Zap size={20} fill="#ffffff" />
                {isSeller
                  ? 'Seller Cannot Bid on Own Item'
                  : isHighestBidder
                  ? 'You Are Currently The Leader'
                  : item.is_active && !winnerDeclared
                  ? `Submit Bid of ₹${customBid ? Number(customBid).toLocaleString('en-IN') : minNextBid.toLocaleString('en-IN')}`
                  : 'Bidding Closed'}
              </button>
            </form>

            {/* Security Guarantee Notice */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginTop: '20px',
              paddingTop: '16px',
              borderTop: '1px solid var(--border-dim)',
              fontSize: '0.78rem',
              color: 'var(--text-dim)',
            }}>
              <Shield size={16} color="#818cf8" style={{ flexShrink: 0 }} />
              <span>
                Protected by atomic Redis Lua synchronization & anti-sniping soft close.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
