import { useState, useEffect } from 'react';
import { Shield, Lock, Globe, Package, ClipboardCheck, ArrowRight, AlertTriangle, ShieldAlert, Clock } from 'lucide-react';
import { login, storeAuth } from '../lib/auth';
import { useCompanyName } from '../lib/useCompanyName';
import { useResponsive } from '../lib/useResponsive';
import { checkLoginRateLimit, recordLoginAttempt, formatLockDuration } from '../lib/rateLimitService';
import { supabase } from '../lib/supabase';
import { useLanguage, LANGUAGES } from '../lib/i18n';
import { LanguageModal } from '../components/LanguageSwitcher';
import type { Language } from '../lib/i18n';
import LoginDecorations from '../components/LoginDecorations';

interface LoginProps {
  onLoginSuccess: () => void;
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [lockInfo, setLockInfo] = useState<{
    locked: boolean;
    remainingSeconds: number;
    reason: string;
  } | null>(null);
  const [mounted, setMounted] = useState(false);
  const { companyName } = useCompanyName();
  const { isMobile, isTablet } = useResponsive();
  const { t, language, setLanguage } = useLanguage();
  const [showLanguageModal, setShowLanguageModal] = useState(false);
  const [loginTitle, setLoginTitle] = useState('');
  const [loginSubtitle, setLoginSubtitle] = useState('');

  useEffect(() => {
    setMounted(true);
    loadLoginPageSettings();
  }, []);

  const loadLoginPageSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('system_configs')
        .select('key, value')
        .in('key', ['login_title', 'login_subtitle']);

      if (error) throw error;

