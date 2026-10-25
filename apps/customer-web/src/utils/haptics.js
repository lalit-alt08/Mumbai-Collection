/**
 * Native micro-haptic feedback utility for mobile browsers and PWAs.
 * Safe fallback for browsers/platforms without Vibration API support (e.g. iOS Safari).
 * 
 * @param {'selection' | 'light' | 'medium' | 'heavy' | 'success' | 'warning' | number} type 
 */
export const triggerHaptic = (type = 'selection') => {
  if (typeof window === 'undefined' || !('vibrate' in navigator)) {
    return;
  }

  try {
    if (typeof type === 'number') {
      navigator.vibrate(type);
      return;
    }

    switch (type) {
      case 'selection': // Crisp, ultra-soft tick for tab navigation & toggle selections
        navigator.vibrate(10);
        break;
      case 'light': // Gentle tap for general interactive buttons
        navigator.vibrate(15);
        break;
      case 'medium': // Affirmative pulse for Add to Cart & primary actions
        navigator.vibrate(24);
        break;
      case 'heavy': // Distinct punch for remove / cancel actions
        navigator.vibrate(40);
        break;
      case 'success': // Subtle double-tick pattern on success
        navigator.vibrate([12, 45, 18]);
        break;
      case 'warning': // Error / validation notification pattern
        navigator.vibrate([25, 50, 25]);
        break;
      default:
        navigator.vibrate(10);
    }
  } catch {
    // Fail silently without interrupting UI gestures
  }
};
