// API Client with automatic CSRF token injection and credentials support

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export function getFullUrl(endpoint) {
  if (!endpoint) return '';
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    return endpoint;
  }
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${API_BASE}${cleanEndpoint}`;
}

export function getImageUrl(path) {
  if (!path) return null;
  return getFullUrl(path);
}

let cachedCsrfToken = null;

export async function getCsrfToken() {
  if (cachedCsrfToken) return cachedCsrfToken;
  try {
    const res = await fetch(getFullUrl('/api/csrf-token/'), { credentials: 'include' });
    const data = await res.json();
    cachedCsrfToken = data.csrfToken;
    return cachedCsrfToken;
  } catch (err) {
    console.warn('Failed to fetch CSRF token:', err);
    return null;
  }
}

export async function apiRequest(endpoint, options = {}) {
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers || {}),
  };

  // Attach CSRF token on modifying HTTP methods
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes((options.method || 'GET').toUpperCase())) {
    const token = await getCsrfToken();
    if (token) {
      headers['X-CSRFToken'] = token;
    }
  }

  const response = await fetch(getFullUrl(endpoint), {
    credentials: 'include',
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || data.message || `Request failed with status ${response.status}`);
  }

  return data;
}

// REST Endpoints
export const api = {
  // Auctions
  getActiveAuctions: () => apiRequest('/api/active-auctions/'),
  getAuctionDetails: (id) => apiRequest(`/api/auction/${id}/`),
  createAuction: (formData) =>
    apiRequest('/api/create-auction/', {
      method: 'POST',
      body: formData,
    }),

  // User Dashboard & Listings
  getMyBids: () => apiRequest('/api/my-bids/'),
  getMyListings: () => apiRequest('/api/my-listings/'),

  // Authentication
  login: (username, password) =>
    apiRequest('/api/login/', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  register: (username, email, password) =>
    apiRequest('/api/register/', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    }),

  logout: () =>
    apiRequest('/api/logout/', {
      method: 'POST',
    }),

  getCurrentUser: () => apiRequest('/api/user/'),
};
