import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Pin, Calendar, Bell, Sparkles, Radio, ChevronRight, X, Zap, Star, Eye, TrendingUp, Lock, Shield, Layers, Database } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Announcement, AnnouncementListItem } from '../../types';
import { marked } from 'marked';
import { sanitizeAnnouncementContent } from '../../lib/sanitizeHTML';
import { useDeviceOptimization } from '../../lib/useDeviceOptimization';
import { useLanguage } from '../../lib/i18n';

interface AnnouncementBoardProps {
  userId: string;
}

// Cache keys for sessionStorage
const CACHE_KEYS = {
  ADMIN_ID: 'announcement_admin_id',
  CATEGORIES: 'announcement_categories',
  CAROUSEL_ENABLED: 'announcement_carousel_enabled',
  CAROUSEL_SPEED: 'announcement_carousel_speed',
  ANNOUNCEMENTS: 'announcements_cache',
  CACHE_TIME: 'announcements_cache_time',
  CACHE_USER_ID: 'announcements_cache_user_id'
};

// Cache duration: 5 minutes
const CACHE_DURATION = 5 * 60 * 1000;

export default function AnnouncementBoard({ userId }: AnnouncementBoardProps) {
  const { isMobile, isTablet, deviceType, shouldReduceAnimations } = useDeviceOptimization();
  const { t, dateLocale } = useLanguage();

  const translateCategory = (category: string) => {
    const key = `category${category.charAt(0).toUpperCase()}${category.slice(1).toLowerCase()}` as keyof typeof t.announcements;
    return (t.announcements[key] as string) || category;
  };

  const isActuallyMobile = typeof window !== 'undefined' && window.innerWidth < 600;

  // Detect iOS devices for special optimization
  // Only flag as iOS for actual mobile/tablet touch devices, not Mac desktops
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1 && window.innerWidth <= 1366);

  // Only disable carousel on actual phones - tablets and desktops keep carousel
  const isMobileDevice = deviceType === 'phone' || isActuallyMobile;

  // Tablets and desktops get full visual effects; only phones get reduced effects
  // iOS devices get even more optimized experience
  const showDesktopEffects = !isMobileDevice && !isIOS;

  // Tablet-specific detection for optimized layout
  const isTabletDevice = deviceType === 'tablet';

  const [announcements, setAnnouncements] = useState<AnnouncementListItem[]>(() => {
    try {
      const cachedUserId = sessionStorage.getItem(CACHE_KEYS.CACHE_USER_ID);
      const cached = sessionStorage.getItem(CACHE_KEYS.ANNOUNCEMENTS);
      const cacheTime = sessionStorage.getItem(CACHE_KEYS.CACHE_TIME);

      if (cachedUserId !== userId) {
        sessionStorage.removeItem(CACHE_KEYS.ANNOUNCEMENTS);
        sessionStorage.removeItem(CACHE_KEYS.CACHE_TIME);
        sessionStorage.removeItem(CACHE_KEYS.ADMIN_ID);
        return [];
      }

      if (cached && cacheTime) {
        const age = Date.now() - parseInt(cacheTime);
        if (age < CACHE_DURATION) {
          return JSON.parse(cached);
        }
      }
    } catch (e) {
      // Ignore cache errors
    }
    return [];
  });
  const [loading, setLoading] = useState(false);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const contentCacheRef = useRef<Map<string, string>>(new Map());
  const [userAdminId, setUserAdminId] = useState<string | null>(() => {
    const cachedUserId = sessionStorage.getItem(CACHE_KEYS.CACHE_USER_ID);
    if (cachedUserId !== userId) {
      return null;
    }
    return sessionStorage.getItem(CACHE_KEYS.ADMIN_ID);
  });
  const [adminResolved, setAdminResolved] = useState(() => {
    const cachedUserId = sessionStorage.getItem(CACHE_KEYS.CACHE_USER_ID);
    return cachedUserId === userId && sessionStorage.getItem(CACHE_KEYS.ADMIN_ID) !== null;
  });
  const [isHovering, setIsHovering] = useState(false);
  const isHoveringRef = useRef(false);
  const touchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Keep ref in sync with state for use in closures
  useEffect(() => {
    isHoveringRef.current = isHovering;
  }, [isHovering]);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const isLoadingRef = useRef(false);
  const backgroundRefreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isPageVisible, setIsPageVisible] = useState(() => {
    // Initialize with actual visibility state
    return typeof document !== 'undefined' ? !document.hidden : true;
  });
  const isPageVisibleRef = useRef(isPageVisible);

  // Keep ref in sync with state for use in closures
  useEffect(() => {
    isPageVisibleRef.current = isPageVisible;
  }, [isPageVisible]);
  const [carouselEnabled, setCarouselEnabled] = useState(() => {
    const cached = sessionStorage.getItem(CACHE_KEYS.CAROUSEL_ENABLED);
    return cached !== null ? cached === 'true' : true;
  });
  const [carouselSpeed, setCarouselSpeed] = useState(() => {
    const cached = sessionStorage.getItem(CACHE_KEYS.CAROUSEL_SPEED);
    return cached ? parseFloat(cached) : 0.6;
  });
  const [categories, setCategories] = useState<Map<string, { icon_name: string; color_scheme: string }>>(() => {
    // Load from cache
    try {
      const cached = sessionStorage.getItem(CACHE_KEYS.CATEGORIES);
      if (cached) {
        const parsed = JSON.parse(cached);
        return new Map(Object.entries(parsed));
      }
    } catch (e) {
      // Ignore cache errors
    }
    return new Map();
  });

  marked.setOptions({
    breaks: true,
    gfm: true,
  });

  const getCategoryIcon = (announcement: AnnouncementListItem | Announcement) => {
    const iconMap: { [key: string]: any } = {
      'bell': Bell,
      'sparkles': Sparkles,
      'radio': Radio,
      'zap': Zap,
      'star': Star,
      'eye': Eye,
      'trending-up': TrendingUp,
      'trendingup': TrendingUp,
      'lock': Lock,
      'shield': Shield,
      'layers': Layers,
      'database': Database,
    };

    const categoryInfo = announcement.category ? categories.get(announcement.category) : null;
    const iconName = categoryInfo?.icon_name?.toLowerCase() || 'bell';
    const IconComponent = iconMap[iconName] || Bell;
    return IconComponent;
  };

  const getCategoryColor = (announcement: AnnouncementListItem | Announcement) => {
    const colorMap: { [key: string]: string } = {
      'red': '#f87171',
      'blue': '#60a5fa',
      'green': '#4ade80',
      'yellow': '#facc15',
      'purple': '#c084fc',
      'slate': '#94a3b8',
    };

    const categoryInfo = announcement.category ? categories.get(announcement.category) : null;
    const colorScheme = categoryInfo?.color_scheme?.toLowerCase() || 'slate';
    return colorMap[colorScheme] || '#22d3ee';
  };

  const renderContent = (content: string) => {
    // Check if content is already HTML (starts with < tag)
    if (content.trim().startsWith('<')) {
      return content;
    }
    // Otherwise, treat as markdown
    return marked(content);
  };

  // Memoize the rendered and sanitized content for the selected announcement
  const sanitizedSelectedContent = useMemo(() => {
    if (!selectedAnnouncement) return '';
    return sanitizeAnnouncementContent(renderContent(selectedAnnouncement.content));
  }, [selectedAnnouncement?.id, selectedAnnouncement?.content]);

  const handleAnnouncementClick = useCallback(async (item: AnnouncementListItem) => {
    const cachedContent = contentCacheRef.current.get(item.id);
    if (cachedContent) {
      setSelectedAnnouncement({ ...item, content: cachedContent } as Announcement);
      return;
    }

    setContentLoading(true);
    setSelectedAnnouncement({ ...item, content: '' } as Announcement);

    try {
      const { data, error } = await supabase
        .from('announcements')
        .select('content')
        .eq('id', item.id)
        .maybeSingle();

      if (error) throw error;
      const content = data?.content || '';
      contentCacheRef.current.set(item.id, content);
      setSelectedAnnouncement({ ...item, content } as Announcement);
    } catch (error) {
      console.error('Error loading announcement content:', error);
      setSelectedAnnouncement({ ...item, content: 'Failed to load content.' } as Announcement);
    } finally {
      setContentLoading(false);
    }
  }, []);

  useEffect(() => {
    // Parallel loading for better performance
    Promise.all([
      loadUserAdmin(),
      loadCategories(),
      loadInitialAnnouncements()
    ]);

    // Cleanup on unmount
    return () => {
      if (backgroundRefreshTimeoutRef.current) {
        clearTimeout(backgroundRefreshTimeoutRef.current);
        backgroundRefreshTimeoutRef.current = null;
      }
      if (touchTimeoutRef.current) {
        clearTimeout(touchTimeoutRef.current);
        touchTimeoutRef.current = null;
      }
      isLoadingRef.current = false;
    };
  }, [userId]);

  // iOS optimization: Pause animations when page is not visible
  useEffect(() => {
    if (!isIOS) return;

    const handleVisibilityChange = () => {
      setIsPageVisible(!document.hidden);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isIOS]);

  const loadCategories = async () => {
    try {
      // Check cache first
      const cached = sessionStorage.getItem(CACHE_KEYS.CATEGORIES);
      if (cached && categories.size > 0) {
        // Already have cached data in state, skip
        return;
      }

      const { data, error } = await supabase
        .from('announcement_categories')
        .select('name, icon_name, color_scheme')
        .eq('is_active', true);

      if (error) throw error;

      const categoryMap = new Map();
      data?.forEach(cat => {
        categoryMap.set(cat.name, {
          icon_name: cat.icon_name,
          color_scheme: cat.color_scheme
        });
      });
      setCategories(categoryMap);

      // Cache the result
      try {
        const cacheObj: Record<string, any> = {};
        categoryMap.forEach((value, key) => {
          cacheObj[key] = value;
        });
        sessionStorage.setItem(CACHE_KEYS.CATEGORIES, JSON.stringify(cacheObj));
      } catch (e) {
        // Ignore cache errors
      }
    } catch (error) {
      console.error('Error loading categories:', error);
    }
  };

  // Load and subscribe to carousel settings
  useEffect(() => {
    const setupCarouselSettings = async () => {
      try {
        // Check if we already have cached values
        const cachedEnabled = sessionStorage.getItem(CACHE_KEYS.CAROUSEL_ENABLED);
        const cachedSpeed = sessionStorage.getItem(CACHE_KEYS.CAROUSEL_SPEED);

        // Only fetch if we don't have cached values
        if (cachedEnabled === null) {
          // Load carousel enabled setting
          const { data: enabledData, error: enabledError } = await supabase
            .from('system_configs')
            .select('value')
            .eq('key', 'announcement_carousel_enabled')
            .maybeSingle();

          if (enabledError) throw enabledError;
          if (enabledData?.value !== undefined) {
            const enabled = enabledData.value === true;
            setCarouselEnabled(enabled);
            sessionStorage.setItem(CACHE_KEYS.CAROUSEL_ENABLED, enabled.toString());
          }
        }

        if (cachedSpeed === null) {
          // Load carousel speed setting
          const { data: speedData, error: speedError } = await supabase
          .from('system_configs')
          .select('value')
          .eq('key', 'announcement_carousel_speed')
          .maybeSingle();

          if (speedError) throw speedError;
          if (speedData?.value !== undefined) {
            const speed = typeof speedData.value === 'number' ? speedData.value : 0.6;
            setCarouselSpeed(speed);
            sessionStorage.setItem(CACHE_KEYS.CAROUSEL_SPEED, speed.toString());
          }
        }
      } catch (error) {
        console.error('Error loading carousel settings:', error);
      }
    };

    setupCarouselSettings();

    // Subscribe to real-time updates for carousel settings
    const channel = supabase
      .channel('carousel_settings_changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'system_configs',
          filter: 'key=in.(announcement_carousel_enabled,announcement_carousel_speed)'
        },
        (payload) => {
          const newRecord = payload.new as any;

          if (newRecord.key === 'announcement_carousel_enabled') {
            const newValue = newRecord.value === true;
            setCarouselEnabled(newValue);
            sessionStorage.setItem(CACHE_KEYS.CAROUSEL_ENABLED, newValue.toString());
          } else if (newRecord.key === 'announcement_carousel_speed') {
            const newSpeed = typeof newRecord.value === 'number' ? newRecord.value : 0.6;
            setCarouselSpeed(newSpeed);
            sessionStorage.setItem(CACHE_KEYS.CAROUSEL_SPEED, newSpeed.toString());
          }
        }
      )
      .subscribe();

    return () => {
      console.log('[Carousel] Cleaning up subscription');
      supabase.removeChannel(channel);
    };
  }, []);

  // iOS-compatible scroll lock when modal is open
  useEffect(() => {
    if (selectedAnnouncement) {
      const scrollY = window.scrollY;
      const body = document.body;
      body.style.position = 'fixed';
      body.style.top = `-${scrollY}px`;
      body.style.left = '0';
      body.style.right = '0';
      body.style.overflow = 'hidden';

      return () => {
        body.style.position = '';
        body.style.top = '';
        body.style.left = '';
        body.style.right = '';
        body.style.overflow = '';
        window.scrollTo(0, scrollY);
      };
    }
  }, [selectedAnnouncement]);

  // Detect device performance level
  const [isLowEndDevice, setIsLowEndDevice] = useState(false);

  useEffect(() => {
    // Check if device is low-end based on hardware concurrency and memory
    const hardwareConcurrency = navigator.hardwareConcurrency || 2;
    const deviceMemory = (navigator as any).deviceMemory || 4;

    // Low-end if: <= 4 CPU cores OR <= 2GB RAM
    const isLowEnd = hardwareConcurrency <= 4 || deviceMemory <= 2;
    setIsLowEndDevice(isLowEnd);
  }, []);

  // Ultimate zero-flicker optimization - Minimal DOM manipulation
  useEffect(() => {
    if (!selectedAnnouncement) return;

    // Immediate synchronous execution - no delay, no flicker
    const videos = document.querySelectorAll('.announcement-content video');

    videos.forEach((video) => {
      const videoEl = video as HTMLVideoElement;

      // Skip if already processed
      if (videoEl.dataset.videoProcessed === 'true') {
        return;
      }
      videoEl.dataset.videoProcessed = 'true';

      // Critical: Set attributes immediately before any DOM manipulation
      videoEl.removeAttribute('controls');
      videoEl.setAttribute('preload', 'auto'); // Load entire video for instant poster
      videoEl.setAttribute('playsinline', 'true');

      // Force video to load and seek to a visible frame (not black screen)
      const loadPoster = () => {
        // Seek to 0.1 second to avoid black first frame
        videoEl.currentTime = 0.1;

        // Capture frame once seeked
        const captureFrame = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = videoEl.videoWidth || 640;
            canvas.height = videoEl.videoHeight || 360;
            const ctx = canvas.getContext('2d');
            if (ctx && videoEl.videoWidth > 0) {
              ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
              const posterUrl = canvas.toDataURL('image/jpeg', 0.85);
              videoEl.setAttribute('poster', posterUrl);
              videoEl.style.backgroundImage = `url(${posterUrl})`;
              videoEl.style.backgroundSize = 'cover';
              videoEl.style.backgroundPosition = 'center';
            }
          } catch (err) {
            console.warn('Failed to capture video frame:', err);
          }
          // Reset to beginning
          videoEl.currentTime = 0;
        };

        videoEl.addEventListener('seeked', captureFrame, { once: true });
      };

      // Load poster when metadata is available
      if (videoEl.readyState >= 1) {
        loadPoster();
      } else {
        videoEl.addEventListener('loadedmetadata', loadPoster, { once: true });
      }

      // Minimal styling - avoid layout shifts
      videoEl.style.display = 'block';
      videoEl.style.width = '100%';
      videoEl.style.height = 'auto';
      videoEl.style.borderRadius = '1rem';
      videoEl.style.backgroundColor = 'rgba(15, 23, 42, 0.9)';

      // Skip wrapper if already exists
      if (videoEl.parentElement?.classList.contains('video-wrapper')) {
        return;
      }

      // Minimal wrapper - single container only
      const wrapper = document.createElement('div');
      wrapper.className = 'video-wrapper';
      // Only set essential inline styles - let CSS handle layout
      wrapper.style.position = 'relative';

      // Create play button only (no extra decorations)
      const playBtn = document.createElement('div');
      playBtn.className = 'video-play-btn';
      playBtn.innerHTML = '<svg width="60" height="60" viewBox="0 0 60 60"><circle cx="30" cy="30" r="28" fill="rgba(15, 23, 42, 0.9)" stroke="rgba(96, 165, 250, 0.8)" stroke-width="2"/><path d="M25 20 L25 40 L40 30 Z" fill="rgb(96, 165, 250)"/></svg>';
      playBtn.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); cursor: pointer; z-index: 10; opacity: 1; transition: opacity 0.15s ease, transform 0.15s ease;';

      // Wrap video
      if (videoEl.parentNode) {
        videoEl.parentNode.insertBefore(wrapper, videoEl);
        wrapper.appendChild(videoEl);
        wrapper.appendChild(playBtn);

        // Play/pause handlers
        const togglePlay = (e: Event) => {
          e.stopPropagation();
          if (videoEl.paused) {
            videoEl.play();
          } else {
            videoEl.pause();
          }
        };

        playBtn.addEventListener('click', togglePlay);
        videoEl.addEventListener('click', togglePlay);

        // Show/hide play button
        videoEl.addEventListener('play', () => {
          playBtn.style.opacity = '0';
          playBtn.style.pointerEvents = 'none';
        }, { passive: true });

        videoEl.addEventListener('pause', () => {
          playBtn.style.opacity = '1';
          playBtn.style.pointerEvents = 'auto';
        }, { passive: true });

        // Hover effect (desktop only)
        if (window.matchMedia('(hover: hover)').matches) {
          playBtn.addEventListener('mouseenter', () => {
            playBtn.style.transform = 'translate(-50%, -50%) scale(1.1)';
          });
          playBtn.addEventListener('mouseleave', () => {
            playBtn.style.transform = 'translate(-50%, -50%) scale(1)';
          });
        }
      }
    });
  }, [selectedAnnouncement]);

  useEffect(() => {
    if (!adminResolved) return;

    // Subscribe to real-time updates with debouncing
    let reloadTimeout: NodeJS.Timeout | null = null;

    const channel = supabase
      .channel('announcements_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'announcements'
        },
        (payload) => {
          if (reloadTimeout) {
            clearTimeout(reloadTimeout);
          }

          reloadTimeout = setTimeout(() => {
            try {
              sessionStorage.removeItem(CACHE_KEYS.ANNOUNCEMENTS);
              sessionStorage.removeItem(CACHE_KEYS.CACHE_TIME);
            } catch (e) {
              // Ignore storage errors
            }

            loadAnnouncements(true);
          }, 300);
        }
      )
      .subscribe();

    return () => {
      if (reloadTimeout) {
        clearTimeout(reloadTimeout);
      }
      supabase.removeChannel(channel);
    };
  }, [adminResolved, userAdminId]);

  // Auto-scroll functionality - Controlled by database configuration
  useEffect(() => {
    const container = scrollContainerRef.current;

    // Don't start scrolling if carousel is disabled, no announcements, or only one announcement
    if (!container || announcements.length <= 1 || !carouselEnabled || selectedAnnouncement) {
      return;
    }

    // iOS-specific optimization: Use CSS-based smooth scrolling instead of RAF
    if (isIOS) {
      console.log('[AnnouncementBoard] iOS carousel starting:', {
        announcementsCount: announcements.length,
        carouselEnabled,
        isPageVisible,
        isPageVisibleRef: isPageVisibleRef.current,
        isHovering,
        isHoveringRef: isHoveringRef.current
      });

      let scrollInterval: NodeJS.Timeout | null = null;

      const startScroll = () => {
        if (scrollInterval) return; // Already running

        console.log('[AnnouncementBoard] iOS carousel interval started', {
          initialIsPageVisible: isPageVisibleRef.current,
          initialIsHovering: isHoveringRef.current
        });

        let tickCount = 0;
        scrollInterval = setInterval(() => {
          // Use refs to get current values (avoid closure trap)
          const currentIsHovering = isHoveringRef.current;
          const currentIsPageVisible = isPageVisibleRef.current;

          // Pause scrolling when hovering or page not visible
          if (currentIsHovering || !currentIsPageVisible) {
            if (tickCount % 60 === 0) { // Log every ~1 second
              console.log('[AnnouncementBoard] iOS carousel paused:', {
                isHovering: currentIsHovering,
                isPageVisible: currentIsPageVisible
              });
            }
            tickCount++;
            return;
          }

          tickCount++;

          const { scrollTop, scrollHeight, clientHeight } = container;

          // Only scroll if content is actually scrollable
          if (scrollHeight <= clientHeight) {
            console.log('[AnnouncementBoard] iOS carousel: content not scrollable', {
              scrollHeight,
              clientHeight
            });
            return;
          }

          const contentHeight = scrollHeight / 2;
          const scrollStep = carouselSpeed * 0.5; // Slower, smoother on iOS
          const newScrollTop = scrollTop + scrollStep;

          // Log first scroll and every 3 seconds after
          if (tickCount === 1 || tickCount % 180 === 0) {
            console.log('[AnnouncementBoard] iOS carousel scrolling:', {
              tick: tickCount,
              scrollTop: Math.round(scrollTop),
              scrollHeight,
              clientHeight,
              contentHeight,
              scrollStep,
              newScrollTop: Math.round(newScrollTop)
            });
          }

          // Seamless loop
          if (newScrollTop >= contentHeight) {
            container.scrollTop = newScrollTop - contentHeight;
          } else {
            container.scrollTop = newScrollTop;
          }
        }, 16); // ~60fps
      };

      // Start scrolling after a short delay to allow content to render
      const startTimer = setTimeout(startScroll, 500);

      return () => {
        console.log('[AnnouncementBoard] iOS carousel cleanup');
        clearTimeout(startTimer);
        if (scrollInterval) {
          clearInterval(scrollInterval);
          scrollInterval = null;
        }
      };
    }

    // Standard RAF-based scrolling for non-iOS devices
    let animationFrameId: number;
    let lastScrollHeight = 0;
    let isScrolling = false;
    let startTime = 0;
    let startScrollTop = 0;
    let lastFrameTime = 0;

    const autoScroll = (timestamp: number) => {
      // Use ref to get current value (avoid closure trap)
      const currentIsHovering = isHoveringRef.current;

      // Pause scrolling when hovering
      if (currentIsHovering) {
        startTime = 0;
        lastFrameTime = 0;
        animationFrameId = requestAnimationFrame(autoScroll);
        return;
      }

      const { scrollTop, scrollHeight, clientHeight } = container;

      // Check if content height changed
      if (scrollHeight !== lastScrollHeight) {
        lastScrollHeight = scrollHeight;
        startTime = 0;
        lastFrameTime = 0;
      }

      // Only scroll if content is actually scrollable
      if (scrollHeight <= clientHeight) {
        animationFrameId = requestAnimationFrame(autoScroll);
        return;
      }

      if (!isScrolling) {
        isScrolling = true;
      }

      // Initialize start time and position
      if (!startTime) {
        startTime = timestamp;
        startScrollTop = scrollTop;
        lastFrameTime = timestamp;
      }

      // Throttle updates to ~60fps max
      const deltaTime = timestamp - lastFrameTime;
      if (deltaTime < 16) {
        animationFrameId = requestAnimationFrame(autoScroll);
        return;
      }
      lastFrameTime = timestamp;

      const elapsedTime = (timestamp - startTime) / 1000;
      const pixelsPerSecond = carouselSpeed * 60;
      const newScrollTop = startScrollTop + (elapsedTime * pixelsPerSecond);
      const contentHeight = scrollHeight / 2;

      // Seamless loop
      if (newScrollTop >= contentHeight) {
        const overflow = newScrollTop - contentHeight;
        container.scrollTop = overflow;
        startTime = timestamp;
        startScrollTop = overflow;
      } else {
        container.scrollTop = Math.round(newScrollTop * 100) / 100;
      }

      animationFrameId = requestAnimationFrame(autoScroll);
    };

    const startTimer = setTimeout(() => {
      animationFrameId = requestAnimationFrame(autoScroll);
    }, 500);

    return () => {
      clearTimeout(startTimer);
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [announcements.length, carouselEnabled, carouselSpeed, selectedAnnouncement, isIOS]);

  // Detect manual scrolling and add class to disable animations
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    let scrollTimeout: NodeJS.Timeout;
    let isScrolling = false;

    const handleScrollStart = () => {
      if (!isScrolling) {
        isScrolling = true;
        container.classList.add('scrolling');
      }

      // Clear existing timeout
      clearTimeout(scrollTimeout);

      // Set timeout to remove class after scrolling stops
      scrollTimeout = setTimeout(() => {
        isScrolling = false;
        container.classList.remove('scrolling');
      }, 150); // 150ms after scroll stops
    };

    // Listen for scroll events
    container.addEventListener('scroll', handleScrollStart, { passive: true });

    // Also listen for touch events on mobile
    container.addEventListener('touchmove', handleScrollStart, { passive: true });

    return () => {
      container.removeEventListener('scroll', handleScrollStart);
      container.removeEventListener('touchmove', handleScrollStart);
      clearTimeout(scrollTimeout);
      container.classList.remove('scrolling');
    };
  }, []);

  const loadUserAdmin = async () => {
    try {
      // Check cache first
      const cached = sessionStorage.getItem(CACHE_KEYS.ADMIN_ID);
      if (cached) {
        setUserAdminId(cached);
        setAdminResolved(true);
        return cached;
      }

      const { data, error } = await supabase
        .from('users')
        .select('created_by')
        .eq('id', userId)
        .maybeSingle();

      if (error) throw error;
      const adminId = data?.created_by || null;
      setUserAdminId(adminId);
      setAdminResolved(true);

      // Cache the result with userId
      if (adminId) {
        sessionStorage.setItem(CACHE_KEYS.ADMIN_ID, adminId);
        sessionStorage.setItem(CACHE_KEYS.CACHE_USER_ID, userId);
      }

      return adminId;
    } catch (error) {
      console.error('Error loading user admin:', error);
      setAdminResolved(true);
      return null;
    }
  };

  // Initial load with user lookup embedded in query
  const loadInitialAnnouncements = async () => {
    // Prevent duplicate loads
    if (isLoadingRef.current) {
      return;
    }

    // Don't show loading overlay on initial load to prevent black screen flash
    // Data loads fast enough that overlay is unnecessary
    try {
      // Check cache first
      const cachedAnnouncements = sessionStorage.getItem(CACHE_KEYS.ANNOUNCEMENTS);
      const cacheTime = sessionStorage.getItem(CACHE_KEYS.CACHE_TIME);

      if (cachedAnnouncements && cacheTime) {
        const age = Date.now() - parseInt(cacheTime);
        // Reduced cache duration from 5 minutes to 1 minute for fresher data
        const REDUCED_CACHE_DURATION = 60 * 1000; // 1 minute
        if (age < REDUCED_CACHE_DURATION) {
          // Use cached data immediately - already loaded in state initializer
          // No need to call setAnnouncements again
          setLoading(false);

          // Clear any pending background refresh
          if (backgroundRefreshTimeoutRef.current) {
            clearTimeout(backgroundRefreshTimeoutRef.current);
          }

          // Background refresh after 500ms to ensure data is up-to-date
          backgroundRefreshTimeoutRef.current = setTimeout(() => {
            loadAnnouncementsFromServer();
            backgroundRefreshTimeoutRef.current = null;
          }, 500);
          return;
        }
      }

      // No cache or expired, load from server immediately
      isLoadingRef.current = true;
      await loadAnnouncementsFromServer();
      isLoadingRef.current = false;
    } catch (error) {
      console.error('Error loading initial announcements:', error);
      setLoading(false);
      isLoadingRef.current = false;
    }
  };

  const loadAnnouncementsFromServer = async () => {
    try {
      // Get user's admin_id - check cache first
      let adminId: string | null = sessionStorage.getItem(CACHE_KEYS.ADMIN_ID);

      if (!adminId) {
        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('created_by')
          .eq('id', userId)
          .maybeSingle();

        if (userError) {
          console.error('Error fetching user admin:', userError);
        }

        adminId = userData?.created_by || null;
        if (adminId) {
          sessionStorage.setItem(CACHE_KEYS.ADMIN_ID, adminId);
          sessionStorage.setItem(CACHE_KEYS.CACHE_USER_ID, userId);
        }
      }

      // Build the filter - handle null adminId safely
      const orFilter = adminId
        ? `created_by.eq.${adminId},is_global.eq.true`
        : `is_global.eq.true`;

      // Load announcements without content (content is loaded on-demand)
      const { data, error } = await supabase
        .from('announcements')
        .select('id, title, is_pinned, is_global, is_hidden, pin_order, category, publish_at, created_by, created_at, updated_at')
        .lte('publish_at', new Date().toISOString())
        .eq('is_hidden', false)
        .or(orFilter)
        .order('is_pinned', { ascending: false })
        .order('publish_at', { ascending: false });

      if (error) throw error;

      const newData = data || [];

      // Cache the results with userId validation
      try {
        sessionStorage.setItem(CACHE_KEYS.ANNOUNCEMENTS, JSON.stringify(newData));
        sessionStorage.setItem(CACHE_KEYS.CACHE_TIME, Date.now().toString());
        sessionStorage.setItem(CACHE_KEYS.CACHE_USER_ID, userId);
      } catch (e) {
        // Ignore cache errors (quota exceeded, etc.)
      }

      // Only update state if data actually changed to prevent flicker
      setAnnouncements(prev => {
        if (prev.length === newData.length && JSON.stringify(prev.map(a => a.id + a.updated_at)) === JSON.stringify(newData.map(a => a.id + a.updated_at))) {
          return prev;
        }
        return newData;
      });
      setLoading(false);
    } catch (error) {
      console.error('Error loading announcements from server:', error);
      setLoading(false);
    }
  };

  const loadAnnouncements = async (skipLoadingState = false) => {
    // Never show loading overlay if we already have data — prevents visible flicker
    const hasExistingData = announcements.length > 0;
    if (!skipLoadingState && !hasExistingData) {
      setLoading(true);
    }
    try {
      // Build the filter - handle null adminId safely
      const orFilter = userAdminId
        ? `created_by.eq.${userAdminId},is_global.eq.true`
        : `is_global.eq.true`;

      const { data, error } = await supabase
        .from('announcements')
        .select('id, title, is_pinned, is_global, is_hidden, pin_order, category, publish_at, created_by, created_at, updated_at')
        .lte('publish_at', new Date().toISOString())
        .eq('is_hidden', false)
        .or(orFilter)
        .order('is_pinned', { ascending: false })
        .order('publish_at', { ascending: false });

      if (error) throw error;

      const newData = data || [];

      // Update cache with userId validation
      try {
        sessionStorage.setItem(CACHE_KEYS.ANNOUNCEMENTS, JSON.stringify(newData));
        sessionStorage.setItem(CACHE_KEYS.CACHE_TIME, Date.now().toString());
        sessionStorage.setItem(CACHE_KEYS.CACHE_USER_ID, userId);
      } catch (e) {
        // Ignore cache errors
      }

      // Invalidate content cache on realtime update
      contentCacheRef.current.clear();

      // Only update state if data actually changed
      setAnnouncements(prev => {
        if (prev.length === newData.length && JSON.stringify(prev.map(a => a.id + a.updated_at)) === JSON.stringify(newData.map(a => a.id + a.updated_at))) {
          return prev;
        }
        return newData;
      });
    } catch (error) {
      console.error('Error loading announcements:', error);
    } finally {
      if (!skipLoadingState && !hasExistingData) {
        setLoading(false);
      }
    }
  };

  return (
    <>
      {/* Mobile Overlay + Detail Modal - rendered via portal to escape stacking contexts */}
      {selectedAnnouncement && createPortal(
        <>
          {isMobileDevice && (
            <div className="fixed inset-0 bg-black/60 z-[9999]" />
          )}
          <div
            className="fixed inset-0 z-[10000] flex items-stretch justify-stretch p-0
            xl:items-center xl:justify-center xl:p-6
            overflow-hidden touch-none"
            onClick={() => setSelectedAnnouncement(null)}
            style={{
              background: isMobileDevice ? 'rgba(15, 23, 42, 0.7)' : 'rgba(15, 23, 42, 0.6)',
              backdropFilter: isMobileDevice ? 'none' : 'blur(4px)',
              WebkitBackdropFilter: isMobileDevice ? 'none' : 'blur(4px)',
              animation: isIOS ? 'none' : 'fadeIn 0.2s ease-out',
              willChange: isIOS ? 'auto' : 'opacity',
              WebkitTapHighlightColor: 'transparent',
              overscrollBehavior: 'contain'
            }}
          >
            <div
              className="relative w-full h-full
              xl:max-w-3xl xl:max-h-[85vh] xl:w-[680px] xl:h-auto
              bg-white
              rounded-none xl:rounded-2xl
              overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
              style={{
                animation: isMobileDevice ? 'none' : 'scaleIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
                boxShadow: isMobileDevice ? 'none' : '0 25px 60px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255,255,255,0.1)'
              }}
            >
              {/* Premium Blue Gradient Header */}
              <div
                className="relative flex-shrink-0 overflow-hidden"
                style={{
                  paddingTop: isMobileDevice ? 'calc(env(safe-area-inset-top) + 16px)' : '24px',
                  paddingBottom: '20px',
                  paddingLeft: '20px',
                  paddingRight: '20px',
                  background: 'linear-gradient(135deg, #1e40af 0%, #2563eb 40%, #3b82f6 70%, #1d4ed8 100%)'
                }}
              >
                <div className="absolute inset-0 pointer-events-none overflow-hidden">
                  <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/5 rounded-full blur-2xl"></div>
                  <div className="absolute -bottom-8 -left-8 w-32 h-32 bg-blue-300/10 rounded-full blur-xl"></div>
                  <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"></div>
                  <div className="absolute inset-0 opacity-[0.04]" style={{
                    backgroundImage: 'linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)',
                    backgroundSize: '32px 32px'
                  }}></div>
                </div>

                <button
                  onClick={() => setSelectedAnnouncement(null)}
                  className="absolute top-3 right-3 z-20 w-9 h-9 flex items-center justify-center rounded-xl bg-white/15 hover:bg-white/25 backdrop-blur-sm transition-colors active:bg-white/30 active:scale-90"
                  style={{
                    touchAction: 'manipulation',
                    top: isMobileDevice ? 'calc(env(safe-area-inset-top) + 12px)' : '16px'
                  }}
                  aria-label="Close"
                >
                  <X className="w-4 h-4 text-white" />
                </button>

                <div className="relative z-10">
                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    {selectedAnnouncement.is_pinned && (
                      <div className="flex items-center gap-1 px-2.5 py-1 bg-amber-500 rounded-full shadow-sm shadow-amber-700/30">
                        <Pin className="w-3 h-3 text-white fill-white" />
                        <span className="text-[10px] font-bold text-white uppercase tracking-wider">{t.announcements.pinned}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 px-2.5 py-1 bg-white/15 rounded-full border border-white/20">
                      <Calendar className="w-3 h-3 text-blue-100" />
                      <span className="text-[10px] sm:text-xs text-blue-50 font-medium">
                        {new Date(selectedAnnouncement.publish_at).toLocaleDateString(dateLocale, {
                          month: 'long',
                          day: 'numeric',
                          year: 'numeric'
                        })}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 p-2.5 bg-white/15 backdrop-blur-sm rounded-xl border border-white/20 shadow-lg shadow-blue-900/20">
                      {(() => {
                        const CategoryIcon = getCategoryIcon(selectedAnnouncement);
                        return <CategoryIcon className="w-6 h-6 text-white" />;
                      })()}
                    </div>
                    <h2 className="text-lg sm:text-xl font-bold text-white leading-snug break-words pr-8">
                      {selectedAnnouncement.title}
                    </h2>
                  </div>
                </div>

                <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-blue-400/30 via-blue-300/50 to-blue-400/30"></div>
              </div>

              {/* Content Area */}
              <div
                className="relative flex-1 overflow-y-auto min-h-0 hide-scrollbar"
                style={{
                  WebkitOverflowScrolling: 'touch',
                  scrollbarWidth: 'none',
                  msOverflowStyle: 'none',
                  padding: isMobileDevice ? '16px' : '24px'
                }}
              >
                <div className="relative" style={{ minHeight: contentLoading ? '60vh' : 'auto' }}>
                  {contentLoading ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ animation: 'content-fade-in 0.3s ease-out' }}>
                      {/* Large centered loading spinner */}
                      <div className="relative mb-8">
                        <div className="w-16 h-16 rounded-full border-4 border-blue-100" style={{ animation: 'content-pulse-ring 2s ease-in-out infinite' }}></div>
                        <div className="absolute inset-0 w-16 h-16 rounded-full border-4 border-transparent border-t-blue-500 border-r-blue-400" style={{ animation: 'content-spinner 0.8s linear infinite' }}></div>
                        <div className="absolute inset-2 w-12 h-12 rounded-full border-4 border-transparent border-b-blue-300 border-l-blue-200" style={{ animation: 'content-spinner 1.2s linear infinite reverse' }}></div>
                      </div>

                      {/* Animated progress bar */}
                      <div className="w-48 h-1.5 bg-blue-100 rounded-full overflow-hidden mb-4">
                        <div className="h-full bg-gradient-to-r from-blue-400 via-blue-500 to-blue-400 rounded-full" style={{ animation: 'content-progress-bar 1.5s ease-in-out infinite', backgroundSize: '200% 100%' }}></div>
                      </div>

                      {/* Loading text with dot animation */}
                      <div className="flex items-center gap-1 text-blue-500">
                        <span className="text-base font-medium">Loading content</span>
                        <span className="flex gap-0.5">
                          <span className="w-1.5 h-1.5 bg-blue-400 rounded-full" style={{ animation: 'content-bounce-dot 1.4s ease-in-out infinite' }}></span>
                          <span className="w-1.5 h-1.5 bg-blue-400 rounded-full" style={{ animation: 'content-bounce-dot 1.4s ease-in-out infinite 0.2s' }}></span>
                          <span className="w-1.5 h-1.5 bg-blue-400 rounded-full" style={{ animation: 'content-bounce-dot 1.4s ease-in-out infinite 0.4s' }}></span>
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div
                      className="relative announcement-content mobile-content"
                      style={{ fontSize: '15px', lineHeight: '1.75', color: '#374151' }}
                      dangerouslySetInnerHTML={{ __html: sanitizedSelectedContent }}
                    />
                  )}
                </div>
              </div>

              {/* Footer */}
              <div
                className="relative flex-shrink-0 border-t border-slate-100 bg-slate-50/80 hidden sm:flex"
                style={{
                  paddingTop: '12px',
                  paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)',
                  paddingLeft: '20px',
                  paddingRight: '20px',
                  minHeight: '68px'
                }}
              >
                <button
                  onClick={() => setSelectedAnnouncement(null)}
                  className="relative w-full px-5 py-3 min-h-[44px] bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 active:from-blue-800 active:to-blue-700 text-white font-semibold text-sm rounded-xl transition-all duration-200 shadow-md shadow-blue-600/20 hover:shadow-lg hover:shadow-blue-600/30 active:scale-[0.98]"
                  style={{ touchAction: 'manipulation' }}
                >
                  {t.common.close}
                </button>
              </div>
            </div>
          </div>
        </>,
        document.body
      )}

      <style>{`
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }

        @keyframes float {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          50% { transform: translateY(-10px) rotate(5deg); }
        }

        @keyframes glow-pulse {
          0%, 100% { opacity: 0.5; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.05); }
        }

        @keyframes scan-line {
          0% { transform: translateY(-100%); opacity: 0; }
          50% { opacity: 1; }
          100% { transform: translateY(100%); opacity: 0; }
        }

        @keyframes border-flow {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }

        @keyframes particle-float {
          0% { transform: translate(0, 0) scale(1); opacity: 0; }
          50% { opacity: 0.8; }
          100% { transform: translate(100px, -100px) scale(0); opacity: 0; }
        }

        @keyframes aurora {
          0% { transform: translateX(-100%) translateY(-50%) rotate(0deg); opacity: 0.3; }
          50% { opacity: 0.6; }
          100% { transform: translateX(100%) translateY(-50%) rotate(360deg); opacity: 0.3; }
        }

        @keyframes shimmer-slide {
          0% { transform: translateX(-100%) skewX(-15deg); }
          100% { transform: translateX(200%) skewX(-15deg); }
        }

        @keyframes pulse-ring {
          0% { transform: scale(0.8); opacity: 1; }
          100% { transform: scale(1.8); opacity: 0; }
        }

        @keyframes rotate-slow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        @keyframes wave {
          0%, 100% { transform: translateX(0) translateY(0); }
          25% { transform: translateX(5px) translateY(-5px); }
          50% { transform: translateX(0) translateY(-10px); }
          75% { transform: translateX(-5px) translateY(-5px); }
        }

        @keyframes gradient-shift {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }

        @keyframes morph {
          0%, 100% { border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%; }
          50% { border-radius: 30% 60% 70% 40% / 50% 60% 30% 60%; }
        }

        @keyframes float-diagonal {
          0% { transform: translate(0, 0) rotate(0deg); opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { transform: translate(150px, -150px) rotate(180deg); opacity: 0; }
        }
      `}</style>
      <div className={`relative rounded-2xl border-0 lg:border-2 lg:border-blue-500/80 shadow-none lg:shadow-xl lg:shadow-blue-200/50 ${isMobileDevice ? 'p-0' : 'p-0 lg:p-8'} overflow-hidden max-sm:fixed max-sm:bottom-[56px] max-sm:left-0 max-sm:right-0 max-sm:z-[45] max-sm:flex max-sm:flex-col max-sm:rounded-none sm:fixed sm:bottom-[64px] sm:left-0 sm:right-0 sm:z-[45] sm:flex sm:flex-col sm:rounded-none md:fixed md:bottom-[64px] md:left-0 md:right-0 md:z-[45] md:flex md:flex-col md:rounded-none lg:relative lg:top-auto lg:bottom-auto lg:left-auto lg:right-auto lg:z-auto lg:flex lg:flex-col lg:rounded-2xl lg:pb-0`}
        style={{
          willChange: 'auto',
          top: window.innerWidth >= 1025 ? 'auto' : window.innerWidth >= 768 ? '72px' : window.innerWidth >= 640 ? '68px' : '64px',
          height: window.innerWidth >= 1025 ? 'calc(100vh - 220px)' : undefined,
          background: isMobileDevice
            ? 'linear-gradient(160deg, #ffffff 0%, #f0f7ff 40%, #e8f4fd 100%)'
            : 'linear-gradient(145deg, #ffffff 0%, #f0f7ff 25%, #e6f2fe 50%, #f5faff 75%, #ffffff 100%)',
        }}>

        {/* Loading Overlay - Simplified for mobile */}
        {loading && (
          <div className="absolute inset-0 bg-white/95 z-50 flex items-center justify-center max-sm:rounded-none md:rounded-none lg:rounded-2xl">
            <div className="flex flex-col items-center gap-4">
              <div className="relative w-16 h-16">
                <div className="absolute inset-0 rounded-full border-2 border-blue-300 animate-spin" style={{ animationDuration: '1s' }}></div>
                {showDesktopEffects && <div className="absolute inset-2 rounded-full border-2 border-blue-400 animate-spin" style={{ animationDuration: '0.8s', animationDirection: 'reverse' }}></div>}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-6 h-6 rounded-full bg-blue-100 animate-pulse"></div>
                </div>
              </div>
              <div className="text-sm text-blue-600 font-medium">Loading...</div>
            </div>
          </div>
        )}

        {/* Mobile Background - Trade/Supply chain pattern */}
        {!selectedAnnouncement && !showDesktopEffects && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div
            className="absolute top-0 left-0 right-0 h-40 opacity-50"
            style={{ background: 'linear-gradient(180deg, rgba(37,99,235,0.04) 0%, transparent 100%)' }}
          ></div>
          <div
            className="absolute bottom-0 right-0 w-56 h-56 opacity-25"
            style={{ background: 'radial-gradient(circle, rgba(37,99,235,0.06) 0%, transparent 70%)' }}
          ></div>
          {/* Supply chain dotted route lines */}
          <svg className="absolute inset-0 w-full h-full opacity-[0.035]" xmlns="http://www.w3.org/2000/svg">
            <pattern id="trade-dots-mobile" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
              <circle cx="20" cy="20" r="1" fill="#2563eb" />
            </pattern>
            <rect width="100%" height="100%" fill="url(#trade-dots-mobile)" />
          </svg>
        </div>
        )}

        {/* Desktop background - Supply chain / Trade themed decorative pattern */}
        {!selectedAnnouncement && showDesktopEffects && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {/* Soft gradient orbs */}
          <div className="absolute -top-20 -right-20 w-[450px] h-[450px] opacity-40" style={{ background: 'radial-gradient(circle, rgba(37,99,235,0.06) 0%, transparent 55%)' }}></div>
          <div className="absolute -bottom-16 -left-16 w-[380px] h-[380px] opacity-35" style={{ background: 'radial-gradient(circle, rgba(14,165,233,0.05) 0%, transparent 55%)' }}></div>
          <div className="absolute top-1/3 right-1/4 w-[300px] h-[300px] opacity-25" style={{ background: 'radial-gradient(circle, rgba(59,130,246,0.04) 0%, transparent 50%)' }}></div>

          {/* Grid dot pattern - resembling logistics network nodes */}
          <svg className="absolute inset-0 w-full h-full opacity-[0.03]" xmlns="http://www.w3.org/2000/svg">
            <pattern id="trade-grid" x="0" y="0" width="48" height="48" patternUnits="userSpaceOnUse">
              <circle cx="24" cy="24" r="1.2" fill="#1e40af" />
            </pattern>
            <rect width="100%" height="100%" fill="url(#trade-grid)" />
          </svg>

          {/* Trade route path - curved supply chain line */}
          <svg className="absolute top-0 left-0 w-full h-full opacity-[0.06]" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" viewBox="0 0 800 600">
            <path d="M-50 300 C100 200, 250 400, 400 280 S650 150, 850 320" stroke="#3b82f6" strokeWidth="1.5" fill="none" strokeDasharray="8 6" />
            <path d="M-30 450 C150 350, 300 500, 500 380 S700 250, 850 420" stroke="#0ea5e9" strokeWidth="1" fill="none" strokeDasharray="6 8" />
          </svg>

          {/* Logistics nodes / waypoints */}
          <svg className="absolute top-0 left-0 w-full h-full opacity-[0.07]" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" viewBox="0 0 800 600">
            {/* Ship/cargo icon simplified */}
            <rect x="680" y="80" width="28" height="18" rx="3" stroke="#2563eb" strokeWidth="1" fill="none" />
            <path d="M680 98 L694 108 L708 98" stroke="#2563eb" strokeWidth="1" fill="none" />
            {/* Container box */}
            <rect x="90" y="140" width="22" height="16" rx="2" stroke="#0369a1" strokeWidth="0.8" fill="none" />
            <line x1="101" y1="140" x2="101" y2="156" stroke="#0369a1" strokeWidth="0.5" />
            {/* Globe / world trade */}
            <circle cx="400" cy="520" r="18" stroke="#3b82f6" strokeWidth="0.8" fill="none" />
            <ellipse cx="400" cy="520" rx="8" ry="18" stroke="#3b82f6" strokeWidth="0.5" fill="none" />
            <line x1="382" y1="520" x2="418" y2="520" stroke="#3b82f6" strokeWidth="0.5" />
            {/* Warehouse */}
            <path d="M60 430 L80 418 L100 430 L100 450 L60 450 Z" stroke="#1d4ed8" strokeWidth="0.8" fill="none" />
            {/* Arrow / shipping direction */}
            <path d="M720 480 L740 470 L740 475 L760 475 L760 485 L740 485 L740 490 Z" stroke="#2563eb" strokeWidth="0.7" fill="none" />
            {/* Connection dots along routes */}
            <circle cx="200" cy="350" r="4" stroke="#3b82f6" strokeWidth="0.8" fill="rgba(59,130,246,0.08)" />
            <circle cx="500" cy="300" r="4" stroke="#3b82f6" strokeWidth="0.8" fill="rgba(59,130,246,0.08)" />
            <circle cx="650" cy="220" r="3.5" stroke="#0ea5e9" strokeWidth="0.7" fill="rgba(14,165,233,0.06)" />
            <circle cx="320" cy="180" r="3" stroke="#1d4ed8" strokeWidth="0.7" fill="rgba(29,78,216,0.06)" />
          </svg>

          {/* Subtle horizontal accent lines - like shipping lanes */}
          <div className="absolute top-[15%] left-0 right-0 h-px opacity-[0.04]" style={{ background: 'linear-gradient(90deg, transparent 0%, #3b82f6 20%, #3b82f6 80%, transparent 100%)' }}></div>
          <div className="absolute top-[75%] left-0 right-0 h-px opacity-[0.03]" style={{ background: 'linear-gradient(90deg, transparent 0%, #0ea5e9 30%, #0ea5e9 70%, transparent 100%)' }}></div>
        </div>
        )}

        <div className="relative flex flex-col flex-1 min-h-0 overflow-hidden">
          {/* Premium Blue Header Card */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-4 mb-4 sm:mb-6
            flex-shrink-0 max-sm:px-4 max-sm:pt-4
            sm:px-4 sm:pt-4
            md:px-4 md:pt-4
            lg:px-0 lg:pt-0">
            <div className="relative flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-3 sm:py-4 bg-gradient-to-r from-blue-600 via-blue-500 to-blue-600 rounded-xl overflow-hidden shadow-lg shadow-blue-600/25">
              {/* Shimmer effect */}
              {showDesktopEffects && (
              <div className="absolute inset-0 overflow-hidden">
                <div className="absolute inset-0 opacity-20" style={{
                  backgroundImage: 'linear-gradient(135deg, transparent 40%, rgba(255,255,255,0.3) 50%, transparent 60%)',
                  backgroundSize: '200% 200%',
                  animationName: 'shimmer-slide',
                  animationDuration: '3s',
                  animationTimingFunction: 'ease-in-out',
                  animationIterationCount: 'infinite'
                }}></div>
              </div>
              )}
              {/* Subtle pattern overlay */}
              <div className="absolute inset-0 opacity-10" style={{
                backgroundImage: 'radial-gradient(circle at 20% 50%, rgba(255,255,255,0.3) 0%, transparent 50%), radial-gradient(circle at 80% 50%, rgba(255,255,255,0.2) 0%, transparent 40%)'
              }}></div>

              <div className="relative flex-shrink-0 p-2 sm:p-2.5 bg-white/20 backdrop-blur-sm rounded-lg border border-white/30">
                <Bell className="w-5 h-5 sm:w-5 sm:h-5 text-white" />
              </div>
              <div className="relative flex-1 min-w-0">
                <h2 className="text-lg sm:text-xl font-bold tracking-tight text-white">
                  {t.announcements.title}
                </h2>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <div className="w-1.5 h-1.5 bg-green-300 rounded-full animate-pulse"></div>
                  <span className="text-[10px] sm:text-xs text-blue-100 font-medium tracking-wider uppercase">{t.announcements.liveUpdates}</span>
                </div>
              </div>
              <div className="relative flex items-center gap-1.5 px-3 py-1.5 bg-white/20 backdrop-blur-sm rounded-lg border border-white/30">
                <Sparkles className="w-3.5 h-3.5 text-blue-100" />
                <span className="text-sm font-bold text-white">{announcements.length}</span>
                <span className="text-[10px] text-blue-200 font-medium">{t.announcements.total}</span>
              </div>
            </div>
          </div>

          {announcements.length === 0 ? (
            <div className="text-center py-16 max-sm:px-6 sm:px-6 md:px-6">
              <div className="relative inline-flex flex-col items-center gap-4 p-12 rounded-2xl bg-blue-50/50 border border-blue-100">
                <div className="relative">
                  <div className="absolute inset-0 bg-blue-200/50 rounded-full blur-xl animate-pulse"></div>
                  <Radio className="relative w-16 h-16 text-blue-300" />
                </div>
                <div className="text-slate-600 font-medium">{t.announcements.noAnnouncements}</div>
                <div className="text-xs text-blue-400">{t.announcements.checkBackLater}</div>
              </div>
            </div>
          ) : (
            <div className="relative flex-1 min-h-0 flex flex-col">
              <div
                ref={scrollContainerRef}
                onMouseEnter={() => !isIOS && setIsHovering(true)}
                onMouseLeave={() => !isIOS && setIsHovering(false)}
                onTouchStart={() => {
                  if (isIOS) {
                    // On iOS, only pause temporarily during touch
                    setIsHovering(true);
                    // Clear any existing timeout
                    if (touchTimeoutRef.current) {
                      clearTimeout(touchTimeoutRef.current);
                    }
                    // Auto-resume after 2 seconds
                    touchTimeoutRef.current = setTimeout(() => {
                      setIsHovering(false);
                    }, 2000);
                  } else {
                    setIsHovering(true);
                  }
                }}
                onTouchEnd={() => {
                  if (!isIOS) {
                    setIsHovering(false);
                  }
                  // On iOS, let the timeout handle it
                }}
                className={`overflow-y-auto hide-scrollbar flex-1 min-h-0
                  max-sm:px-6 max-sm:pb-2
                  sm:px-6 sm:pb-2
                  md:px-6 md:pb-2
                  lg:px-0 lg:pb-2 lg:pr-2 ${
                  isTabletDevice ? 'space-y-3' : 'space-y-3 sm:space-y-4'
                }`}
                style={{
                  scrollbarWidth: 'none',
                  msOverflowStyle: 'none',
                  scrollBehavior: 'auto',
                  WebkitOverflowScrolling: 'touch',
                }}
              >
              {/* Render announcements - duplicate for carousel when enabled */}
              {(carouselEnabled && announcements.length > 1 && !isTabletDevice ? [...announcements, ...announcements] : announcements).map((announcement, index) => {
                const cardColorVariants = [
                  { gradient: 'from-blue-50 via-white to-sky-50', ring: 'ring-blue-200/80', accent: 'from-blue-500 via-sky-400 to-cyan-400', iconBg: 'bg-gradient-to-br from-blue-500 to-sky-500', patternColor: 'border-blue-200', hoverShadow: 'hover:shadow-blue-100/60' },
                  { gradient: 'from-sky-50 via-white to-cyan-50', ring: 'ring-sky-200/80', accent: 'from-sky-500 via-cyan-400 to-teal-400', iconBg: 'bg-gradient-to-br from-sky-500 to-cyan-500', patternColor: 'border-sky-200', hoverShadow: 'hover:shadow-sky-100/60' },
                  { gradient: 'from-cyan-50 via-white to-blue-50', ring: 'ring-cyan-200/80', accent: 'from-cyan-500 via-blue-400 to-sky-400', iconBg: 'bg-gradient-to-br from-cyan-500 to-blue-500', patternColor: 'border-cyan-200', hoverShadow: 'hover:shadow-cyan-100/60' },
                ];
                const pinnedStyle = { gradient: 'from-amber-50 via-white to-orange-50', ring: 'ring-amber-200/80', accent: 'from-amber-500 via-orange-400 to-yellow-400', iconBg: 'bg-gradient-to-br from-amber-500 to-orange-500', patternColor: 'border-amber-200', hoverShadow: 'hover:shadow-amber-100/60' };
                const cardStyle = announcement.is_pinned ? pinnedStyle : cardColorVariants[index % cardColorVariants.length];
                const CategoryIcon = getCategoryIcon(announcement);
                const categoryColor = getCategoryColor(announcement);

                return (
                <div
                  key={`${announcement.id}-${index}`}
                  onClick={() => handleAnnouncementClick(announcement)}
                  className={`group relative rounded-2xl overflow-hidden cursor-pointer transition-all duration-300 active:scale-[0.98] hover:-translate-y-0.5 hover:shadow-xl bg-gradient-to-br ${cardStyle.gradient} ring-1 ${cardStyle.ring} shadow-sm ${cardStyle.hoverShadow}`}
                  style={{
                    ...(isTabletDevice ? {
                      animation: showDesktopEffects && index < announcements.length ? `fadeInUp 0.4s ease-out ${(index % announcements.length) * 0.05}s both` : 'none',
                    } :
                    isMobileDevice ? {
                      willChange: 'auto',
                    } : {
                      animation: showDesktopEffects && index < announcements.length ? `fadeInUp 0.5s ease-out ${(index % announcements.length) * 0.08}s both` : 'none',
                    })
                  }}
                >
                  {/* Left accent bar */}
                  <div className={`absolute left-0 top-0 bottom-0 w-1.5 bg-gradient-to-b ${cardStyle.accent} rounded-l-2xl`}></div>

                  {/* Decorative pattern blocks */}
                  <div className="absolute top-0 right-0 w-32 h-full overflow-hidden pointer-events-none opacity-[0.06]">
                    <div className={`absolute top-3 right-3 w-14 h-14 border-2 ${cardStyle.patternColor} rounded-2xl rotate-12`} />
                    <div className={`absolute bottom-2 right-8 w-9 h-9 border-2 ${cardStyle.patternColor} rounded-lg -rotate-6`} />
                    <div className={`absolute top-1/2 right-2 w-5 h-5 border-2 ${cardStyle.patternColor} rounded-full`} />
                  </div>

                  {/* Color accent corner */}
                  <div className="absolute top-0 right-0 w-20 h-20 overflow-hidden pointer-events-none">
                    <div className={`absolute -top-10 -right-10 w-20 h-20 bg-gradient-to-bl ${cardStyle.accent} opacity-[0.08] rounded-full`} />
                  </div>

                  <div className={`relative p-4 sm:p-5 pl-5 sm:pl-6`}>
                    <div className="flex items-start gap-3.5">
                      {/* Category icon block */}
                      <div className={`flex-shrink-0 w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center shadow-sm ${cardStyle.iconBg}`}>
                        <CategoryIcon className="w-4.5 h-4.5 sm:w-5 sm:h-5 text-white" />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        {/* Title row */}
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            {announcement.is_pinned && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-500 rounded-md shadow-sm shadow-amber-200/50 flex-shrink-0">
                                <Pin className="w-2.5 h-2.5 text-white fill-white" />
                                <span className="text-[10px] sm:text-[11px] font-bold text-white uppercase tracking-wider">{t.announcements.pinned}</span>
                              </span>
                            )}
                            <h3 className={`font-semibold text-slate-800 group-hover:text-blue-700 transition-colors leading-snug ${
                              isTabletDevice ? 'text-[15px] line-clamp-2' : 'text-sm sm:text-[15px] line-clamp-1'
                            }`}>
                              {announcement.title}
                            </h3>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0 text-blue-500 group-hover:text-blue-600">
                            <span className="text-[10px] font-bold hidden sm:inline">{t.announcements.view}</span>
                            <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                          </div>
                        </div>

                        {/* Preview text */}
                        {/* Bottom meta row */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1.5 text-[10px] sm:text-[11px] px-2.5 py-0.5 rounded-md font-medium bg-white/80 ring-1 ring-blue-100 text-blue-600">
                              <Calendar className="w-3 h-3" />
                              {new Date(announcement.publish_at).toLocaleDateString(dateLocale, {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric'
                              })}
                            </span>
                            {announcement.category && (
                              <span
                                className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md font-bold uppercase tracking-wider ring-1"
                                style={{
                                  backgroundColor: `${categoryColor}15`,
                                  color: categoryColor,
                                  borderColor: `${categoryColor}40`,
                                  boxShadow: `0 0 0 1px ${categoryColor}30`
                                }}
                              >
                                {translateCategory(announcement.category)}
                              </span>
                            )}
                          </div>
                          {announcement.is_pinned && (
                            <div className="flex items-center gap-1">
                              <div className="w-2 h-2 bg-amber-500 rounded-full" />
                              <div className="w-2 h-2 bg-amber-500 rounded-full animate-ping opacity-75 absolute" style={{ right: announcement.category ? '8px' : '16px' }} />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                );
              })}
              </div>
            </div>
          )}
        </div>
      </div>


      <style>{`
        @keyframes shimmer {
          0% { background-position: -250% 0; }
          100% { background-position: 250% 0; }
        }
        @keyframes content-fade-in {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes content-spinner {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes content-pulse-ring {
          0%, 100% { transform: scale(1); opacity: 0.5; }
          50% { transform: scale(1.1); opacity: 1; }
        }
        @keyframes content-progress-bar {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(0%); }
          100% { transform: translateX(100%); }
        }
        @keyframes content-bounce-dot {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-6px); opacity: 1; }
        }
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes scaleIn {
          from {
            opacity: 0;
            transform: scale(0.9);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        .animate-fadeIn {
          animation: fadeIn 0.2s ease-out;
        }
        .animate-scaleIn {
          animation: scaleIn 0.3s ease-out;
        }

        /* Safe area support for mobile devices */
        .max-sm\:pt-safe {
          padding-top: max(1rem, env(safe-area-inset-top));
        }
        .max-sm\:pb-safe {
          padding-bottom: max(1rem, env(safe-area-inset-bottom));
        }
        .line-clamp-2 {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .scrollbar-thin::-webkit-scrollbar {
          width: 6px;
        }
        .scrollbar-thin::-webkit-scrollbar-track {
          background: rgba(15, 23, 42, 0.3);
          border-radius: 3px;
        }
        .scrollbar-thin::-webkit-scrollbar-thumb {
          background: rgba(59, 130, 246, 0.3);
          border-radius: 3px;
        }
        .scrollbar-thin::-webkit-scrollbar-thumb:hover {
          background: rgba(59, 130, 246, 0.5);
        }
        .modal-scrollbar::-webkit-scrollbar {
          width: 8px;
        }
        .modal-scrollbar::-webkit-scrollbar-track {
          background: rgba(15, 23, 42, 0.4);
          border-radius: 4px;
        }
        .modal-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(59, 130, 246, 0.4);
          border-radius: 4px;
        }
        .modal-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(59, 130, 246, 0.6);
        }

        /* Mobile content styles - Clean, structured typography on white */
        @media (max-width: 640px) {
          .mobile-content {
            font-size: 15px !important;
            line-height: 1.75 !important;
            word-wrap: break-word;
            overflow-wrap: break-word;
            padding-left: 4px !important;
            padding-right: 4px !important;
            color: #374151 !important;
            letter-spacing: 0.01em;
          }

          .mobile-content > *:first-child {
            margin-top: 0 !important;
          }

          .mobile-content h1 {
            font-size: 1.375rem !important;
            line-height: 1.3 !important;
            margin-top: 1.75rem !important;
            margin-bottom: 0.75rem !important;
            font-weight: 700 !important;
            color: #111827 !important;
            letter-spacing: -0.02em;
            padding-bottom: 0.5rem !important;
            border-bottom: 1px solid #e5e7eb !important;
          }

          .mobile-content h2 {
            font-size: 1.2rem !important;
            line-height: 1.35 !important;
            margin-top: 1.5rem !important;
            margin-bottom: 0.625rem !important;
            font-weight: 700 !important;
            color: #1f2937 !important;
            letter-spacing: -0.01em;
          }

          .mobile-content h3 {
            font-size: 1.075rem !important;
            line-height: 1.4 !important;
            margin-top: 1.25rem !important;
            margin-bottom: 0.5rem !important;
            font-weight: 600 !important;
            color: #1f2937 !important;
          }

          .mobile-content h4 {
            font-size: 1rem !important;
            line-height: 1.4 !important;
            margin-top: 1rem !important;
            margin-bottom: 0.5rem !important;
            font-weight: 600 !important;
            color: #374151 !important;
          }

          .mobile-content p {
            margin-top: 0 !important;
            margin-bottom: 1rem !important;
            line-height: 1.75 !important;
            font-size: 15px !important;
            color: #374151 !important;
          }

          .mobile-content h1 + p,
          .mobile-content h2 + p,
          .mobile-content h3 + p,
          .mobile-content h4 + p {
            margin-top: 0 !important;
          }

          .mobile-content p + p {
            margin-top: 0 !important;
          }

          .mobile-content ul,
          .mobile-content ol {
            margin-top: 0.5rem !important;
            margin-bottom: 1rem !important;
            padding-left: 1.5rem !important;
            font-size: 15px !important;
          }

          .mobile-content li {
            margin-top: 0.375rem !important;
            margin-bottom: 0.375rem !important;
            line-height: 1.7 !important;
            color: #374151 !important;
            padding-left: 0.25rem !important;
          }

          .mobile-content li ul,
          .mobile-content li ol {
            margin-top: 0.375rem !important;
            margin-bottom: 0.375rem !important;
          }

          .mobile-content ul li::marker {
            color: #6b7280;
          }

          .mobile-content ol li::marker {
            color: #6b7280;
            font-weight: 600;
          }

          .mobile-content strong,
          .mobile-content b {
            font-weight: 700 !important;
            color: #111827 !important;
          }

          .mobile-content em,
          .mobile-content i {
            font-style: italic;
            color: #4b5563 !important;
          }

          .mobile-content a {
            color: #2563eb !important;
            text-decoration: none !important;
            font-weight: 500 !important;
            border-bottom: 1px solid rgba(37, 99, 235, 0.3) !important;
            padding-bottom: 1px !important;
            transition: all 0.2s ease;
          }

          .mobile-content a:active {
            color: #1d4ed8 !important;
            border-bottom-color: rgba(29, 78, 216, 0.6) !important;
          }

          .mobile-content blockquote {
            margin: 1rem 0 !important;
            padding: 0.75rem 1rem !important;
            border-left: 3px solid #3b82f6;
            background: #f8fafc;
            border-radius: 0 0.5rem 0.5rem 0;
            font-size: 14px !important;
            line-height: 1.7 !important;
            color: #4b5563 !important;
          }

          .mobile-content blockquote p {
            margin-bottom: 0.5rem !important;
            color: #4b5563 !important;
          }

          .mobile-content blockquote p:last-child {
            margin-bottom: 0 !important;
          }

          .mobile-content code {
            font-size: 13px !important;
            padding: 0.2rem 0.4rem !important;
            background: #f1f5f9;
            border: 1px solid #e2e8f0;
            border-radius: 4px;
            color: #1e40af !important;
            font-family: ui-monospace, 'SF Mono', Monaco, Menlo, Consolas, monospace;
          }

          .mobile-content pre {
            font-size: 13px !important;
            padding: 1rem !important;
            margin: 1rem 0 !important;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
            background: #1e293b;
            border: 1px solid #334155;
            border-radius: 0.625rem;
            line-height: 1.6 !important;
          }

          .mobile-content pre code {
            padding: 0 !important;
            background: transparent;
            border: none;
            font-size: 13px !important;
            color: #e2e8f0 !important;
          }

          .mobile-content table {
            font-size: 13px !important;
            display: block;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
            margin: 1rem 0 !important;
            border-collapse: collapse;
            width: 100%;
            background: white;
            border-radius: 0.5rem;
            border: 1px solid #e5e7eb;
          }

          .mobile-content th,
          .mobile-content td {
            padding: 0.625rem 0.75rem !important;
            border-bottom: 1px solid #f3f4f6;
            text-align: left;
          }

          .mobile-content th {
            background: #f9fafb;
            color: #374151 !important;
            font-weight: 600 !important;
            font-size: 12px !important;
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }

          .mobile-content td {
            color: #4b5563 !important;
          }

          .mobile-content hr {
            margin: 1.5rem 0 !important;
            border: none;
            height: 1px;
            background: #e5e7eb;
          }

          .mobile-content img {
            margin: 1rem 0 !important;
            border-radius: 0.5rem !important;
          }
        }

        /* Base announcement content typography */
        .announcement-content h1,
        .announcement-content h2,
        .announcement-content h3,
        .announcement-content h4 {
          color: #111827;
          font-weight: 700;
          margin-top: 1.5em;
          margin-bottom: 0.5em;
        }
        .announcement-content h1 { font-size: 1.5rem; line-height: 1.3; }
        .announcement-content h2 { font-size: 1.25rem; line-height: 1.35; }
        .announcement-content h3 { font-size: 1.125rem; line-height: 1.4; font-weight: 600; }
        .announcement-content h4 { font-size: 1rem; line-height: 1.4; font-weight: 600; }
        .announcement-content h1:first-child,
        .announcement-content h2:first-child,
        .announcement-content h3:first-child,
        .announcement-content h4:first-child {
          margin-top: 0;
        }
        .announcement-content p {
          margin-top: 0;
          margin-bottom: 1em;
          color: #374151;
        }
        .announcement-content ul,
        .announcement-content ol {
          margin-top: 0.5em;
          margin-bottom: 1em;
          padding-left: 1.5em;
        }
        .announcement-content li {
          margin-bottom: 0.375em;
          color: #374151;
        }
        .announcement-content strong,
        .announcement-content b {
          font-weight: 700;
          color: #111827;
        }
        .announcement-content a {
          color: #2563eb;
          text-decoration: none;
          border-bottom: 1px solid rgba(37, 99, 235, 0.3);
        }
        .announcement-content blockquote {
          margin: 1em 0;
          padding: 0.75em 1em;
          border-left: 3px solid #3b82f6;
          background: #f8fafc;
          border-radius: 0 0.375rem 0.375rem 0;
          color: #4b5563;
        }
        .announcement-content blockquote p {
          margin-bottom: 0.5em;
          color: #4b5563;
        }
        .announcement-content blockquote p:last-child {
          margin-bottom: 0;
        }
        .announcement-content hr {
          margin: 1.5em 0;
          border: none;
          height: 1px;
          background: #e5e7eb;
        }

        /* Announcement content image styles */
        .announcement-content img {
          margin: 1rem 0;
          border-radius: 0.75rem;
          border: 1px solid #e2e8f0;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.08), 0 2px 4px -1px rgba(0, 0, 0, 0.04);
          max-width: 100%;
          height: auto;
          display: block;
          background: #f8fafc;
          transition: all 0.3s ease;
        }

        @media (min-width: 640px) {
          .announcement-content img {
            margin: 1.5rem 0;
          }
          .announcement-content img:hover {
            border-color: #bfdbfe;
            box-shadow: 0 10px 15px -3px rgba(37, 99, 235, 0.1), 0 4px 6px -2px rgba(37, 99, 235, 0.05);
            transform: scale(1.01);
          }
        }

        /* Video wrapper - minimal container, no border (reduce whitespace) */
        .announcement-content .video-wrapper {
          margin: 1rem auto !important;
          position: relative !important;
          max-width: 100% !important;
          width: fit-content !important;
          width: -moz-fit-content !important;
          width: -webkit-fit-content !important;
          display: block !important;
        }

        @media (min-width: 640px) {
          .announcement-content .video-wrapper {
            margin: 1.5rem auto !important;
          }
        }

        /* Video element - with border (inner border) */
        .announcement-content video {
          width: 100%;
          max-width: min(800px, 100%);
          height: auto;
          display: block;
          border: 1px solid #e2e8f0;
          border-radius: 0.75rem;
          background: #0f172a;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
          position: relative;
          object-fit: contain;
          vertical-align: middle;
        }

        @media (min-width: 640px) {
          .announcement-content video {
            border-radius: 1rem;
            box-shadow: 0 6px 16px rgba(0, 0, 0, 0.12);
          }
        }

        /* Mobile optimization - full width */
        @media (max-width: 639px) {
          .announcement-content .video-wrapper {
            width: 100% !important;
            display: block !important;
            margin: 1.5rem 0 !important;
          }
        }

        /* Play button styling */
        .video-play-btn {
          filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.5));
        }

        .video-play-btn:hover {
          filter: drop-shadow(0 4px 16px rgba(96, 165, 250, 0.6));
        }

        /* Hide loading state immediately */
        .video-wrapper video::-webkit-media-controls {
          display: none !important;
        }

        .video-wrapper video::-webkit-media-controls-enclosure {
          display: none !important;
        }

        /* Video loading animations - Matches modal style */
        @keyframes pulse-radial {
          0%, 100% {
            opacity: 0.5;
            transform: scale(1);
          }
          50% {
            opacity: 0.8;
            transform: scale(1.03);
          }
        }

        @keyframes corner-fade {
          0%, 100% {
            opacity: 0.3;
          }
          50% {
            opacity: 0.7;
          }
        }

        @keyframes pulse-play {
          0%, 100% {
            opacity: 0.9;
            filter: drop-shadow(0 0 8px rgba(96, 165, 250, 0.6));
          }
          50% {
            opacity: 1;
            filter: drop-shadow(0 0 12px rgba(96, 165, 250, 0.8));
          }
        }

        @keyframes pulse-text {
          0%, 100% {
            opacity: 0.85;
          }
          50% {
            opacity: 1;
          }
        }

        @keyframes progress-slide {
          0% {
            transform: translateX(-100%);
          }
          50% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(100%);
          }
        }

        .announcement-content p {
          margin: 0.75rem 0;
        }

        @media (min-width: 640px) {
          .announcement-content p {
            margin: 1rem 0;
          }
        }

        .announcement-content p:has(img) {
          margin: 0;
        }

        .announcement-content > *:first-child {
          margin-top: 0;
        }

        .announcement-content > *:last-child {
          margin-bottom: 0;
        }
      `}</style>
    </>
  );
}
