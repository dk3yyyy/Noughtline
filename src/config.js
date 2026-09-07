const API_BASE_URL = import.meta.env.VITE_API_URL
  || (import.meta.env.DEV ? 'http://localhost:3000' : window.location.origin);
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || API_BASE_URL;
// Optional Google Identity Services OAuth client id. Empty (unset) means the
// "Sign in with Google" button keeps its informational, unconfigured behavior.
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

export { API_BASE_URL, GOOGLE_CLIENT_ID, SOCKET_URL };
