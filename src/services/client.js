import axios from 'axios';
import { io } from 'socket.io-client';
import { API_BASE_URL, SOCKET_URL } from '../config';

const TOKEN_KEY = 'noughtline_access_token';
const LEGACY_TOKEN_KEY = 'plaything_access_token';

function getStoredToken() {
  const current = localStorage.getItem(TOKEN_KEY);
  if (current) return current;

  const legacy = localStorage.getItem(LEGACY_TOKEN_KEY);
  if (legacy) {
    localStorage.setItem(TOKEN_KEY, legacy);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  }
  return legacy;
}

export const api = axios.create({ baseURL: API_BASE_URL, timeout: 10000 });

api.interceptors.request.use((request) => {
  const token = getStoredToken();
  if (token) request.headers.Authorization = `Bearer ${token}`;
  return request;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(LEGACY_TOKEN_KEY);
    }
    return Promise.reject(error);
  },
);

let socket;

export function getSocket() {
  if (!socket) {
    socket = io(SOCKET_URL, {
      autoConnect: false,
      transports: ['websocket', 'polling'],
    });
  }
  return socket;
}

export async function ensureSession() {
  const existing = getStoredToken();
  if (existing) {
    try {
      const { data: user } = await api.get('/api/me');
      const activeSocket = getSocket();
      activeSocket.auth = { token: existing };
      if (!activeSocket.connected) activeSocket.connect();
      return { token: existing, user };
    } catch {
      localStorage.removeItem(TOKEN_KEY);
    }
  }

  const { data } = await api.post('/api/auth/guest');
  localStorage.setItem(TOKEN_KEY, data.token);
  const activeSocket = getSocket();
  activeSocket.auth = { token: data.token };
  if (!activeSocket.connected) activeSocket.connect();
  return data;
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(LEGACY_TOKEN_KEY);
  if (socket) socket.disconnect();
}

/**
 * Swap the local session to a different account's token without bootstrapping
 * a guest. Used when Google account linking returns switched:true: the server
 * revoked the current (fresh) guest and issued the already-linked account's
 * token, so the app must adopt it and reconnect the socket under the new
 * identity. Mirrors the token/socket handling in ensureSession().
 */
export function adoptSessionToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.removeItem(LEGACY_TOKEN_KEY);
  const activeSocket = getSocket();
  if (activeSocket.connected) activeSocket.disconnect();
  activeSocket.auth = { token };
  if (!activeSocket.connected) activeSocket.connect();
}

export async function logoutSession() {
  try {
    // Revoke the current session server-side (bearer token auto-attached).
    await api.post('/api/auth/logout');
  } catch {
    // Best effort: if the server is unreachable or the token is already
    // revoked, still abandon the local session below so the app can continue
    // as a fresh guest.
  } finally {
    clearSession();
  }
}
