import React, { useState, useRef } from 'react';
import { X, Upload, Plus, AlertCircle, Clock, DollarSign, FileText, Image as ImageIcon } from 'lucide-react';
import { api } from '../api/client';

export function CreateAuctionModal({ isOpen, onClose, onItemCreated }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startPrice, setStartPrice] = useState('');
  const [durationHours, setDurationHours] = useState('24');
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fileInputRef = useRef(null);

  if (!isOpen) return null;

  const handleImageChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        setError('Please select an image file (JPG, PNG, WebP).');
        return;
      }
      setImageFile(file);
      setImagePreview(URL.createObjectURL(file));
      setError(null);
    }
  };

  const handleRemoveImage = () => {
    setImageFile(null);
    if (imagePreview) {
      URL.revokeObjectURL(imagePreview);
      setImagePreview(null);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError('Please provide an item title.');
      return;
    }
    if (!description.trim()) {
      setError('Please provide an item description.');
      return;
    }
    const priceNum = Number(startPrice);
    if (isNaN(priceNum) || priceNum <= 0) {
      setError('Please enter a valid starting price greater than 0.');
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('title', title.trim());
      formData.append('description', description.trim());
      formData.append('start_price', priceNum);
      formData.append('duration_hours', durationHours);
      if (imageFile) {
        formData.append('image', imageFile);
      }

      const res = await api.createAuction(formData);
      onItemCreated?.(res.item);
      onClose();
      // Reset form
      setTitle('');
      setDescription('');
      setStartPrice('');
      setDurationHours('24');
      handleRemoveImage();
    } catch (err) {
      setError(err.message || 'Failed to list item. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(5, 7, 15, 0.82)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        padding: '20px',
        overflowY: 'auto',
      }}
      onClick={onClose}
    >
      <div
        className="glass-card animate-slide-down"
        style={{
          width: '100%',
          maxWidth: '560px',
          padding: '32px',
          position: 'relative',
          maxHeight: '90vh',
          overflowY: 'auto',
          border: '1px solid rgba(99, 102, 241, 0.35)',
          boxShadow: '0 0 50px rgba(99, 102, 241, 0.2)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '20px',
            right: '20px',
            background: 'none',
            border: 'none',
            color: 'var(--text-dim)',
            cursor: 'pointer',
            padding: '4px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <X size={20} />
        </button>

        {/* Modal Header */}
        <div style={{ marginBottom: '24px' }}>
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
            marginBottom: '10px',
          }}>
            <Plus size={14} /> List New Auction Item
          </div>
          <h2 style={{ fontSize: '1.6rem', lineHeight: 1.2 }}>Start a Live Auction</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '4px' }}>
            List your item for real-time competitive bidding across the platform.
          </p>
        </div>

        {error && (
          <div
            className="animate-shake"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '12px 16px',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#fca5a5',
              fontSize: '0.88rem',
              marginBottom: '20px',
            }}
          >
            <AlertCircle size={18} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {/* Image Upload Zone */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', marginBottom: '8px' }}>
              Item Photograph
            </label>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleImageChange}
              accept="image/*"
              style={{ display: 'none' }}
            />

            {imagePreview ? (
              <div style={{
                position: 'relative',
                height: '220px',
                borderRadius: 'var(--radius-md)',
                overflow: 'hidden',
                border: '1px solid var(--border-glow)',
                background: 'radial-gradient(circle at center, rgba(30, 27, 75, 0.7) 0%, #0b0f19 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <img
                  src={imagePreview}
                  alt=""
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    inset: '-15px',
                    width: 'calc(100% + 30px)',
                    height: 'calc(100% + 30px)',
                    objectFit: 'cover',
                    filter: 'blur(20px) brightness(0.25) saturate(1.3)',
                    transform: 'scale(1.1)',
                    pointerEvents: 'none',
                  }}
                />
                <img
                  src={imagePreview}
                  alt="Preview"
                  style={{
                    position: 'relative',
                    zIndex: 2,
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    padding: '12px',
                    filter: 'drop-shadow(0 4px 14px rgba(0, 0, 0, 0.5))',
                  }}
                />
                <button
                  type="button"
                  onClick={handleRemoveImage}
                  style={{
                    position: 'absolute',
                    top: '10px',
                    right: '10px',
                    zIndex: 3,
                    background: 'rgba(0,0,0,0.7)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '50%',
                    width: '32px',
                    height: '32px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                style={{
                  height: '140px',
                  border: '2px dashed var(--border-glow)',
                  borderRadius: 'var(--radius-md)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  background: 'rgba(255, 255, 255, 0.02)',
                  transition: 'background 0.2s ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(99, 102, 241, 0.08)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)')}
              >
                <Upload size={28} color="#818cf8" />
                <span style={{ fontSize: '0.9rem', color: 'var(--text-main)', fontWeight: '600' }}>
                  Click to upload item image
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                  PNG, JPG, WebP up to 10MB
                </span>
              </div>
            )}
          </div>

          {/* Title */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', marginBottom: '8px' }}>
              Item Title *
            </label>
            <input
              type="text"
              maxLength={50}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Vintage Mechanical Chronograph"
              required
              className="input-glass"
            />
          </div>

          {/* Description */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', marginBottom: '8px' }}>
              Description *
            </label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Provide specifications, condition, authenticity, and highlights..."
              required
              className="input-glass"
              style={{ resize: 'vertical' }}
            />
          </div>

          {/* Starting Price & Duration Row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', marginBottom: '8px' }}>
                Starting Price (₹) *
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={startPrice}
                onChange={(e) => setStartPrice(e.target.value)}
                placeholder="5000"
                required
                className="input-glass"
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', marginBottom: '8px' }}>
                Auction Duration
              </label>
              <select
                value={durationHours}
                onChange={(e) => setDurationHours(e.target.value)}
                className="input-glass"
                style={{ cursor: 'pointer' }}
              >
                <option value="1">1 Hour (Flash Live)</option>
                <option value="6">6 Hours</option>
                <option value="12">12 Hours</option>
                <option value="24">24 Hours (1 Day)</option>
                <option value="48">48 Hours (2 Days)</option>
                <option value="72">72 Hours (3 Days)</option>
                <option value="168">7 Days (Standard)</option>
              </select>
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="btn btn-secondary"
              style={{ flex: 1, padding: '12px' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary"
              style={{ flex: 2, padding: '12px' }}
            >
              {loading ? 'Creating Listing...' : 'Publish Live Auction'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