      data?.forEach(config => {
        if (config.key === 'login_title' && config.value) {
          setLoginTitle(config.value as string);
        } else if (config.key === 'login_subtitle' && config.value) {
          setLoginSubtitle(config.value as string);
        }
      });
    } catch (error) {
      console.error('Error loading login page settings:', error);
    }
  };

  useEffect(() => {
    if (lockInfo && lockInfo.locked && lockInfo.remainingSeconds > 0) {
      const timer = setInterval(() => {
        setLockInfo(prev => {
          if (!prev || prev.remainingSeconds <= 1) {
            setError('');
            setWarning('');
            return null;
          }
          return {
            ...prev,
            remainingSeconds: prev.remainingSeconds - 1
          };
        });
      }, 1000);

      return () => clearInterval(timer);
    }
  }, [lockInfo]);

  // Auto-dismiss error/warning after 10 seconds (only for non-lock messages)
  useEffect(() => {
    if ((error || warning) && !lockInfo?.locked) {
      const timer = setTimeout(() => {
        setError('');
        setWarning('');
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [error, warning, lockInfo?.locked]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setWarning('');
    setLoading(true);

    try {
      const rateLimitCheck = await checkLoginRateLimit(username, 'username');

      if (!rateLimitCheck.allowed || rateLimitCheck.locked) {
        setLockInfo({
          locked: true,
          remainingSeconds: rateLimitCheck.remaining_seconds || 0,
          reason: rateLimitCheck.lock_reason || 'Account is locked'
        });
        setError(`Account locked. Please wait ${formatLockDuration(rateLimitCheck.remaining_seconds || 0)}`);
        setLoading(false);
        return;
      }

      if (rateLimitCheck.warning) {
        setWarning(rateLimitCheck.warning);
      }

      const result = await login({ username, password });

      await recordLoginAttempt(
        username,
        'username',
        true,
        undefined,
        navigator.userAgent
      );

      storeAuth(result);
      onLoginSuccess();
    } catch (err) {
      console.error('[Login] Login error:', err);

      const attemptResult = await recordLoginAttempt(
        username,
        'username',
        false,
        undefined,
        navigator.userAgent
      );

      if (attemptResult.locked) {
        const remainingSeconds = Math.floor((new Date(attemptResult.lock_until!).getTime() - Date.now()) / 1000);
        setLockInfo({
          locked: true,
          remainingSeconds,
          reason: attemptResult.lock_reason || 'Too many failed login attempts'
        });
        setError(attemptResult.lock_reason || 'Account locked due to too many failed login attempts');
      } else {
        setLockInfo(null);
        setError(err instanceof Error ? err.message : 'Invalid username or password');
        if (attemptResult.failed_attempts && attemptResult.failed_attempts >= 3) {
          setWarning(`${attemptResult.failed_attempts} failed attempt${attemptResult.failed_attempts > 1 ? 's' : ''}. Account will be locked after 5 attempts`);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  // Mobile layout
  if (isMobile) {
    return (
      <div className="min-h-screen flex flex-col relative overflow-hidden" style={{ background: 'linear-gradient(170deg, #1e40af 0%, #2563eb 25%, #3b82f6 40%, #93c5fd 52%, #dbeafe 58%, #f0f5ff 65%, #f8fafc 80%, #ffffff 100%)' }}>
        {/* Decorative elements - layered geometric shapes with trade/logistics theme */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {/* Large overlapping soft-edge color blocks creating depth */}
          <div className="absolute top-[-5%] right-[-15%] w-[70vw] h-[35vh] rounded-[3rem] bg-gradient-to-bl from-sky-200/[0.12] to-blue-300/[0.05] rotate-[15deg]" />
          <div className="absolute top-[12%] left-[-20%] w-[55vw] h-[28vh] rounded-[2.5rem] bg-gradient-to-tr from-cyan-200/[0.1] to-sky-100/[0.04] -rotate-[8deg]" />
          <div className="absolute top-[30%] right-[-8%] w-[45vw] h-[22vh] rounded-[2rem] bg-gradient-to-l from-blue-100/[0.09] to-transparent rotate-[6deg]" />
          <div className="absolute top-[18%] left-[10%] w-[35vw] h-[18vh] rounded-[2rem] bg-gradient-to-br from-sky-100/[0.08] to-cyan-200/[0.03] rotate-[20deg]" />

          {/* Subtle grid pattern suggesting logistics/trade network */}
          <svg className="absolute top-[3%] right-[2%] w-[50vw] h-[45vh] opacity-[0.04]" viewBox="0 0 200 200" fill="none" stroke="white" strokeWidth="0.6">
            <line x1="0" y1="40" x2="200" y2="40" />
            <line x1="0" y1="80" x2="200" y2="80" />
            <line x1="0" y1="120" x2="200" y2="120" />
            <line x1="0" y1="160" x2="200" y2="160" />
            <line x1="40" y1="0" x2="40" y2="200" />
            <line x1="80" y1="0" x2="80" y2="200" />
            <line x1="120" y1="0" x2="120" y2="200" />
            <line x1="160" y1="0" x2="160" y2="200" />
          </svg>

          {/* Trade route connecting lines with nodes */}
          <svg className="absolute top-[5%] left-[5%] w-[90vw] h-[48vh] opacity-100" viewBox="0 0 360 200" fill="none">
            <path d="M20 160 C80 140 120 60 180 80 C240 100 280 40 340 50" stroke="white" strokeWidth="0.8" strokeOpacity="0.06" strokeDasharray="4 3" />
            <path d="M40 180 C100 120 160 140 220 100 C280 60 320 80 350 30" stroke="white" strokeWidth="0.6" strokeOpacity="0.05" strokeDasharray="3 4" />
            <rect x="170" y="72" width="20" height="16" rx="2" fill="white" fillOpacity="0.04" stroke="white" strokeWidth="0.8" strokeOpacity="0.07" />
            <rect x="174" y="76" width="5" height="4" rx="0.5" fill="white" fillOpacity="0.05" />
            <rect x="270" y="42" width="16" height="14" rx="2" fill="white" fillOpacity="0.03" stroke="white" strokeWidth="0.8" strokeOpacity="0.06" />
            <rect x="60" y="148" width="18" height="14" rx="2" fill="white" fillOpacity="0.04" stroke="white" strokeWidth="0.8" strokeOpacity="0.06" />
            <rect x="64" y="151" width="4" height="4" rx="0.5" fill="white" fillOpacity="0.06" />
            <rect x="70" y="151" width="4" height="4" rx="0.5" fill="white" fillOpacity="0.06" />
          </svg>

          {/* Stacked container shapes - representing cargo/trade */}
          <svg className="absolute top-[8%] right-[6%] w-[22vw] h-[22vw] opacity-100" viewBox="0 0 100 100" fill="none">
            <rect x="10" y="50" width="80" height="22" rx="3" stroke="white" strokeWidth="1.2" strokeOpacity="0.07" fill="white" fillOpacity="0.02" />
            <rect x="15" y="30" width="70" height="20" rx="3" stroke="white" strokeWidth="1" strokeOpacity="0.06" fill="white" fillOpacity="0.015" />
            <rect x="20" y="12" width="60" height="18" rx="3" stroke="white" strokeWidth="0.8" strokeOpacity="0.05" fill="white" fillOpacity="0.01" />
            <line x1="30" y1="50" x2="30" y2="72" stroke="white" strokeWidth="0.6" strokeOpacity="0.05" />
            <line x1="50" y1="50" x2="50" y2="72" stroke="white" strokeWidth="0.6" strokeOpacity="0.05" />
            <line x1="70" y1="50" x2="70" y2="72" stroke="white" strokeWidth="0.6" strokeOpacity="0.05" />
            <line x1="35" y1="30" x2="35" y2="50" stroke="white" strokeWidth="0.5" strokeOpacity="0.04" />
            <line x1="65" y1="30" x2="65" y2="50" stroke="white" strokeWidth="0.5" strokeOpacity="0.04" />
          </svg>

          {/* Abstract wave pattern - ocean/shipping lanes */}
          <svg className="absolute top-[36%] left-0 w-full h-[12vh] opacity-100" viewBox="0 0 400 60" fill="none" preserveAspectRatio="none">
            <path d="M0 30 C40 20 80 40 120 30 C160 20 200 40 240 30 C280 20 320 40 360 30 C380 25 400 35 400 30" stroke="white" strokeWidth="1" strokeOpacity="0.05" />
            <path d="M0 42 C50 32 90 52 140 42 C190 32 230 52 280 42 C330 32 370 52 400 42" stroke="white" strokeWidth="0.8" strokeOpacity="0.04" />
            <path d="M0 18 C60 10 100 26 150 18 C200 10 250 26 300 18 C350 10 380 26 400 18" stroke="white" strokeWidth="0.6" strokeOpacity="0.03" />
          </svg>

          {/* Large diamond accent blocks */}
          <div className="absolute top-[22%] right-[12%] w-[10vw] h-[10vw] bg-white/[0.03] rotate-45 rounded-md" />
          <div className="absolute top-[40%] left-[8%] w-[8vw] h-[8vw] bg-white/[0.025] rotate-45 rounded-sm" />
        </div>

        {/* Top brand area */}
        <div className="relative z-10 px-6 pt-14">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 bg-white/15 rounded-xl flex items-center justify-center border border-white/20">
              <Globe className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="text-[15px] font-bold text-white block">{loginTitle || companyName}</span>
              {loginSubtitle && <span className="text-[11px] text-white/50">{loginSubtitle}</span>}
            </div>
          </div>
        </div>

        {/* Title - pushed down more */}
        <div className="relative z-10 px-6 pt-24 pb-6">
          <h1 className="text-[26px] font-bold text-white leading-tight tracking-tight">
            {t.login.employeeWorkPlatform}
          </h1>
        </div>

        {/* Spacer to push form toward center */}
        <div className="flex-1" />

        {/* Login form */}
        <div className="relative z-10 px-5">
          <div className="relative bg-white/95 backdrop-blur-sm rounded-2xl overflow-hidden" style={{ boxShadow: '0 -4px 32px rgba(37, 99, 235, 0.06), 0 8px 24px rgba(0,0,0,0.06)' }}>
            {/* Language switcher - absolute top right */}
            <button
              onClick={() => setShowLanguageModal(true)}
              className="absolute top-3.5 right-3.5 z-10 group px-1.5 py-0.5 rounded-full bg-gradient-to-r from-slate-50 to-slate-100 hover:from-blue-50 hover:to-blue-100 text-slate-600 hover:text-blue-700 transition-all duration-300 flex items-center gap-1 border border-slate-200/80 hover:border-blue-200 shadow-sm"
            >
              <Globe className="w-2.5 h-2.5" strokeWidth={2} />
              <span className="text-[11px] font-semibold tracking-wide uppercase">{LANGUAGES.find(l => l.code === language)?.nativeName}</span>
            </button>
            {/* Panel header */}
            <div className="px-6 pt-5 pb-3">
              <h3 className="text-[15px] font-bold text-slate-800">{t.login.employeeSignIn}</h3>
            </div>

            <div className="px-6 pb-6">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="username" className="block text-[12px] font-semibold text-slate-600 mb-2">
                  {t.login.username}
                </label>
                <div className="relative">
                  <input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    required
                    className="w-full pl-11 pr-4 py-3.5 bg-white border-2 border-slate-100 rounded-xl text-slate-800 placeholder-slate-400 text-[15px] focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all"
                    placeholder={t.login.usernamePlaceholder}
                  />
                  <div className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300">
                    <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" /></svg>
                  </div>
                </div>
              </div>

              <div>
                <label htmlFor="password" className="block text-[12px] font-semibold text-slate-600 mb-2">
                  {t.login.password}
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                    className="w-full pl-11 pr-4 py-3.5 bg-white border-2 border-slate-100 rounded-xl text-slate-800 placeholder-slate-400 text-[15px] focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all"
                    placeholder={t.login.passwordPlaceholder}
                  />
                  <div className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300">
                    <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" /></svg>
                  </div>
                </div>
              </div>

              {warning && !error && (
                <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 animate-[fadeIn_0.3s_ease-out]">
                  <div className="flex items-start gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-amber-800 text-[12px] font-semibold leading-tight">{t.login.securityWarning}</p>
                      <p className="text-amber-600 text-[11px] mt-0.5 leading-snug">{warning}</p>
                    </div>
                  </div>
                </div>
              )}

              {error && (
                <div className={`rounded-xl p-3 animate-[fadeIn_0.3s_ease-out] ${
                  lockInfo?.locked
                    ? 'bg-gradient-to-r from-red-50 to-orange-50 border-2 border-red-300 shadow-lg shadow-red-100/50'
                    : 'bg-red-50 border border-red-200'
                }`}>
                  <div className="flex items-start gap-2.5">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      lockInfo?.locked ? 'bg-red-100' : 'bg-red-100'
                    }`}>
                      {lockInfo?.locked ? (
                        <ShieldAlert className="w-3.5 h-3.5 text-red-600" />
                      ) : (
                        <Lock className="w-3.5 h-3.5 text-red-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      {lockInfo?.locked ? (
                        <>
                          <p className="text-red-800 text-[12px] font-bold leading-tight">{t.login.accountLocked}</p>
                          <p className="text-red-600 text-[11px] mt-0.5 leading-snug">{lockInfo.reason}</p>
                          <div className="mt-2 flex items-center gap-1.5 bg-red-100/80 rounded-lg px-2.5 py-1.5">
                            <Clock className="w-3 h-3 text-red-500 animate-pulse" />
                            <span className="text-red-700 text-[11px] font-mono font-bold">
                              {formatLockDuration(lockInfo.remainingSeconds)}
                            </span>
                            <span className="text-red-500 text-[10px]">{t.login.remaining}</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="text-red-700 text-[12px] font-semibold leading-tight">{t.login.loginFailed}</p>
                          <p className="text-red-500 text-[11px] mt-0.5 leading-snug">{error}</p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className={`keep-animation w-full flex items-center justify-center gap-2 text-white py-4 rounded-xl font-semibold text-[15px] transition-all duration-200 border-0 outline-none appearance-none ${
                  loading
                    ? 'bg-blue-500 cursor-wait'
                    : 'bg-gradient-to-r from-blue-600 to-blue-700 active:from-blue-700 active:to-blue-800 shadow-lg shadow-blue-600/25 active:shadow-md active:scale-[0.98]'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
                style={{ WebkitAppearance: 'none', WebkitTapHighlightColor: 'transparent', MozAppearance: 'none' } as React.CSSProperties}
              >
                {loading ? (
                  <>
                    <div className="keep-animation w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    <span className="keep-animation">{t.login.signingIn}</span>
                  </>
                ) : (
                  <>
                    <span>{t.login.signIn}</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
            </div>
          </div>
        </div>
        <div className="flex-1" />

        {/* Minimal footer */}
        <div className="relative z-10 pb-8 pt-4 flex items-center justify-center">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Lock className="w-3 h-3" />
            <span>{t.login.securedConnection}</span>
          </div>
        </div>

        {showLanguageModal && (
          <LanguageModal
            currentLanguage={language}
            onConfirm={(code: Language) => { setLanguage(code); setShowLanguageModal(false); }}
            onClose={() => setShowLanguageModal(false)}
            t={t}
          />
        )}
      </div>
    );
  }

  // Tablet layout
  if (isTablet) {
    return (
      <div className="min-h-screen flex relative overflow-hidden" style={{ background: 'linear-gradient(160deg, #1e40af 0%, #2563eb 20%, #3b82f6 35%, #60a5fa 45%, #93c5fd 52%, #dbeafe 60%, #f0f9ff 70%, #ffffff 85%)' }}>
        {/* Decorative background elements */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {/* Large layered gradient blocks */}
          <div className="absolute top-[-8%] left-[-10%] w-[50%] h-[45%] rounded-[4rem] bg-gradient-to-br from-sky-200/[0.1] to-blue-400/[0.04] rotate-[12deg]" />
          <div className="absolute top-[20%] right-[-5%] w-[40%] h-[35%] rounded-[3rem] bg-gradient-to-bl from-cyan-100/[0.08] to-transparent -rotate-[6deg]" />
          <div className="absolute bottom-[-5%] left-[5%] w-[45%] h-[30%] rounded-[3rem] bg-gradient-to-tr from-blue-100/[0.07] to-transparent rotate-[8deg]" />

          {/* Trade route network lines */}
          <svg className="absolute top-0 left-0 w-full h-full opacity-100" viewBox="0 0 800 600" fill="none" preserveAspectRatio="xMidYMid slice">
            <path d="M50 200 C150 180 250 100 400 120 C550 140 650 80 750 100" stroke="white" strokeWidth="0.8" strokeOpacity="0.05" strokeDasharray="6 4" />
            <path d="M0 350 C100 320 200 380 350 340 C500 300 600 360 800 320" stroke="white" strokeWidth="0.6" strokeOpacity="0.04" strokeDasharray="4 5" />
            <path d="M100 500 C250 470 400 520 550 480 C700 440 750 500 800 480" stroke="white" strokeWidth="0.7" strokeOpacity="0.04" strokeDasharray="5 4" />
            {/* Cargo nodes along routes */}
            <rect x="380" y="112" width="40" height="18" rx="3" fill="white" fillOpacity="0.03" stroke="white" strokeWidth="0.8" strokeOpacity="0.06" />
            <rect x="386" y="116" width="8" height="6" rx="1" fill="white" fillOpacity="0.04" />
            <rect x="396" y="116" width="8" height="6" rx="1" fill="white" fillOpacity="0.04" />
            <rect x="320" y="332" width="36" height="16" rx="3" fill="white" fillOpacity="0.025" stroke="white" strokeWidth="0.7" strokeOpacity="0.05" />
            <rect x="600" y="310" width="32" height="14" rx="2" fill="white" fillOpacity="0.02" stroke="white" strokeWidth="0.7" strokeOpacity="0.05" />
          </svg>

          {/* Subtle grid overlay */}
          <svg className="absolute top-[5%] right-[5%] w-[35%] h-[40%] opacity-[0.03]" viewBox="0 0 200 200" fill="none" stroke="white" strokeWidth="0.5">
            <line x1="0" y1="40" x2="200" y2="40" />
            <line x1="0" y1="80" x2="200" y2="80" />
            <line x1="0" y1="120" x2="200" y2="120" />
            <line x1="0" y1="160" x2="200" y2="160" />
            <line x1="40" y1="0" x2="40" y2="200" />
            <line x1="80" y1="0" x2="80" y2="200" />
            <line x1="120" y1="0" x2="120" y2="200" />
            <line x1="160" y1="0" x2="160" y2="200" />
          </svg>

          {/* Stacked containers - right side */}
          <svg className="absolute top-[12%] right-[8%] w-[18%] h-[18%] opacity-100" viewBox="0 0 100 100" fill="none">
            <rect x="10" y="55" width="80" height="20" rx="3" stroke="white" strokeWidth="1" strokeOpacity="0.06" fill="white" fillOpacity="0.015" />
            <rect x="15" y="35" width="70" height="20" rx="3" stroke="white" strokeWidth="0.8" strokeOpacity="0.05" fill="white" fillOpacity="0.01" />
            <rect x="20" y="17" width="60" height="18" rx="3" stroke="white" strokeWidth="0.7" strokeOpacity="0.04" fill="white" fillOpacity="0.008" />
            <line x1="35" y1="55" x2="35" y2="75" stroke="white" strokeWidth="0.5" strokeOpacity="0.04" />
            <line x1="55" y1="55" x2="55" y2="75" stroke="white" strokeWidth="0.5" strokeOpacity="0.04" />
            <line x1="75" y1="55" x2="75" y2="75" stroke="white" strokeWidth="0.5" strokeOpacity="0.04" />
          </svg>

          {/* Wave pattern - bottom area */}
          <svg className="absolute bottom-[15%] left-0 w-full h-[10%] opacity-100" viewBox="0 0 800 60" fill="none" preserveAspectRatio="none">
            <path d="M0 30 C80 18 160 42 240 30 C320 18 400 42 480 30 C560 18 640 42 720 30 C760 24 800 36 800 30" stroke="white" strokeWidth="1" strokeOpacity="0.04" />
            <path d="M0 45 C100 33 200 55 300 43 C400 31 500 53 600 43 C700 33 750 48 800 43" stroke="white" strokeWidth="0.7" strokeOpacity="0.03" />
          </svg>

          {/* Diamond accents */}
          <div className="absolute top-[60%] right-[15%] w-16 h-16 bg-white/[0.02] rotate-45 rounded-md" />
          <div className="absolute top-[75%] left-[10%] w-12 h-12 bg-white/[0.015] rotate-45 rounded-sm" />
        </div>

        {/* Left panel - Branding & info */}
        <div className="w-[52%] flex flex-col justify-between relative z-10 p-10 pl-8">
          {/* Brand - top left */}
          <div className={`transition-all duration-1000 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-8'}`}>
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 bg-white/15 backdrop-blur-sm rounded-lg flex items-center justify-center border border-white/20 flex-shrink-0">
                <Globe className="w-4.5 h-4.5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-[13px] font-bold text-white block whitespace-nowrap">{loginTitle || companyName}</span>
                {loginSubtitle && <p className="text-[10px] text-white/50 mt-0.5 whitespace-nowrap">{loginSubtitle}</p>}
              </div>
            </div>
          </div>

          {/* Center content */}
          <div className={`transition-all duration-1000 delay-300 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
            <h1 className="text-[32px] font-bold text-white leading-tight mb-4">
              {t.login.employeeWorkPlatform}
            </h1>
            <p className="text-sm text-white/60 leading-relaxed max-w-[340px]">
              {t.login.description}
            </p>
          </div>

          {/* Status - bottom left */}
          <div className={`transition-all duration-1000 delay-500 ${mounted ? 'opacity-100' : 'opacity-0'}`}>
            <div className="flex items-center gap-2 text-xs text-white/40">
              <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse"></div>
              <span>{t.login.systemsOnline}</span>
              <span className="mx-2 text-white/20">|</span>
              <Lock className="w-3 h-3" />
              <span>{t.login.sslSecured}</span>
            </div>
          </div>
        </div>

        {/* Right panel - Login form */}
        <div className="flex-1 flex items-center justify-center p-8 relative z-10">
          <div className={`w-full max-w-[400px] transition-all duration-700 delay-200 ${mounted ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}>
            <div className="relative bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl shadow-blue-900/10 border border-white/80 overflow-hidden">
              {/* Top accent */}
              <div className="h-1 bg-gradient-to-r from-blue-500 via-sky-400 to-blue-500"></div>

              <div className="p-8">
                {/* Language switcher - top right, static flow to avoid overlap */}
                <div className="flex justify-end mb-4">
                  <button
                    onClick={() => setShowLanguageModal(true)}
                    className="group px-3 py-1.5 rounded-full bg-gradient-to-r from-slate-50 to-slate-100 hover:from-blue-50 hover:to-blue-100 text-slate-600 hover:text-blue-700 transition-all duration-300 flex items-center gap-2 border border-slate-200/80 hover:border-blue-200 shadow-sm hover:shadow-md hover:shadow-blue-100/50"
                  >
                    <Globe className="w-3.5 h-3.5 transition-transform duration-300 group-hover:rotate-[20deg]" strokeWidth={2} />
                    <span className="text-[11px] font-semibold tracking-wide uppercase">{LANGUAGES.find(l => l.code === language)?.nativeName}</span>
                    <div className="w-1 h-1 rounded-full bg-blue-400 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  </button>
                </div>
                {/* Header */}
                <div className="mb-6">
                  <h3 className="text-[22px] font-bold text-slate-800 mb-1">{t.login.welcomeBack}</h3>
                  <p className="text-sm text-slate-500">{t.login.signInToAccess}</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5">
                  <div>
                    <label htmlFor="username" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                      {t.login.username}
                    </label>
                    <input
                      id="username"
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      autoComplete="username"
                      required
                      className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 text-[15px] focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-white transition-all hover:border-slate-300"
                      placeholder={t.login.usernamePlaceholder}
                    />
                  </div>

                  <div>
                    <label htmlFor="password" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                      {t.login.password}
                    </label>
                    <input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      required
                      className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 text-[15px] focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-white transition-all hover:border-slate-300"
                      placeholder={t.login.passwordPlaceholder}
                    />
                  </div>

                  {warning && !error && (
                    <div className="bg-amber-50 border border-amber-300 rounded-xl p-3.5 animate-[fadeIn_0.3s_ease-out]">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
                          <AlertTriangle className="w-4 h-4 text-amber-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-amber-800 text-sm font-semibold leading-tight">{t.login.securityWarning}</p>
                          <p className="text-amber-600 text-xs mt-0.5 leading-snug">{warning}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {error && (
                    <div className={`rounded-xl p-3.5 animate-[fadeIn_0.3s_ease-out] ${
                      lockInfo?.locked
                        ? 'bg-gradient-to-r from-red-50 to-orange-50 border-2 border-red-300 shadow-lg shadow-red-100/50'
                        : 'bg-red-50 border border-red-200'
                    }`}>
                      <div className="flex items-start gap-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                          lockInfo?.locked ? 'bg-red-100' : 'bg-red-100'
                        }`}>
                          {lockInfo?.locked ? (
                            <ShieldAlert className="w-4 h-4 text-red-600" />
                          ) : (
                            <Lock className="w-4 h-4 text-red-500" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          {lockInfo?.locked ? (
                            <>
                              <p className="text-red-800 text-sm font-bold leading-tight">{t.login.accountLocked}</p>
                              <p className="text-red-600 text-xs mt-0.5 leading-snug">{lockInfo.reason}</p>
                              <div className="mt-2 flex items-center gap-2 bg-red-100/80 rounded-lg px-3 py-1.5">
                                <Clock className="w-3.5 h-3.5 text-red-500 animate-pulse" />
                                <span className="text-red-700 text-xs font-mono font-bold">
                                  {formatLockDuration(lockInfo.remainingSeconds)}
                                </span>
                                <span className="text-red-500 text-[11px]">{t.login.remaining}</span>
                              </div>
                            </>
                          ) : (
                            <>
                              <p className="text-red-700 text-sm font-semibold leading-tight">{t.login.loginFailed}</p>
                              <p className="text-red-500 text-xs mt-0.5 leading-snug">{error}</p>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className={`keep-animation w-full flex items-center justify-center gap-2.5 text-white py-4 px-5 rounded-xl font-semibold text-[15px] transition-all duration-200 border-0 outline-none appearance-none ${
                      loading
                        ? 'bg-blue-500 cursor-wait'
                        : 'bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 shadow-lg shadow-blue-600/20 hover:shadow-xl hover:shadow-blue-600/30 active:scale-[0.98]'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {loading ? (
                      <>
                        <div className="keep-animation w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        <span className="keep-animation">{t.login.signingIn}</span>
                      </>
                    ) : (
                      <>
                        <span>{t.login.signIn}</span>
                        <ArrowRight className="w-4.5 h-4.5" />
                      </>
                    )}
                  </button>
                </form>

                {/* Footer */}
                <div className="mt-8 pt-5 border-t border-slate-100">
                  <div className="flex items-center justify-center gap-4 text-xs text-slate-400">
                    <div className="flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5" />
                      <span>{t.login.encrypted}</span>
                    </div>
                    <div className="w-1 h-1 bg-slate-200 rounded-full"></div>
                    <div className="flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5" />
                      <span>{t.login.protected}</span>
                    </div>
                    <div className="w-1 h-1 bg-slate-200 rounded-full"></div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 bg-green-400 rounded-full"></div>
                      <span>{t.login.secure}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {showLanguageModal && (
          <LanguageModal
            currentLanguage={language}
            onConfirm={(code: Language) => { setLanguage(code); setShowLanguageModal(false); }}
            onClose={() => setShowLanguageModal(false)}
            t={t}
          />
        )}
      </div>
    );
  }

  // Desktop layout
  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Background: white with soft light-blue gradient edges */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-white" />
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50/50 via-transparent to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-tl from-blue-50/30 via-transparent to-transparent" />

        {/* Subtle geometric pattern */}
        <div className="absolute inset-0 opacity-[0.025]">
          <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="grid-pattern" x="0" y="0" width="60" height="60" patternUnits="userSpaceOnUse">
                <path d="M 60 0 L 0 0 0 60" fill="none" stroke="currentColor" strokeWidth="0.5" className="text-slate-800" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid-pattern)" />
          </svg>
        </div>
      </div>

      {/* Trade/cargo decorative elements */}
      <LoginDecorations />

      {/* Main layout - split screen */}
      <div className="relative z-10 min-h-screen flex">
        {/* Left panel - Information */}
        <div className="w-[54%] xl:w-[56%] flex flex-col justify-center pl-16 xl:pl-24 pr-12">
          <div className={`transition-all duration-1000 delay-200 ${mounted ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-12'}`}>
            {/* Brand */}
            <div className="flex items-center gap-3.5 mb-12">
              <div className="w-11 h-11 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/15">
                <Globe className="w-5.5 h-5.5 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-800">{loginTitle || companyName}</h2>
                {loginSubtitle && <p className="text-xs text-slate-500 mt-0.5">{loginSubtitle}</p>}
              </div>
            </div>

            {/* Headline */}
            <h1 className="text-4xl xl:text-[44px] font-bold text-slate-800 leading-tight mb-5">
              {t.login.employeeWorkPlatform}
            </h1>

            <p className="text-base text-slate-500 leading-relaxed mb-10 max-w-md">
              {t.login.descriptionDesktop}
            </p>

            {/* Feature cards */}
            <div className="space-y-4 max-w-md">
              <div className="flex items-center gap-4 p-4 rounded-xl bg-white/70 border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Package className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-700">{t.login.featureOrderTitle}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{t.login.featureOrderDesc}</p>
                </div>
              </div>

              <div className="flex items-center gap-4 p-4 rounded-xl bg-white/70 border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
                  <ClipboardCheck className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-700">{t.login.featureDispatchTitle}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{t.login.featureDispatchDesc}</p>
                </div>
              </div>

              <div className="flex items-center gap-4 p-4 rounded-xl bg-white/70 border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Shield className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-700">{t.login.featureSecureTitle}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{t.login.featureSecureDesc}</p>
                </div>
              </div>
            </div>

            {/* Status bar */}
            <div className="mt-12 pt-6 border-t border-slate-100">
              <div className="flex items-center gap-6 text-xs text-slate-400">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                  <span>{t.login.systemsOnline}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Shield className="w-3.5 h-3.5" />
                  <span>{t.login.sslSecured}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Globe className="w-3.5 h-3.5" />
                  <span>{t.login.globalNetwork}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right panel - Login form */}
        <div className="flex-1 flex items-center justify-center px-8 xl:px-12">
          <div className={`w-full max-w-[420px] transition-all duration-1000 delay-300 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
            {/* Login card */}
            <div className="relative bg-white rounded-2xl shadow-xl shadow-slate-200/60 border border-slate-100 overflow-hidden">
              {/* Top gradient line */}
              <div className="h-1 bg-gradient-to-r from-blue-500 via-blue-600 to-blue-500"></div>

              <div className="p-8 xl:p-10">
                {/* Language switcher - absolute top right */}
                <button
                  onClick={() => setShowLanguageModal(true)}
                  className="absolute top-5 right-5 xl:top-6 xl:right-6 z-10 group px-3.5 py-2 rounded-full bg-gradient-to-r from-slate-50 to-slate-100 hover:from-blue-50 hover:to-blue-100 text-slate-600 hover:text-blue-700 transition-all duration-300 flex items-center gap-2 border border-slate-200/80 hover:border-blue-200 shadow-sm hover:shadow-md hover:shadow-blue-100/50"
                >
                  <Globe className="w-4 h-4 transition-transform duration-300 group-hover:rotate-[20deg]" strokeWidth={2} />
                  <span className="text-xs font-semibold tracking-wide">{LANGUAGES.find(l => l.code === language)?.nativeName}</span>
                  <div className="w-1 h-1 rounded-full bg-blue-400 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                </button>
                {/* Header */}
                <div className="mb-8">
                  <h3 className="text-2xl font-bold text-slate-800 mb-1.5">{t.login.employeeSignIn}</h3>
                  <p className="text-sm text-slate-500">{t.login.accessDashboard}</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5">
                  <div>
                    <label htmlFor="username" className="block text-sm font-medium text-slate-700 mb-2">
                      {t.login.username}
                    </label>
                    <input
                      id="username"
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      autoComplete="username"
                      required
                      className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-white transition-all hover:border-slate-300"
                      placeholder={t.login.usernamePlaceholder}
                    />
                  </div>

                  <div>
                    <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-2">
                      {t.login.password}
                    </label>
                    <input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      required
                      className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-white transition-all hover:border-slate-300"
                      placeholder={t.login.passwordPlaceholder}
                    />
                  </div>

                  {warning && !error && (
                    <div className="bg-amber-50 border border-amber-300 rounded-xl p-3.5 animate-[fadeIn_0.3s_ease-out]">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
                          <AlertTriangle className="w-4 h-4 text-amber-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-amber-800 text-sm font-semibold leading-tight">{t.login.securityWarning}</p>
                          <p className="text-amber-600 text-xs mt-0.5 leading-snug">{warning}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {error && (
                    <div className={`rounded-xl p-3.5 animate-[fadeIn_0.3s_ease-out] ${
                      lockInfo?.locked
                        ? 'bg-gradient-to-r from-red-50 to-orange-50 border-2 border-red-300 shadow-lg shadow-red-100/50'
                        : 'bg-red-50 border border-red-200'
                    }`}>
                      <div className="flex items-start gap-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                          lockInfo?.locked ? 'bg-red-100' : 'bg-red-100'
                        }`}>
                          {lockInfo?.locked ? (
                            <ShieldAlert className="w-4 h-4 text-red-600" />
                          ) : (
                            <Lock className="w-4 h-4 text-red-500" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          {lockInfo?.locked ? (
                            <>
                              <p className="text-red-800 text-sm font-bold leading-tight">{t.login.accountLocked}</p>
                              <p className="text-red-600 text-xs mt-0.5 leading-snug">{lockInfo.reason}</p>
                              <div className="mt-2 flex items-center gap-2 bg-red-100/80 rounded-lg px-3 py-1.5">
                                <Clock className="w-3.5 h-3.5 text-red-500 animate-pulse" />
                                <span className="text-red-700 text-xs font-mono font-bold">
                                  {formatLockDuration(lockInfo.remainingSeconds)}
                                </span>
                                <span className="text-red-500 text-[11px]">{t.login.remaining}</span>
                              </div>
                            </>
                          ) : (
                            <>
                              <p className="text-red-700 text-sm font-semibold leading-tight">{t.login.loginFailed}</p>
                              <p className="text-red-500 text-xs mt-0.5 leading-snug">{error}</p>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className={`keep-animation w-full flex items-center justify-center gap-2.5 text-white py-3.5 px-5 rounded-xl font-semibold text-sm transition-all duration-200 border-0 outline-none appearance-none ${
                      loading
                        ? 'bg-blue-500 cursor-wait'
                        : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 shadow-lg shadow-blue-600/20 hover:shadow-xl hover:shadow-blue-600/30'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {loading ? (
                      <>
                        <div className="keep-animation w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        <span className="keep-animation">{t.login.signingIn}</span>
                      </>
                    ) : (
                      <>
                        <span>{t.login.signIn}</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </form>

                {/* Footer */}
                <div className="mt-8 pt-6 border-t border-slate-100">
                  <div className="flex items-center justify-center gap-4 text-xs text-slate-400">
                    <div className="flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5" />
                      <span>{t.login.encrypted}</span>
                    </div>
                    <div className="w-1 h-1 bg-slate-200 rounded-full"></div>
                    <div className="flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5" />
                      <span>{t.login.protected}</span>
                    </div>
                    <div className="w-1 h-1 bg-slate-200 rounded-full"></div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 bg-green-400 rounded-full"></div>
                      <span>{t.login.secure}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 text-center">
              <p className="text-xs text-slate-400">{t.login.crossBorderOrder}</p>
            </div>
          </div>
        </div>
      </div>

      {showLanguageModal && (
        <LanguageModal
          currentLanguage={language}
          onConfirm={(code: Language) => { setLanguage(code); setShowLanguageModal(false); }}
          onClose={() => setShowLanguageModal(false)}
          t={t}
        />
      )}
    </div>
  );
}
