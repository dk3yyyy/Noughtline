const API_BASE_URL = import.meta.env.VITE_API_URL
  || (import.meta.env.DEV ? 'http://localhost:3000' : window.location.origin);
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || API_BASE_URL;

export { API_BASE_URL, SOCKET_URL };
