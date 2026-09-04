import { useState, useEffect, lazy, Suspense } from 'react';
import Login from './pages/Login';
import BlockchainBackground from './components/BlockchainBackground';
import ErrorBoundary from './components/ErrorBoundary';
import { LanguageProvider } from './lib/i18n';
import { getStoredAuth } from './lib/auth';
import { startOrderProcessing } from './services/orderProcessor';
import { useDeviceOptimization } from './lib/useDeviceOptimization';
import { useResponsive, applyResponsiveMeta } from './lib/useResponsive';
import type { AuthState } from './types';

const EmployeeDashboard = lazy(() => import('./components/employee/EmployeeDashboard'));
const AdminDashboard = lazy(() => import('./components/admin/AdminDashboard'));

function App() {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    userType: null,
  });

  const { deviceName, tier, isLowEnd } = useDeviceOptimization();
  const responsive = useResponsive();
  applyResponsiveMeta();

  useEffect(() => {
    const setVH = () => {
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty('--vh', `${vh}px`);
    };
    setVH();
    window.addEventListener('resize', setVH);
    window.addEventListener('orientationchange', setVH);

    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          setVH();
          ticking = false;
        });
        ticking = true;
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('resize', setVH);
      window.removeEventListener('orientationchange', setVH);
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  useEffect(() => {
    console.log(`[App] Device Mode: ${deviceName} (${tier})`);
    console.log(`[App] Screen: ${responsive.deviceName} (${responsive.width}x${responsive.height})`);
    console.log(`[App] Pixel Ratio: ${responsive.pixelRatio}x`);
    console.log(`[App] Layout: ${JSON.stringify({
      compactMode: responsive.compactMode,
      needsSafeArea: responsive.needsSafeArea,
      isNotchDevice: responsive.isNotchDevice
    })}`);
    if (isLowEnd) {
      console.log('[App] Low-end device detected, performance optimizations active');
    }
  }, [deviceName, tier, isLowEnd, responsive.width, responsive.height]);

  useEffect(() => {
    const stored = getStoredAuth();
    if (stored) {
      setAuthState(stored);
    }

    const handleLogout = () => {
      setAuthState({ user: null, userType: null });
    };
    window.addEventListener('quantum_trader_logout', handleLogout);

    const handleProfileUpdate = () => {
      const updated = getStoredAuth();
      if (updated) {
        setAuthState(updated);
      }
    };
    window.addEventListener('quantum_trader_profile_updated', handleProfileUpdate);

    return () => {
      window.removeEventListener('quantum_trader_logout', handleLogout);
      window.removeEventListener('quantum_trader_profile_updated', handleProfileUpdate);
    };
  }, []);

  useEffect(() => {
    const cleanup = startOrderProcessing();
    return cleanup;
  }, []);

  const handleLoginSuccess = () => {
    const stored = getStoredAuth();
    if (stored) {
      setAuthState(stored);
    }
  };

  if (!authState.user || !authState.userType) {
    return (
      <LanguageProvider>
        <BlockchainBackground />
        <Login onLoginSuccess={handleLoginSuccess} />
      </LanguageProvider>
    );
  }

  if (authState.userType === 'employee') {
    return (
      <LanguageProvider>
        <BlockchainBackground />
        <ErrorBoundary>
          <Suspense fallback={null}>
            <EmployeeDashboard employee={authState.user} />
          </Suspense>
        </ErrorBoundary>
      </LanguageProvider>
    );
  }

  if (authState.userType === 'admin') {
    return (
      <>
        <BlockchainBackground />
        <ErrorBoundary>
          <Suspense fallback={null}>
            <AdminDashboard admin={authState.user} />
          </Suspense>
        </ErrorBoundary>
      </>
    );
  }

  return null;
}

export default App;
