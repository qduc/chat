"use client";
import { useEffect } from 'react';

function getCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()\[\]\\\/\+^])/g, '\\$1') + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

export function SessionBootstrap() {
  useEffect(() => {
    try {
      // Only create session cookie for unauthenticated users as fallback
      // The backend now prioritizes user authentication over session cookies
      let sid = getCookie('cf_session_id');
      if (!sid) {
        // Check if user is authenticated before creating session cookie
        const token = localStorage.getItem('chatforge_auth_token');
        if (!token) {
          // Only create session for anonymous users
          sid = crypto.randomUUID();
          const expires = new Date(Date.now() + 365*24*60*60*1000).toUTCString();
          document.cookie = `cf_session_id=${encodeURIComponent(sid)}; expires=${expires}; path=/; samesite=lax`;
        }
      }
    } catch (e) {
      // ignore
    }
  }, []);
  return null;
}
