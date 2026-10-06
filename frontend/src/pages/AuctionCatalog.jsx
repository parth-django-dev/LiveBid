import React, { useState, useEffect, useMemo } from 'react';
import { 
  Flame, ArrowRight, Gavel, Sparkles, RefreshCw, Plus, 
  Trophy, Search, X, Crown, ArrowUpDown, SlidersHorizontal, User 
} from 'lucide-react';
import { api } from '../api/client';
import { CountdownTimer } from '../components/CountdownTimer';

export function AuctionCatalog({ onSelectAuction, onOpenCreateModal }) {
  const [auctions, setAuctions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all'); // 'all' | 'live' | 'ended'
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('highest_bid'); // 'highest_bid' | 'lowest_bid' | 'ending_soon' | 'newest'
  const [priceRangeMax, setPriceRangeMax] = useState(null);

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

  const getItemBid = (item) => Number(item?.current_bid !== undefined ? item.current_bid : item?.start_price || 0);

  // Determine dynamic price range bounds from all fetched auctions
  const absoluteMaxPrice = useMemo(() => {
    if (!auctions || auctions.length === 0) return 50000;
    const maxVal = Math.max(...auctions.map(getItemBid), 1000);
    // Round up nicely to nearest 5,000 or 10,000 with minimum 50,000
    return Math.max(Math.ceil(maxVal / 5000) * 5000, 50000);
  }, [auctions]);

  const effectiveMaxPrice = priceRangeMax !== null ? priceRangeMax : absoluteMaxPrice;
  const priceStep = absoluteMaxPrice > 500000 ? 25000 : absoluteMaxPrice > 100000 ? 5000 : 1000;

  // Filter auctions by status, search query, and current highest bid price
  const filteredAuctions = useMemo(() => {
    return auctions.filter((item) => {
      const isLive = checkIsLive(item);
      if (filter === 'live' && !isLive) return false;
      if (filter === 'ended' && isLive) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = item.title?.toLowerCase().includes(q);
        const matchDesc = item.description?.toLowerCase().includes(q);
        const matchSeller = item.seller?.toLowerCase().includes(q);
        if (!matchTitle && !matchDesc && !matchSeller) return false;
      }

      if (priceRangeMax !== null && getItemBid(item) > priceRangeMax) {
        return false;
      }

      return true;
    });
  }, [auctions, filter, searchQuery, priceRangeMax]);

  // Sort according to selected sort criteria
  const sortedAuctions = useMemo(() => {
    const list = [...filteredAuctions];
    switch (sortBy) {
      case 'highest_bid':
        return list.sort((a, b) => getItemBid(b) - getItemBid(a));
      case 'lowest_bid':
        return list.sort((a, b) => getItemBid(a) - getItemBid(b));
      case 'ending_soon':
        return list.sort((a, b) => new Date(a.end_time).getTime() - new Date(b.end_time).getTime());
      case 'newest':
        return list.sort((a, b) => b.id - a.id);
      default:
        return list;
    }
  }, [filteredAuctions, sortBy]);

  // The card with the highest bid is the top most card (the biggest spotlight hero card)
  const topBidItem = useMemo(() => {
    if (filteredAuctions.length === 0) return null;
    return [...filteredAuctions].reduce((maxItem, curr) => {
      return getItemBid(curr) > getItemBid(maxItem) ? curr : maxItem;
    }, filteredAuctions[0]);
  }, [filteredAuctions]);

  // The grid below contains remaining cards, STRICTLY excluding the top highest bid card
  const gridAuctions = useMemo(() => {
    if (!topBidItem) return [];
    return sortedAuctions.filter((item) => item.id !== topBidItem.id);
  }, [sortedAuctions, topBidItem]);

  const isTopItemLive = topBidItem ? checkIsLive(topBidItem) : false;

  return (
    <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '40px 24px 80px' }}>
      {/* Hero Header Section */}
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

      {/* TOP MOST CARD: Highest Current Bid Hero Card */}
      {topBidItem && (
        <div style={{ marginBottom: '48px' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '14px',
            color: '#fbbf24',
            fontSize: '0.9rem',
            fontWeight: '700',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}>
            <Crown size={18} color="#f59e0b" />
            <span>Highest Bid Spotlight</span>
          </div>

          <div 
            className="glass-card"
            onClick={() => onSelectAuction(topBidItem.id)}
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: '32px',
              padding: '32px',
              cursor: 'pointer',
              border: isTopItemLive 
                ? '1px solid rgba(245, 158, 11, 0.45)' 
                : '1px solid var(--border-dim)',
              boxShadow: isTopItemLive 
                ? '0 0 40px rgba(245, 158, 11, 0.15)' 
                : 'none',
              background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.04) 0%, rgba(99, 102, 241, 0.05) 100%)',
              transition: 'transform 0.2s ease, box-shadow 0.2s ease',
            }}
          >
            {/* Top Card Image Thumbnail */}
            <div style={{
              height: '340px',
              borderRadius: 'var(--radius-md)',
              background: 'linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              position: 'relative',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}>
              {/* Badges */}
              <div style={{
                position: 'absolute',
                top: '16px',
                left: '16px',
                zIndex: 4,
                display: 'flex',
                gap: '8px',
                flexWrap: 'wrap',
              }}>
                <span className="badge-live" style={{
                  background: 'rgba(245, 158, 11, 0.25)',
                  border: '1px solid rgba(245, 158, 11, 0.6)',
                  color: '#fbbf24',
                }}>
                  <Crown size={13} color="#fbbf24" /> Top Leader
                </span>

                {isTopItemLive ? (
                  <span className="badge-live">
                    <span className="dot" /> LIVE
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

              {topBidItem.image && (
                <>
                  <img
                    src={topBidItem.image}
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
                    src={topBidItem.image}
                    alt={topBidItem.title}
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

            {/* Top Card Details */}
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                {isTopItemLive ? (
                  <CountdownTimer endTime={topBidItem.end_time} />
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
                    <span>Auction Finalized {topBidItem.winner ? `• Winner: ${topBidItem.winner}` : ''}</span>
                  </div>
                )}
              </div>

              <h2 style={{ fontSize: '2.1rem', marginBottom: '8px', lineHeight: 1.2 }}>
                {topBidItem.title}
              </h2>

              {/* Lister Display on Top Card */}
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '0.88rem',
                color: 'var(--text-dim)',
                marginBottom: '16px',
              }}>
                <User size={15} color="#818cf8" />
                <span>Listed by: <strong style={{ color: '#a5b4fc' }}>{topBidItem.seller || 'Anonymous'}</strong></span>
              </div>

              <p style={{ fontSize: '1rem', color: 'var(--text-muted)', marginBottom: '24px', lineHeight: 1.6 }}>
                {topBidItem.description || 'Top-tier high bid item currently dominating the arena.'}
              </p>

              <div style={{
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'space-between',
                paddingTop: '20px',
                borderTop: '1px solid var(--border-dim)',
                flexWrap: 'wrap',
                gap: '16px',
              }}>
                <div>
                  <span style={{ display: 'block', fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--text-dim)', fontWeight: '600', letterSpacing: '0.05em' }}>
                    Current Highest Bid
                  </span>
                  <span style={{ fontSize: '2.4rem', fontWeight: '900', color: '#34d399', letterSpacing: '-0.03em' }}>
                    ₹{getItemBid(topBidItem).toLocaleString('en-IN')}
                  </span>
                  <span style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Leading Bidder: <strong style={{ color: '#a5b4fc' }}>{topBidItem.highest_bidder || 'No bids yet'}</strong>
                  </span>
                </div>

                <button className="btn btn-primary" style={{ padding: '12px 26px', fontSize: '1rem' }}>
                  {isTopItemLive ? 'Enter Arena' : 'View Details'} <ArrowRight size={18} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Catalog Filter & Controls Toolbar */}
      <div style={{ marginBottom: '32px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
        {/* Row 1: Header + Status Filter + Search & Action Controls */}
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

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            {/* Search Input */}
            <div style={{ position: 'relative', width: '220px' }}>
              <Search size={15} color="var(--text-dim)" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search items or seller..."
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

        {/* Row 2: Sort By Dropdown & Price Range Slider (Replaces Categories) */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '16px',
          padding: '16px 20px',
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid var(--border-dim)',
          borderRadius: 'var(--radius-md)',
          alignItems: 'center',
        }}>
          {/* Sort By Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-dim)', fontSize: '0.85rem', fontWeight: '600', whiteSpace: 'nowrap' }}>
              <ArrowUpDown size={15} color="#818cf8" />
              <span>Sort by:</span>
            </div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="input-glass"
              style={{
                flex: 1,
                padding: '8px 14px',
                fontSize: '0.85rem',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                background: 'rgba(15, 23, 42, 0.85)',
                color: 'var(--text-main)',
                border: '1px solid var(--border-dim)',
              }}
            >
              <option value="highest_bid">Highest Bid (Top First)</option>
              <option value="lowest_bid">Lowest Bid First</option>
              <option value="ending_soon">Ending Soonest</option>
              <option value="newest">Recently Listed</option>
            </select>
          </div>

          {/* Price Range Slider by Current Highest Bid */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.82rem' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-dim)', fontWeight: '600' }}>
                <SlidersHorizontal size={14} color="#34d399" />
                <span>Max Highest Bid:</span>
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontWeight: '700', color: '#34d399' }}>
                  Up to ₹{effectiveMaxPrice.toLocaleString('en-IN')}
                </span>
                {priceRangeMax !== null && priceRangeMax < absoluteMaxPrice && (
                  <button
                    onClick={() => setPriceRangeMax(null)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#a5b4fc',
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                      textDecoration: 'underline',
                    }}
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>₹0</span>
              <input
                type="range"
                min="0"
                max={absoluteMaxPrice}
                step={priceStep}
                value={effectiveMaxPrice}
                onChange={(e) => setPriceRangeMax(Number(e.target.value))}
                style={{
                  flex: 1,
                  accentColor: '#6366f1',
                  cursor: 'pointer',
                  height: '6px',
                }}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                ₹{absoluteMaxPrice.toLocaleString('en-IN')}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Auction Grid (Strictly EXCLUDES the top highest bid card) */}
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
            {priceRangeMax !== null 
              ? `No auctions found with highest bid under ₹${priceRangeMax.toLocaleString('en-IN')}.`
              : filter === 'live' 
              ? 'There are no active auctions right now.' 
              : 'No auctions found matching criteria.'}
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '12px' }}>
            {priceRangeMax !== null && (
              <button 
                onClick={() => setPriceRangeMax(null)} 
                className="btn btn-secondary" 
                style={{ padding: '10px 20px' }}
              >
                Reset Price Slider
              </button>
            )}
            <button onClick={onOpenCreateModal} className="btn btn-primary" style={{ padding: '10px 20px' }}>
              <Plus size={16} /> List a New Item
            </button>
          </div>
        </div>
      ) : gridAuctions.length === 0 ? (
        <div className="glass-card" style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-dim)' }}>
          <p style={{ fontSize: '0.92rem', marginBottom: '8px' }}>
            ✨ The leading auction is spotlighted at the top above.
          </p>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-dim)' }}>
            List more items to build your multi-item catalog grid!
          </p>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: '24px',
        }}>
          {gridAuctions.map((item) => {
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
                  transition: 'transform 0.2s ease, box-shadow 0.2s ease',
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
                  {/* Status Badges */}
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
                      {/* Ambient blurred backdrop */}
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
                      {/* Fully visible item that fits perfectly */}
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
                  <h3 style={{ fontSize: '1.25rem', marginBottom: '6px', lineHeight: 1.3 }}>
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
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: '600' }}>
                        Current Highest Bid
                      </span>
                      <span style={{ fontSize: '1.35rem', fontWeight: '800', color: '#34d399' }}>
                        ₹{getItemBid(item).toLocaleString('en-IN')}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '6px' }}>
                      <span style={{ color: 'var(--text-dim)' }}>Leader:</span>
                      <span style={{ fontWeight: '700', color: item.highest_bidder ? '#a5b4fc' : 'var(--text-dim)' }}>
                        {item.highest_bidder || 'No bids yet'}
                      </span>
                    </div>

                    {/* Lister Display on Grid Card */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '0.8rem',
                      color: 'var(--text-dim)',
                      paddingTop: '6px',
                      borderTop: '1px solid rgba(255, 255, 255, 0.05)',
                    }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <User size={13} color="#818cf8" /> Listed by:
                      </span>
                      <span style={{ fontWeight: '600', color: 'var(--text-muted)' }}>
                        {item.seller || 'Anonymous'}
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
