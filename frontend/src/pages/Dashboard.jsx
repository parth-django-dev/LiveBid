import React, { useState, useEffect } from 'react';
import { Gavel, Trophy, ArrowRight, Clock, AlertCircle, RefreshCw, Sparkles, CheckCircle2, ShieldAlert } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { CountdownTimer } from '../components/CountdownTimer';

export function Dashboard({ onSelectAuction, onOpenCreateModal }) {
  const { user, isAuthenticated, openAuth } = useAuth();
  const [activeTab, setActiveTab] = useState('bids'); // 'bids' | 'listings'
  const [bidFilter, setBidFilter] = useState('all'); // 'all' | 'leading' | 'outbid' | 'won'
  const [bids, setBids] = useState([]);
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchDashboardData = async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    setError(null);
    try {
      const [bidsRes, listingsRes] = await Promise.all([
        api.getMyBids().catch(() => ({ bids: [] })),
        api.getMyListings().catch(() => ({ listings: [] })),
      ]);
      setBids(bidsRes.bids || []);
      setListings(listingsRes.listings || []);
    } catch (err) {
      setError('Failed to load your bidding activity.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, [isAuthenticated]);

  if (!isAuthenticated) {
    return (
      <div style={{ maxWidth: '640px', margin: '80px auto', padding: '40px 24px', textAlign: 'center' }}>
        <div className="glass-card" style={{ padding: '48px 32px' }}>
          <ShieldAlert size={56} color="#818cf8" style={{ marginBottom: '16px' }} />
          <h2 style={{ fontSize: '1.8rem', marginBottom: '12px' }}>Authentication Required</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: '28px', lineHeight: 1.6 }}>
            Please log in to track the auctions you have participated in, monitor your active bids, and manage your listings.
          </p>
          <button onClick={() => openAuth('login')} className="btn btn-primary" style={{ padding: '12px 28px' }}>
            Log In to Your Dashboard
          </button>
        </div>
      </div>
    );
  }

  const filteredBids = bids.filter((b) => {
    if (bidFilter === 'leading') return b.is_live && b.is_leading;
    if (bidFilter === 'outbid') return b.is_live && !b.is_leading;
    if (bidFilter === 'won') return b.is_winner;
    return true;
  });

  const itemsToDisplay = activeTab === 'bids' ? filteredBids : listings;

  return (
    <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '32px 24px 80px' }}>
      {/* Header & Stats Banner */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '20px',
        marginBottom: '32px',
        paddingBottom: '24px',
        borderBottom: '1px solid var(--border-dim)',
      }}>
        <div>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '4px 12px',
            borderRadius: 'var(--radius-full)',
            background: 'rgba(99, 102, 241, 0.12)',
            border: '1px solid rgba(99, 102, 241, 0.3)',
            color: '#a5b4fc',
            fontSize: '0.8rem',
            fontWeight: '600',
            marginBottom: '8px',
          }}>
            <Trophy size={14} color="#818cf8" />
            <span>Personal Bidding Center</span>
          </div>
          <h1 style={{ fontSize: '2.2rem', lineHeight: 1.2 }}>
            Welcome back, <span className="text-gradient-accent">{user?.username}</span>
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', marginTop: '4px' }}>
            Monitor your live bids, winning positions, and listed items in real time.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={fetchDashboardData}
            className="btn btn-secondary"
            style={{ padding: '10px 16px', fontSize: '0.9rem' }}
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button
            onClick={onOpenCreateModal}
            className="btn btn-primary"
            style={{ padding: '10px 18px', fontSize: '0.9rem' }}
          >
            <Gavel size={16} /> + List New Item
          </button>
        </div>
      </div>

      {/* Main Tabs */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '16px', marginBottom: '32px' }}>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={() => { setActiveTab('bids'); setBidFilter('all'); }}
            className={`btn ${activeTab === 'bids' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ padding: '10px 20px', fontSize: '0.92rem' }}
          >
            Items You Bid On ({bids.length})
          </button>
          <button
            onClick={() => setActiveTab('listings')}
            className={`btn ${activeTab === 'listings' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ padding: '10px 20px', fontSize: '0.92rem' }}
          >
            Your Listings ({listings.length})
          </button>
        </div>

        {/* Sub-status Filter Pills (when in Bids tab) */}
        {activeTab === 'bids' && bids.length > 0 && (
          <div style={{
            display: 'flex',
            background: 'rgba(255, 255, 255, 0.04)',
            padding: '4px',
            borderRadius: 'var(--radius-full)',
            border: '1px solid var(--border-dim)',
          }}>
            {[
              { id: 'all', label: `All (${bids.length})` },
              { id: 'leading', label: `Leading (${bids.filter((b) => b.is_live && b.is_leading).length})` },
              { id: 'outbid', label: `Outbid (${bids.filter((b) => b.is_live && !b.is_leading).length})` },
              { id: 'won', label: `Won (${bids.filter((b) => b.is_winner).length})` },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setBidFilter(f.id)}
                style={{
                  background: bidFilter === f.id ? 'var(--primary)' : 'transparent',
                  color: bidFilter === f.id ? '#ffffff' : 'var(--text-dim)',
                  border: 'none',
                  padding: '5px 12px',
                  borderRadius: 'var(--radius-full)',
                  fontSize: '0.8rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content Area */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '80px 20px', color: 'var(--text-dim)' }}>
          <RefreshCw size={32} className="animate-spin" style={{ marginBottom: '16px' }} />
          <p>Loading your activity...</p>
        </div>
      ) : error ? (
        <div style={{
          padding: '24px',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.25)',
          borderRadius: 'var(--radius-lg)',
          color: '#fca5a5',
          textAlign: 'center',
        }}>
          {error}
        </div>
      ) : itemsToDisplay.length === 0 ? (
        <div className="glass-card" style={{ textAlign: 'center', padding: '60px 24px' }}>
          <Gavel size={48} color="var(--text-dim)" style={{ marginBottom: '16px' }} />
          <h3 style={{ fontSize: '1.3rem', marginBottom: '8px' }}>
            {activeTab === 'bids' ? "You Haven't Placed Any Bids Yet" : 'No Items Listed by You'}
          </h3>
          <p style={{ color: 'var(--text-muted)', maxWidth: '480px', margin: '0 auto 24px', fontSize: '0.95rem' }}>
            {activeTab === 'bids'
              ? 'Explore our active live auction rooms and enter your first competitive bid to track it here.'
              : 'Have something valuable to auction? List your item and watch live buyers compete in real time.'}
          </p>
          {activeTab === 'bids' ? (
            <button onClick={() => onSelectAuction(null)} className="btn btn-primary" style={{ padding: '10px 24px' }}>
              Explore Live Auctions
            </button>
          ) : (
            <button onClick={onOpenCreateModal} className="btn btn-primary" style={{ padding: '10px 24px' }}>
              + List an Item Now
            </button>
          )}
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
          gap: '24px',
        }}>
          {itemsToDisplay.map((item) => {
            const isLive = Boolean(item.is_live);
            const isMyBidLeading = activeTab === 'bids' && item.is_leading;
            const didIWin = activeTab === 'bids' && item.is_winner;

            return (
              <div
                key={item.id}
                className="glass-card"
                onClick={() => onSelectAuction(item.id)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  cursor: 'pointer',
                  overflow: 'hidden',
                  border: isMyBidLeading 
                    ? '1px solid rgba(16, 185, 129, 0.4)'
                    : didIWin
                    ? '1px solid rgba(99, 102, 241, 0.5)'
                    : '1px solid var(--border-glow)',
                  transition: 'all 0.25s ease',
                }}
              >
                {/* Card Image Banner with Status Overlay */}
                <div style={{
                  height: '200px',
                  background: 'linear-gradient(135deg, #1e1b4b 0%, #0b0f19 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative',
                  overflow: 'hidden',
                }}>
                  {/* Status Badges Header */}
                  <div style={{
                    position: 'absolute',
                    top: '12px',
                    left: '12px',
                    right: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                    zIndex: 10,
                    pointerEvents: 'none',
                  }}>
                    <div style={{ pointerEvents: 'auto' }}>
                      {isLive ? (
                        <span className="badge-live">
                          <span className="dot" /> LIVE
                        </span>
                      ) : (
                        <span className="badge-ended">ENDED</span>
                      )}
                    </div>

                    <div style={{ pointerEvents: 'auto', maxWidth: '65%' }}>
                      {isLive ? (
                        <CountdownTimer endTime={item.end_time} compact />
                      ) : didIWin ? (
                        <span style={{
                          padding: '5px 12px',
                          borderRadius: 'var(--radius-full)',
                          background: 'rgba(15, 23, 42, 0.75)',
                          backdropFilter: 'blur(10px)',
                          WebkitBackdropFilter: 'blur(10px)',
                          border: '1px solid #10b981',
                          color: '#34d399',
                          fontSize: '0.78rem',
                          fontWeight: '700',
                          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
                        }}>
                          🏆 WON
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {item.image ? (
                    <>
                      <img
                        src={item.image}
                        alt={item.title}
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        className="card-banner-img"
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          objectPosition: 'center',
                          transition: 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
                        }}
                      />
                      {/* Top & Bottom Scrim Gradients */}
                      <div style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        height: '75px',
                        background: 'linear-gradient(180deg, rgba(11, 15, 25, 0.8) 0%, rgba(11, 15, 25, 0.25) 50%, transparent 100%)',
                        zIndex: 3,
                        pointerEvents: 'none',
                      }} />
                      <div style={{
                        position: 'absolute',
                        bottom: 0,
                        left: 0,
                        right: 0,
                        height: '60px',
                        background: 'linear-gradient(0deg, rgba(11, 15, 25, 0.85) 0%, transparent 100%)',
                        zIndex: 3,
                        pointerEvents: 'none',
                      }} />
                    </>
                  ) : (
                    <div style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'radial-gradient(circle at center, rgba(30, 27, 75, 0.7) 0%, #0b0f19 100%)',
                      zIndex: 1,
                    }}>
                      <Gavel size={64} color="rgba(99, 102, 241, 0.3)" />
                    </div>
                  )}
                </div>

                {/* Card Body */}
                <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', flex: 1 }}>
                  <h3 style={{ fontSize: '1.25rem', marginBottom: '8px', lineHeight: 1.3 }}>
                    {item.title}
                  </h3>
                  <p style={{
                    fontSize: '0.88rem',
                    color: 'var(--text-muted)',
                    marginBottom: '16px',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    lineHeight: 1.5,
                  }}>
                    {item.description || 'Exclusive item.'}
                  </p>

                  {/* Pricing & Leader Details Box */}
                  <div style={{
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-md)',
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid var(--border-dim)',
                    marginBottom: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}>
                    {/* Current Highest Bid */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: '600' }}>
                        Current Bid
                      </span>
                      <span style={{ fontSize: '1.25rem', fontWeight: '800', color: '#34d399' }}>
                        ₹{Number(item.current_bid || item.start_price).toLocaleString()}
                      </span>
                    </div>

                    {/* Highest Bidder */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                      <span style={{ color: 'var(--text-dim)' }}>Highest Bidder:</span>
                      <span style={{
                        fontWeight: '700',
                        color: item.highest_bidder === user?.username ? '#34d399' : '#a5b4fc',
                      }}>
                        {item.highest_bidder ? (
                          item.highest_bidder === user?.username ? 'You (Current Leader)' : item.highest_bidder
                        ) : (
                          'No bids yet'
                        )}
                      </span>
                    </div>

                    {/* Your Bid (in My Bids tab) */}
                    {activeTab === 'bids' && item.my_highest_bid > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.85rem', paddingTop: '4px', borderTop: '1px dashed var(--border-dim)' }}>
                        <span style={{ color: 'var(--text-dim)' }}>Your Bid:</span>
                        <span style={{ fontWeight: '700', color: 'var(--text-main)' }}>
                          ₹{Number(item.my_highest_bid).toLocaleString()}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Personal Position Banner */}
                  {activeTab === 'bids' && (
                    <div style={{ marginBottom: '14px' }}>
                      {isLive ? (
                        isMyBidLeading ? (
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            color: '#34d399',
                            fontSize: '0.82rem',
                            fontWeight: '600',
                          }}>
                            <CheckCircle2 size={15} /> You are currently leading the bidding!
                          </div>
                        ) : (
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            color: '#f59e0b',
                            fontSize: '0.82rem',
                            fontWeight: '600',
                          }}>
                            <AlertCircle size={15} /> You have been outbid! Enter to raise.
                          </div>
                        )
                      ) : (
                        didIWin ? (
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            color: '#34d399',
                            fontSize: '0.82rem',
                            fontWeight: '600',
                          }}>
                            <Trophy size={15} /> Congratulations! You won this auction.
                          </div>
                        ) : (
                          <div style={{
                            color: 'var(--text-dim)',
                            fontSize: '0.82rem',
                          }}>
                            Auction finalized. Winner: <strong>{item.highest_bidder || 'None'}</strong>
                          </div>
                        )
                      )}
                    </div>
                  )}

                  {/* Action Button */}
                  <div style={{ marginTop: 'auto' }}>
                    <button
                      className="btn btn-secondary"
                      style={{
                        width: '100%',
                        padding: '10px',
                        fontSize: '0.9rem',
                        justifyContent: 'center',
                      }}
                    >
                      {isLive ? 'Enter Live Arena' : 'View Auction Details'} <ArrowRight size={15} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
