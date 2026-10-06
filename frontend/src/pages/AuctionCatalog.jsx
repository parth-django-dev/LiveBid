import React, { useState, useEffect } from 'react';
import { Flame, ArrowRight, Gavel, Sparkles, RefreshCw, Plus, Trophy, Search, X } from 'lucide-react';
import { api } from '../api/client';
import { CountdownTimer } from '../components/CountdownTimer';

export function AuctionCatalog({ onSelectAuction, onOpenCreateModal }) {
  const [auctions, setAuctions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all'); // 'all' | 'live' | 'ended'
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');

  const CATEGORIES = ['All', 'Watches', 'Electronics', 'Vehicles', 'Art & Antiques', 'Collectibles'];

  const fetchAuctions = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getActiveAuctions();
      setAuctions(data.AuctionList || []);
    } catch (err) {
      setError('Unable to load active auctions. Ensure Daphne server is running.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAuctions();
  }, []);

  const checkIsLive = (item) => {
    if (!item) return false;
    if (item.is_live !== undefined) return Boolean(item.is_live);
    return Boolean(item.is_active && new Date(item.end_time) > new Date());
  };

  const filteredAuctions = auctions.filter((item) => {
    const isLive = checkIsLive(item);
    if (filter === 'live' && !isLive) return false;
    if (filter === 'ended' && isLive) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = item.title?.toLowerCase().includes(q);
      const matchDesc = item.description?.toLowerCase().includes(q);
      if (!matchTitle && !matchDesc) return false;
    }

    if (selectedCategory !== 'All') {
      const cat = selectedCategory.toLowerCase();
      const text = `${item.title || ''} ${item.description || ''}`.toLowerCase();
      const parts = cat.split('&').map((p) => p.trim());
      const hasMatch = parts.some((p) => text.includes(p));
      if (!hasMatch) return false;
    }

    return true;
  });

  const featured = auctions[0] || null;
  const isFeaturedLive = checkIsLive(featured);

  return (
    <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '40px 24px 80px' }}>
      {/* Hero Section */}
      <div style={{
        textAlign: 'center',
        marginBottom: '48px',
        position: 'relative',
      }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 14px',
          borderRadius: 'var(--radius-full)',
          background: 'rgba(99, 102, 241, 0.12)',
          border: '1px solid rgba(99, 102, 241, 0.3)',
          color: '#a5b4fc',
          fontSize: '0.85rem',
          fontWeight: '600',
          marginBottom: '20px',
        }}>
          <Sparkles size={16} color="#818cf8" />
          <span>Next-Gen High Concurrency Live Bidding</span>
        </div>

        <h1 style={{
          fontSize: 'clamp(2.5rem, 5vw, 4rem)',
          fontWeight: '900',
          lineHeight: 1.1,
          marginBottom: '16px',
        }}>
          The Real-Time <span className="text-gradient-accent">Live Auction Arena</span>
        </h1>
        <p style={{
          fontSize: '1.15rem',
          color: 'var(--text-muted)',
          maxWidth: '640px',
          margin: '0 auto 28px',
        }}>
          Bid competitively against hundreds of live participants with sub-millisecond price synchronization powered by Django Channels and atomic Redis.
        </p>

        {/* Hero Action CTA */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '14px' }}>
          <button
            onClick={onOpenCreateModal}
            className="btn btn-primary"
            style={{ padding: '12px 24px', fontSize: '0.98rem' }}
          >
            <Plus size={18} /> List An Auction Item
          </button>
        </div>
      </div>

      {/* Featured Banner (if available) */}
      {featured && (
        <div 
          className="glass-card"
          onClick={() => onSelectAuction(featured.id)}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: '32px',
            padding: '32px',
            marginBottom: '48px',
            cursor: 'pointer',
            border: isFeaturedLive ? '1px solid rgba(99, 102, 241, 0.4)' : '1px solid var(--border-dim)',
            boxShadow: isFeaturedLive ? '0 0 35px rgba(99, 102, 241, 0.15)' : 'none',
          }}
        >
          {/* Featured Image Thumbnail */}
          <div style={{
            height: '320px',
            borderRadius: 'var(--radius-md)',
            background: 'linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            position: 'relative',
            border: '1px solid rgba(255, 255, 255, 0.08)',
          }}>
            {/* Strictly One Badge */}
            <div style={{
              position: 'absolute',
              top: '16px',
              left: '16px',
              zIndex: 2,
            }}>
              {isFeaturedLive ? (
                <span className="badge-live">
                  <span className="dot" /> Featured Live
                </span>
              ) : (
                <span className="badge-ended">
                  Auction Ended
                </span>
              )}
            </div>

            <div style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1,
            }}>
              <Gavel size={96} color="rgba(99, 102, 241, 0.35)" />
            </div>

            {featured.image && (
              <>
                <img
                  src={featured.image}
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
                  src={featured.image}
                  alt={featured.title}
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
              </>
            )}
          </div>

          {/* Featured Details */}
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
              {isFeaturedLive ? (
                <CountdownTimer endTime={featured.end_time} />
              ) : (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  color: 'var(--text-dim)',
                  fontSize: '0.9rem',
                  fontWeight: '600',
                }}>
                  <Trophy size={16} color="#34d399" />
                  <span>Auction Finalized {featured.winner ? `• Winner: ${featured.winner}` : ''}</span>
                </div>
              )}
            </div>

            <h2 style={{ fontSize: '2rem', marginBottom: '12px', lineHeight: 1.2 }}>
              {featured.title}
            </h2>
            <p style={{ fontSize: '1rem', color: 'var(--text-muted)', marginBottom: '24px', lineHeight: 1.6 }}>
              {featured.description || 'High-value auction item on the live bidding block.'}
            </p>

            <div style={{
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
              paddingTop: '20px',
              borderTop: '1px solid var(--border-dim)',
            }}>
              <div>
                <span style={{ display: 'block', fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--text-dim)', fontWeight: '600', letterSpacing: '0.05em' }}>
                  Current Highest Bid
                </span>
                <span style={{ fontSize: '2.2rem', fontWeight: '900', color: '#34d399', letterSpacing: '-0.03em' }}>
                  ₹{Number(featured.current_bid || featured.start_price).toLocaleString()}
                </span>
                <span style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Highest Bidder: <strong style={{ color: '#a5b4fc' }}>{featured.highest_bidder || 'No bids yet'}</strong>
                </span>
              </div>

              <button className="btn btn-primary" style={{ padding: '12px 24px', fontSize: '1rem' }}>
                {isFeaturedLive ? 'Enter Arena' : 'View Details'} <ArrowRight size={18} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Catalog Filter & Header Toolbar */}
      <div style={{ marginBottom: '32px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
        }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '16px' }}>
            <h2 style={{ fontSize: '1.5rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Flame size={22} color="#f97316" /> Auction Catalog
            </h2>

            {/* Status Filter Pills */}
            <div style={{
              display: 'flex',
              background: 'rgba(255, 255, 255, 0.04)',
              padding: '4px',
              borderRadius: 'var(--radius-full)',
              border: '1px solid var(--border-dim)',
            }}>
              {[
                { id: 'all', label: `All (${auctions.length})` },
                { id: 'live', label: `Live (${auctions.filter(checkIsLive).length})` },
                { id: 'ended', label: `Ended (${auctions.filter((a) => !checkIsLive(a)).length})` },
              ].map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  style={{
                    background: filter === f.id ? 'var(--primary)' : 'transparent',
                    color: filter === f.id ? '#ffffff' : 'var(--text-dim)',
                    border: 'none',
                    padding: '6px 14px',
                    borderRadius: 'var(--radius-full)',
                    fontSize: '0.82rem',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* Search Input */}
            <div style={{ position: 'relative', width: '220px' }}>
              <Search size={15} color="var(--text-dim)" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search auctions..."
                className="input-glass"
                style={{
                  width: '100%',
                  padding: '7px 30px 7px 34px',
                  fontSize: '0.85rem',
                  borderRadius: 'var(--radius-full)',
                }}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }}
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <button
              onClick={fetchAuctions}
              className="btn btn-secondary"
              style={{ padding: '8px 14px', fontSize: '0.85rem' }}
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button
              onClick={onOpenCreateModal}
              className="btn btn-primary"
              style={{ padding: '8px 16px', fontSize: '0.85rem' }}
            >
              <Plus size={15} /> + List Item
            </button>
          </div>
        </div>

        {/* Category Pills Bar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          overflowX: 'auto',
          paddingBottom: '4px',
        }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)', fontWeight: '600', marginRight: '4px', whiteSpace: 'nowrap' }}>
            Category:
          </span>
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              style={{
                background: selectedCategory === cat ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.03)',
                color: selectedCategory === cat ? '#a5b4fc' : 'var(--text-dim)',
                border: `1px solid ${selectedCategory === cat ? 'rgba(99, 102, 241, 0.5)' : 'var(--border-dim)'}`,
                padding: '5px 12px',
                borderRadius: 'var(--radius-full)',
                fontSize: '0.78rem',
                fontWeight: '600',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease',
              }}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Auction Grid */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-dim)' }}>
          Loading live auctions...
        </div>
      ) : error ? (
        <div style={{
          textAlign: 'center',
          padding: '40px',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.25)',
          borderRadius: 'var(--radius-lg)',
          color: '#fca5a5',
        }}>
          {error}
        </div>
      ) : filteredAuctions.length === 0 ? (
        <div className="glass-card" style={{ textAlign: 'center', padding: '80px 20px', color: 'var(--text-muted)' }}>
          <Gavel size={48} color="var(--text-dim)" style={{ marginBottom: '16px' }} />
          <h3 style={{ fontSize: '1.3rem', marginBottom: '8px' }}>No Auctions Matching Filter</h3>
          <p style={{ fontSize: '0.95rem', color: 'var(--text-dim)', marginBottom: '20px' }}>
            {filter === 'live' ? 'There are no active auctions right now.' : 'No auctions found.'}
          </p>
          <button onClick={onOpenCreateModal} className="btn btn-primary" style={{ padding: '10px 20px' }}>
            <Plus size={16} /> List a New Item
          </button>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: '24px',
        }}>
          {filteredAuctions.map((item) => {
            const isLive = checkIsLive(item);

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
                }}
              >
                {/* Item Card Banner */}
                <div style={{
                  height: '220px',
                  background: 'radial-gradient(circle at center, rgba(30, 27, 75, 0.7) 0%, #0b0f19 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative',
                  overflow: 'hidden',
                }}>
                  {/* Status Badges - Strictly Consistent */}
                  <div style={{ position: 'absolute', top: '12px', left: '12px', zIndex: 3 }}>
                    {isLive ? (
                      <span className="badge-live">
                        <span className="dot" /> LIVE
                      </span>
                    ) : (
                      <span className="badge-ended">
                        ENDED
                      </span>
                    )}
                  </div>

                  <div style={{ position: 'absolute', top: '12px', right: '12px', zIndex: 3 }}>
                    {isLive ? (
                      <CountdownTimer endTime={item.end_time} compact />
                    ) : (
                      <span className="badge-ended" style={{ fontSize: '0.75rem' }}>
                        {item.winner ? `Won by ${item.winner}` : 'Finalized'}
                      </span>
                    )}
                  </div>

                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 1,
                  }}>
                    <Gavel size={56} color="rgba(99, 102, 241, 0.3)" />
                  </div>

                  {item.image && (
                    <>
                      {/* Ambient blurred backdrop so letterboxing matches item colors */}
                      <img
                        src={item.image}
                        alt=""
                        aria-hidden="true"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        style={{
                          position: 'absolute',
                          inset: '-15px',
                          width: 'calc(100% + 30px)',
                          height: 'calc(100% + 30px)',
                          objectFit: 'cover',
                          filter: 'blur(20px) brightness(0.25) saturate(1.3)',
                          transform: 'scale(1.1)',
                          pointerEvents: 'none',
                          zIndex: 2,
                        }}
                      />
                      {/* Fully visible item that fits perfectly without cropping */}
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
                          padding: '12px',
                          filter: 'drop-shadow(0 6px 16px rgba(0, 0, 0, 0.45))',
                          transition: 'transform 0.3s ease',
                        }}
                      />
                    </>
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
                    flex: 1,
                    lineHeight: 1.5,
                  }}>
                    {item.description || 'Live auction item.'}
                  </p>

                  {/* Leader and Pricing Box */}
                  <div style={{
                    padding: '12px',
                    borderRadius: 'var(--radius-md)',
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid var(--border-dim)',
                    marginBottom: '16px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: '600' }}>
                        Current Highest Bid
                      </span>
                      <span style={{ fontSize: '1.35rem', fontWeight: '800', color: '#34d399' }}>
                        ₹{Number(item.current_bid || item.start_price).toLocaleString()}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                      <span style={{ color: 'var(--text-dim)' }}>Leader:</span>
                      <span style={{ fontWeight: '700', color: item.highest_bidder ? '#a5b4fc' : 'var(--text-dim)' }}>
                        {item.highest_bidder || 'No bids yet'}
                      </span>
                    </div>
                  </div>

                  {/* Footer Action */}
                  <div style={{ marginTop: 'auto' }}>
                    <button
                      className="btn btn-primary"
                      style={{ width: '100%', padding: '10px', fontSize: '0.88rem', justifyContent: 'center' }}
                    >
                      {isLive ? 'Join Live Arena' : 'View Auction Details'} <ArrowRight size={14} />
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
