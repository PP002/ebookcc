import { useState, useEffect } from 'react';

/**
 * Detects whether the current device is a mobile device (phone or tablet)
 * regardless of portrait or landscape orientation.
 */
export function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;

  // 1. User agent check for mobile phones and tablets
  const ua = navigator.userAgent || '';
  if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|Silk|Kindle/i.test(ua)) {
    return true;
  }

  // 2. Primary coarse pointer (touchscreens)
  if (window.matchMedia('(pointer: coarse)').matches) {
    if (Math.min(window.screen.width, window.screen.height) <= 1024 || Math.min(window.innerWidth, window.innerHeight) <= 1024) {
      return true;
    }
  }

  // 3. Touch capabilities with mobile screen dimensions
  if (navigator.maxTouchPoints > 0 && Math.min(window.screen.width, window.screen.height) <= 900) {
    return true;
  }

  // 4. Viewport shortest dimension <= 600px (e.g., mobile phone in landscape: 844x390, 896x414)
  if (Math.min(window.innerWidth, window.innerHeight) <= 600) {
    return true;
  }

  return false;
}

export function useIsMobileDevice(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => isMobileDevice());

  useEffect(() => {
    const handleCheck = () => {
      setIsMobile(isMobileDevice());
    };
    handleCheck();
    window.addEventListener('resize', handleCheck);
    window.addEventListener('orientationchange', handleCheck);
    const mqlCoarse = window.matchMedia('(pointer: coarse)');
    mqlCoarse.addEventListener?.('change', handleCheck);
    return () => {
      window.removeEventListener('resize', handleCheck);
      window.removeEventListener('orientationchange', handleCheck);
      mqlCoarse.removeEventListener?.('change', handleCheck);
    };
  }, []);

  return isMobile;
}
