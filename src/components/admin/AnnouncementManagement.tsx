import React, { useState, useEffect, useMemo, Fragment, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Pin, CreditCard as Edit, Trash2, Globe, Users, ChevronDown, ChevronRight, PinOff, Upload, X, Play, Pause, Gauge, Eye, EyeOff } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Announcement, Admin } from '../../types';
import { parse as marked, setOptions } from 'marked';
import TiptapEditor, { TiptapEditorRef } from './TiptapEditor';
import { sanitizeAnnouncementContent } from '../../lib/sanitizeHTML';
import { processContentImages } from '../../lib/imageOptimizer';
import { cleanupContentImages } from '../../lib/storageCleanup';

interface AnnouncementManagementProps {
  admin: Admin;
}

interface SecondaryAdmin {
  id: string;
  username: string;
}

interface GroupedAnnouncements {
  adminId: string;
  adminName: string;
  announcements: Announcement[];
}

export default function AnnouncementManagement({ admin }: AnnouncementManagementProps) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [secondaryAdmins, setSecondaryAdmins] = useState<SecondaryAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set([admin.id]));
  const [creatingForAdminId, setCreatingForAdminId] = useState<string | null>(null);
  const [pinOrderModalId, setPinOrderModalId] = useState<string | null>(null);
  const [pinOrderValue, setPinOrderValue] = useState<number>(999);
  const editorRef = useRef<TiptapEditorRef>(null);
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    isPinned: false,
    isGlobal: false,
    isHidden: false,
    pinOrder: 999,
    publishAt: new Date().toISOString().slice(0, 16),
  });

  // Carousel settings
  const [carouselEnabled, setCarouselEnabled] = useState(true);
  const [carouselSpeed, setCarouselSpeed] = useState(0.6);
  const [savingCarouselSettings, setSavingCarouselSettings] = useState(false);
  const [showCarouselSuccessMessage, setShowCarouselSuccessMessage] = useState(false);
  const [carouselErrorMessage, setCarouselErrorMessage] = useState<string | null>(null);

  const isSuperAdmin = admin.role === 'super_admin';

  setOptions({
    breaks: true,
    gfm: true,
    pedantic: false,
  });

  const renderMarkdown = (content: string) => {
    if (!content) return '';

    // Process the content to better handle lists
    // For ordered lists to work properly, they need a blank line before them
    // OR they need to start at the beginning of the content
    const lines = content.split('\n');
    const processedLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const prevLine = i > 0 ? lines[i - 1] : '';

      // Check if current line looks like a list item (1. or 1) format)
      const isOrderedList = /^\s*\d+[\.)]\s/.test(line);

      if (isOrderedList && prevLine.trim() !== '' && i > 0) {
        // Add a blank line before the list if there isn't one
        if (!(/^\s*\d+[\.)]\s/.test(prevLine)) && prevLine.trim() !== '') {
          processedLines.push('');
        }
      }

      processedLines.push(line);
    }

    return marked(processedLines.join('\n'));
  };

  useEffect(() => {
    loadAnnouncements();
    if (isSuperAdmin) {
      loadSecondaryAdmins();
      loadCarouselSettings();
    }
  }, []);

  useEffect(() => {
    if (deletingId || pinOrderModalId) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }

    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [deletingId, pinOrderModalId]);

  const loadSecondaryAdmins = async () => {
    try {
      const { data, error } = await supabase
        .from('admins')
        .select('id, username')
        .eq('role', 'secondary_admin')
        .eq('is_active', true)
        .order('username');

      if (error) throw error;
      setSecondaryAdmins(data || []);
    } catch (error) {
      console.error('Error loading secondary admins:', error);
    }
  };

  const loadCarouselSettings = async () => {
    try {
      // Load carousel enabled setting
      const { data: enabledData, error: enabledError } = await supabase
        .from('system_configs')
        .select('value')
        .eq('key', 'announcement_carousel_enabled')
        .maybeSingle();

      if (enabledError) throw enabledError;
      if (enabledData?.value !== undefined) {
        setCarouselEnabled(enabledData.value === true);
      }

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
      }
    } catch (error) {
      console.error('Error loading carousel settings:', error);
    }
  };

  const saveCarouselSettings = async () => {
    setSavingCarouselSettings(true);
    setCarouselErrorMessage(null);
    try {
      // Update carousel enabled setting
      const { error: enabledError } = await supabase
        .from('system_configs')
        .update({
          value: carouselEnabled,
          updated_at: new Date().toISOString()
        })
        .eq('key', 'announcement_carousel_enabled');

      if (enabledError) throw enabledError;

      // Update carousel speed setting
      const { error: speedError } = await supabase
        .from('system_configs')
        .update({
          value: carouselSpeed,
          updated_at: new Date().toISOString()
        })
        .eq('key', 'announcement_carousel_speed');

      if (speedError) throw speedError;

      // Show success message
      setShowCarouselSuccessMessage(true);
      setTimeout(() => {
        setShowCarouselSuccessMessage(false);
      }, 3000);
    } catch (error: any) {
      console.error('Error saving carousel settings:', error);
      setCarouselErrorMessage(error.message || 'Failed to save carousel settings');
      setTimeout(() => {
        setCarouselErrorMessage(null);
      }, 5000);
    } finally {
      setSavingCarouselSettings(false);
    }
  };

  const loadAnnouncements = async () => {
    try {
      let query = supabase
        .from('announcements')
        .select('*');

      if (!isSuperAdmin) {
        query = query.eq('created_by', admin.id);
      }

      const { data, error } = await query
        .order('is_pinned', { ascending: false })
        .order('pin_order', { ascending: true })
        .order('publish_at', { ascending: false });

      if (error) throw error;
      setAnnouncements(data || []);
    } catch (error) {
      console.error('Error loading announcements:', error);
    } finally {
      setLoading(false);
    }
  };


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate title
    if (!formData.title.trim()) {
      alert('Please enter a title');
      return;
    }

    try {
      // Get the latest content from the editor
      const rawContent = editorRef.current?.getContent() || formData.content;
      const editorContent = await processContentImages(rawContent, 'announcements');

      if (editingId) {
        const updateData: any = {
          title: formData.title,
          content: editorContent,
          is_pinned: formData.isPinned,
          is_hidden: formData.isHidden,
          pin_order: formData.pinOrder,
          publish_at: formData.publishAt,
        };

        if (isSuperAdmin) {
          updateData.is_global = formData.isGlobal;
        }

        console.log('Updating announcement:', updateData);
        const { data, error } = await supabase
          .from('announcements')
          .update(updateData)
          .eq('id', editingId)
          .select();

        if (error) {
          console.error('Update error:', error);
          throw error;
        }
        console.log('Update successful:', data);
      } else {
        const insertData: any = {
          title: formData.title,
          content: editorContent,
          is_pinned: formData.isPinned,
          is_hidden: formData.isHidden,
          pin_order: formData.pinOrder,
          publish_at: formData.publishAt,
          created_by: creatingForAdminId || admin.id,
          is_global: isSuperAdmin ? formData.isGlobal : false,
        };

        console.log('Inserting announcement:', insertData);
        const { data, error } = await supabase
          .from('announcements')
          .insert(insertData)
          .select();

        if (error) {
          console.error('Insert error:', error);
          throw error;
        }
        console.log('Insert successful:', data);
      }

      // Reset form
      setFormData({
        title: '',
        content: '',
        isPinned: false,
        isGlobal: false,
        pinOrder: 999,
        publishAt: new Date().toISOString().slice(0, 16),
      });
      setShowForm(false);
      setEditingId(null);
      setCreatingForAdminId(null);

      // Reload announcements
      await loadAnnouncements();

      console.log('Announcement saved successfully');
    } catch (error: any) {
      console.error('Error saving announcement:', error);
      alert(`Failed to save announcement: ${error.message || 'Unknown error'}`);
    }
  };

  const deleteAnnouncement = async (id: string) => {
    try {
      const ann = announcements.find(a => a.id === id);
      if (ann?.content) {
        await cleanupContentImages(ann.content).catch(() => {});
      }
      const { error } = await supabase.from('announcements').delete().eq('id', id);
      if (error) throw error;
      setDeletingId(null);
      loadAnnouncements();
    } catch (error) {
      console.error('Error deleting announcement:', error);
    }
  };

  const toggleHidden = async (announcement: Announcement) => {
    try {
      const newHiddenState = !announcement.is_hidden;

      // Optimistic update
      setAnnouncements(prev =>
        prev.map(a => (a.id === announcement.id ? { ...a, is_hidden: newHiddenState } : a))
      );

      const { error } = await supabase
        .from('announcements')
        .update({ is_hidden: newHiddenState })
        .eq('id', announcement.id);

      if (error) throw error;
    } catch (error) {
      console.error('Error toggling hidden state:', error);
      // Revert optimistic update on error
      loadAnnouncements();
    }
  };

  const togglePin = async (announcement: Announcement) => {
    if (announcement.is_pinned) {
      // Unpin directly
      const newPinnedState = false;
      setAnnouncements(prev =>
        prev.map(a =>
          a.id === announcement.id
            ? { ...a, is_pinned: newPinnedState }
            : a
        )
      );

      try {
        const { error } = await supabase
          .from('announcements')
          .update({ is_pinned: newPinnedState })
          .eq('id', announcement.id);

        if (error) throw error;
      } catch (error) {
        console.error('Error toggling pin:', error);
        setAnnouncements(prev =>
          prev.map(a =>
            a.id === announcement.id
              ? { ...a, is_pinned: true }
              : a
          )
        );
        alert('Failed to update pin status');
      }
    } else {
      // Show order selection modal for pinning
      setPinOrderModalId(announcement.id);
      setPinOrderValue(announcement.pin_order || 999);
    }
  };

  const confirmPin = async () => {
    if (!pinOrderModalId) return;

    const announcement = announcements.find(a => a.id === pinOrderModalId);
    if (!announcement) return;

    // Optimistic update
    setAnnouncements(prev =>
      prev.map(a =>
        a.id === pinOrderModalId
          ? { ...a, is_pinned: true, pin_order: pinOrderValue }
          : a
      )
    );

    try {
      const { error } = await supabase
        .from('announcements')
        .update({ is_pinned: true, pin_order: pinOrderValue })
        .eq('id', pinOrderModalId);

      if (error) throw error;
      setPinOrderModalId(null);
    } catch (error) {
      console.error('Error pinning announcement:', error);
      // Revert on error
      setAnnouncements(prev =>
        prev.map(a =>
          a.id === pinOrderModalId
            ? { ...a, is_pinned: false, pin_order: announcement.pin_order }
            : a
        )
      );
      alert('Failed to pin announcement');
      setPinOrderModalId(null);
    }
  };

  const startEdit = (announcement: Announcement) => {
    setEditingId(announcement.id);
    setCreatingForAdminId(announcement.created_by);
    setFormData({
      title: announcement.title,
      content: announcement.content,
      isPinned: announcement.is_pinned,
      isGlobal: announcement.is_global || false,
      isHidden: announcement.is_hidden || false,
      pinOrder: announcement.pin_order || 999,
      publishAt: new Date(announcement.publish_at).toISOString().slice(0, 16),
    });

    setShowForm(true);

    // Expand the group containing this announcement
    const newExpanded = new Set(expandedGroups);
    newExpanded.add(announcement.created_by);
    setExpandedGroups(newExpanded);
  };

  const toggleGroup = (groupId: string) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(groupId)) {
      newExpanded.delete(groupId);
    } else {
      newExpanded.add(groupId);
    }
    setExpandedGroups(newExpanded);
  };

  const startCreateForAdmin = (adminId: string) => {
    setCreatingForAdminId(adminId);
    setEditingId(null);
    setFormData({
      title: '',
      content: '',
      isPinned: false,
      isGlobal: false,
      publishAt: new Date().toISOString().slice(0, 16),
    });
    setShowForm(true);

    // Expand the group
    const newExpanded = new Set(expandedGroups);
    newExpanded.add(adminId);
    setExpandedGroups(newExpanded);
  };

  const sortAnnouncementsForEmployeeView = (announcements: Announcement[]) => {
    return [...announcements].sort((a, b) => {
      // First, sort by pinned status (pinned first)
      if (a.is_pinned !== b.is_pinned) {
        return a.is_pinned ? -1 : 1;
      }

      // If both are pinned, sort by pin_order (ascending)
      if (a.is_pinned && b.is_pinned) {
        if (a.pin_order !== b.pin_order) {
          return a.pin_order - b.pin_order;
        }
      }

      // Finally, sort by publish_at (descending - newest first)
      return new Date(b.publish_at).getTime() - new Date(a.publish_at).getTime();
    });
  };

  const getGroupedAnnouncements = (): GroupedAnnouncements[] => {
    if (!isSuperAdmin) {
      return [{
        adminId: admin.id,
        adminName: 'My Announcements',
        announcements: sortAnnouncementsForEmployeeView(announcements),
      }];
    }

    const groups: GroupedAnnouncements[] = [];

    // Super Admin group first (includes all announcements created by super admin)
    const superAdminAnnouncements = announcements.filter(
      a => a.created_by === admin.id
    );
    groups.push({
      adminId: admin.id,
      adminName: admin.username + ' (Super Admin)',
      announcements: sortAnnouncementsForEmployeeView(superAdminAnnouncements),
    });

    // All secondary admins (even if they have no announcements)
    secondaryAdmins.forEach(secAdmin => {
      const adminAnnouncements = announcements.filter(
        a => a.created_by === secAdmin.id
      );
      groups.push({
        adminId: secAdmin.id,
        adminName: secAdmin.username,
        announcements: sortAnnouncementsForEmployeeView(adminAnnouncements),
      });
    });

    return groups;
  };

  const groupedAnnouncements = getGroupedAnnouncements();

  return (
    <div className="bg-slate-900/80 backdrop-blur-xl rounded-2xl border border-blue-500/20 p-6">

      {/* Carousel Settings - Only for Super Admin */}
      {isSuperAdmin && (
        <div className="mb-6 bg-gradient-to-br from-blue-900/30 to-cyan-900/20 border border-blue-500/30 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-lg flex items-center justify-center">
              <Gauge className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Employee Announcement Carousel</h3>
              <p className="text-xs text-slate-400">Control auto-scroll behavior on employee dashboard</p>
            </div>
          </div>

          {/* Success Message */}
          {showCarouselSuccessMessage && (
            <div className="mb-4 p-4 bg-green-500/10 border border-green-500/30 rounded-lg flex items-center gap-3 animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="text-green-400 font-semibold text-sm">Carousel Settings Saved!</p>
                <p className="text-green-300/70 text-xs mt-0.5">Changes will take effect immediately on employee dashboards</p>
              </div>
            </div>
          )}

          {/* Error Message */}
          {carouselErrorMessage && (
            <div className="mb-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-3 animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="w-6 h-6 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="text-red-400 font-semibold text-sm">Failed to Save Settings</p>
                <p className="text-red-300/70 text-xs mt-0.5">{carouselErrorMessage}</p>
              </div>
            </div>
          )}

          <div className="space-y-4">
            {/* Enable/Disable Toggle */}
            <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-lg border border-slate-700">
              <div className="flex items-center gap-3">
                {carouselEnabled ? (
                  <Play className="w-5 h-5 text-green-400" />
                ) : (
                  <Pause className="w-5 h-5 text-orange-400" />
                )}
                <div>
                  <p className="text-sm font-semibold text-white">Auto-Scroll Carousel</p>
                  <p className="text-xs text-slate-400">
                    {carouselEnabled ? 'Announcements will auto-scroll' : 'Announcements will be static'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setCarouselEnabled(!carouselEnabled)}
                className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors ${
                  carouselEnabled ? 'bg-green-500' : 'bg-slate-600'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition-transform ${
                    carouselEnabled ? 'translate-x-8' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* Speed Control */}
            {carouselEnabled && (
              <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-white">Scroll Speed</p>
                    <p className="text-xs text-slate-400">Adjust how fast announcements scroll</p>
                  </div>
                  <span className="px-3 py-1 bg-blue-500/20 border border-blue-500/30 rounded-lg text-blue-400 font-mono text-sm">
                    {carouselSpeed.toFixed(1)}x
                  </span>
                </div>

                <div className="space-y-2">
                  <input
                    type="range"
                    min="0.1"
                    max="5.0"
                    step="0.1"
                    value={carouselSpeed}
                    onChange={(e) => setCarouselSpeed(parseFloat(e.target.value))}
                    className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-blue-500 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:border-0"
                  />
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>0.1x (Very Slow)</span>
                    <span>2.5x (Medium)</span>
                    <span>5.0x (Very Fast)</span>
                  </div>
                </div>

                <div className="grid grid-cols-5 gap-2 mt-3">
                  {[0.3, 0.6, 1.0, 2.0, 3.0].map((speed) => (
                    <button
                      key={speed}
                      onClick={() => setCarouselSpeed(speed)}
                      className={`px-2 py-1.5 rounded text-xs font-medium transition-all ${
                        Math.abs(carouselSpeed - speed) < 0.05
                          ? 'bg-blue-500 text-white'
                          : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                      }`}
                    >
                      {speed}x
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Save Button */}
            <button
              onClick={saveCarouselSettings}
              disabled={savingCarouselSettings}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-semibold transition-all shadow-lg hover:shadow-blue-500/30"
            >
              {savingCarouselSettings ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  Saving...
                </>
              ) : (
                <>
                  <Gauge className="w-4 h-4" />
                  Save Carousel Settings
                </>
              )}
            </button>
          </div>
        </div>
      )}


      {loading ? (
        <div className="text-center py-8 text-slate-400">Loading announcements...</div>
      ) : groupedAnnouncements.length === 0 ? (
        <div className="text-center py-8 text-slate-400">No announcements yet</div>
      ) : (
        <div className="space-y-4">
          {groupedAnnouncements.map((group) => (
            <div key={group.adminId} className="border border-slate-700 rounded-lg overflow-hidden">
              <button
                onClick={() => toggleGroup(group.adminId)}
                className="flex items-center gap-3 w-full px-4 py-3 bg-slate-800/70 hover:bg-slate-800 transition-all"
              >
                {group.adminId === admin.id ? (
                  <Globe className="w-5 h-5 text-green-400" />
                ) : (
                  <Users className="w-5 h-5 text-blue-400" />
                )}
                <span className="font-semibold text-white">{group.adminName}</span>
                <span className="text-sm text-slate-400">
                  ({group.announcements.length} announcement{group.announcements.length !== 1 ? 's' : ''})
                </span>
                <div className="ml-auto">
                  {expandedGroups.has(group.adminId) ? (
                    <ChevronDown className="w-5 h-5 text-slate-400" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-slate-400" />
                  )}
                </div>
              </button>

              {expandedGroups.has(group.adminId) && (
                <div className="p-4 space-y-3 bg-slate-900/30">
                  <button
                    onClick={() => startCreateForAdmin(group.adminId)}
                    className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-all shadow-lg shadow-blue-500/30"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Add New Announcement</span>
                  </button>
                  {showForm && creatingForAdminId === group.adminId && !editingId && (
                    <form onSubmit={handleSubmit} className="bg-slate-800/50 rounded-lg p-4 mb-3 space-y-4 border border-blue-500/30">
                      {!editingId && (
                        <div className="flex items-center gap-2 px-3 py-2 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                          <span className="text-sm text-blue-400">
                            Creating announcement for: <span className="font-semibold">
                              {creatingForAdminId === admin.id
                                ? 'Super Admin'
                                : secondaryAdmins.find(a => a.id === creatingForAdminId)?.username || 'Unknown'}
                            </span>
                          </span>
                        </div>
                      )}
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">Title</label>
                        <input
                          type="text"
                          value={formData.title}
                          onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                            }
                          }}
                          required
                          className="w-full px-4 py-2 bg-slate-900/50 backdrop-blur-sm border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">
                          Content
                          <span className="text-xs text-slate-500 ml-2 font-normal">
                            (Plain text or Markdown format)
                          </span>
                        </label>


                        <div>
                          <label className="block text-xs font-medium text-slate-400 mb-2">Content</label>
                          <TiptapEditor
                            ref={editorRef}
                            content={formData.content}
                            onChange={(content) => setFormData({ ...formData, content })}
                            placeholder="Start typing your announcement..."
                            adminId={admin.id}
                          />
                        </div>

                        <div className="mt-2 text-xs text-slate-500 space-y-1">
                          <div>💡 <strong>Tips:</strong></div>
                          <div className="ml-4">• Select text and click format buttons (Bold, Italic, Heading)</div>
                          <div className="ml-4">• Click the image icon to upload images (max 5MB each)</div>
                          <div className="ml-4">• Press Enter once for line break, twice for paragraph</div>
                          <div className="ml-4">• Use the list buttons for bullet or numbered lists</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-slate-300 mb-2">Publish At</label>
                          <input
                            type="datetime-local"
                            value={formData.publishAt}
                            onChange={(e) => setFormData({ ...formData, publishAt: e.target.value })}
                            className="w-full px-4 py-2 bg-slate-900/50 backdrop-blur-sm border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div className="flex flex-col justify-end gap-2">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={formData.isPinned}
                              onChange={(e) => setFormData({ ...formData, isPinned: e.target.checked })}
                              className="w-4 h-4 text-blue-600 bg-slate-700 border-slate-600 rounded focus:ring-blue-500 checked:bg-blue-600 checked:border-blue-600"
                            />
                            <span className="text-slate-300">Pin to top</span>
                          </label>
                          {isSuperAdmin && creatingForAdminId === admin.id && (
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={formData.isGlobal}
                                onChange={(e) => setFormData({ ...formData, isGlobal: e.target.checked })}
                                className="w-4 h-4 text-green-600 bg-slate-700 border-slate-600 rounded focus:ring-green-500 checked:bg-green-600 checked:border-green-600"
                              />
                              <span className="text-slate-300 flex items-center gap-1">
                                <Globe className="w-3.5 h-3.5" />
                                Global (visible to all employees)
                              </span>
                            </label>
                          )}
                        </div>
                      </div>
                      {formData.isPinned && (
                        <div>
                          <label className="block text-sm font-medium text-slate-300 mb-2">
                            Pin Order (1-999, lower = higher priority)
                          </label>
                          <input
                            type="number"
                            min="1"
                            max="999"
                            value={formData.pinOrder}
                            onChange={(e) => setFormData({ ...formData, pinOrder: parseInt(e.target.value) || 999 })}
                            className="w-full px-4 py-2 bg-slate-900/50 backdrop-blur-sm border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <p className="text-xs text-slate-500 mt-1">
                            Employee view order: Pinned announcements sorted by this number (ascending), then by publish date
                          </p>
                        </div>
                      )}
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setShowForm(false);
                            setEditingId(null);
                            setCreatingForAdminId(null);
                                                }}
                          className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-all"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-all"
                        >
                          {editingId ? 'Update' : 'Create'}
                        </button>
                      </div>
                    </form>
                  )}

                  {group.announcements.length === 0 && (!showForm || creatingForAdminId !== group.adminId) ? (
                    <div className="text-center py-6 text-slate-500">
                      No announcements yet
                    </div>
                  ) : (
                    group.announcements.map((announcement) => (
                    <div key={announcement.id}>
                      {editingId === announcement.id && showForm ? (
                        <form onSubmit={handleSubmit} className="bg-slate-800/50 rounded-lg p-4 space-y-3 border border-blue-500/50 transition-all">
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            {formData.isPinned && (
                              <div className="flex items-center gap-1 px-2 py-0.5 bg-yellow-500/20 rounded border border-yellow-500/30">
                                <Pin className="w-3 h-3 text-yellow-400" />
                                <span className="text-xs text-yellow-400">Pinned</span>
                              </div>
                            )}
                            {formData.isGlobal && (
                              <div className="flex items-center gap-1 px-2 py-0.5 bg-green-500/20 rounded border border-green-500/30">
                                <Globe className="w-3 h-3 text-green-400" />
                                <span className="text-xs text-green-400">Global</span>
                              </div>
                            )}
                            {formData.isHidden && (
                              <div className="flex items-center gap-1 px-2 py-0.5 bg-orange-500/20 rounded border border-orange-500/30">
                                <EyeOff className="w-3 h-3 text-orange-400" />
                                <span className="text-xs text-orange-400">Hidden</span>
                              </div>
                            )}
                            <span className="text-xs text-blue-400">Editing...</span>
                          </div>

                          <input
                            type="text"
                            value={formData.title}
                            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                              }
                            }}
                            required
                            placeholder="Title"
                            className="w-full px-3 py-2 bg-slate-900/50 backdrop-blur-sm border border-slate-700 rounded-lg text-white font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />


                          <div>
                            <label className="block text-xs font-medium text-slate-400 mb-1">Content</label>
                            <TiptapEditor
                              ref={editorRef}
                              content={formData.content}
                              onChange={(content) => setFormData({ ...formData, content })}
                              placeholder="Type or paste your content here"
                              adminId={admin.id}
                            />
                          </div>

                          <div className="flex flex-wrap gap-3 text-xs">
                            <div className="flex items-center gap-2">
                              <span className="text-slate-400">Publish:</span>
                              <input
                                type="datetime-local"
                                value={formData.publishAt}
                                onChange={(e) => setFormData({ ...formData, publishAt: e.target.value })}
                                className="px-2 py-1 bg-slate-900/50 backdrop-blur-sm border border-slate-700 rounded text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            </div>

                            <label className="flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={formData.isPinned}
                                onChange={(e) => setFormData({ ...formData, isPinned: e.target.checked })}
                                className="w-3.5 h-3.5 text-blue-600 bg-slate-700 border-slate-600 rounded focus:ring-blue-500 checked:bg-blue-600 checked:border-blue-600"
                              />
                              <Pin className="w-3 h-3 text-slate-400" />
                              <span className="text-slate-300">Pin</span>
                            </label>

                            {formData.isPinned && (
                              <input
                                type="number"
                                min="1"
                                max="999"
                                value={formData.pinOrder}
                                onChange={(e) => setFormData({ ...formData, pinOrder: parseInt(e.target.value) || 999 })}
                                placeholder="Order"
                                className="w-16 px-2 py-1 bg-slate-900/50 backdrop-blur-sm border border-slate-700 rounded text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            )}

                            {isSuperAdmin && announcement.created_by === admin.id && (
                              <label className="flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={formData.isGlobal}
                                  onChange={(e) => setFormData({ ...formData, isGlobal: e.target.checked })}
                                  className="w-3.5 h-3.5 text-green-600 bg-slate-700 border-slate-600 rounded focus:ring-green-500 checked:bg-green-600 checked:border-green-600"
                                />
                                <Globe className="w-3 h-3 text-slate-400" />
                                <span className="text-slate-300">Global</span>
                              </label>
                            )}
                          </div>

                          <div className="flex gap-2 pt-2">
                            <button
                              type="submit"
                              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-all"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setShowForm(false);
                                setEditingId(null);
                                setCreatingForAdminId(null);
                                                        }}
                              className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg transition-all"
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      ) : (
                        <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700 hover:border-blue-500/50 transition-all">
                          <div className="flex justify-between items-start gap-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2 flex-wrap">
                                {announcement.is_pinned && (
                                  <div className="flex items-center gap-1 px-2 py-0.5 bg-yellow-500/20 rounded border border-yellow-500/30">
                                    <Pin className="w-3 h-3 text-yellow-400" />
                                    <span className="text-xs text-yellow-400">Pinned #{announcement.pin_order}</span>
                                  </div>
                                )}
                                {announcement.is_global && (
                                  <div className="flex items-center gap-1 px-2 py-0.5 bg-green-500/20 rounded border border-green-500/30">
                                    <Globe className="w-3 h-3 text-green-400" />
                                    <span className="text-xs text-green-400">Global</span>
                                  </div>
                                )}
                                {announcement.is_hidden && (
                                  <div className="flex items-center gap-1 px-2 py-0.5 bg-orange-500/20 rounded border border-orange-500/30">
                                    <EyeOff className="w-3 h-3 text-orange-400" />
                                    <span className="text-xs text-orange-400">Hidden</span>
                                  </div>
                                )}
                                <h3 className="font-semibold text-white">{announcement.title}</h3>
                              </div>
                              <div
                                className="max-h-48 overflow-y-auto mb-2 scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-slate-800/50 prose prose-invert prose-sm max-w-none announcement-preview"
                                dangerouslySetInnerHTML={{ __html: sanitizeAnnouncementContent(renderMarkdown(announcement.content)) }}
                              />
                              <div className="text-slate-500 text-xs">
                                Publish: {new Date(announcement.publish_at).toLocaleString()}
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => togglePin(announcement)}
                                className="p-2 hover:bg-slate-700 rounded transition-all"
                                title={announcement.is_pinned ? "Unpin" : "Pin to top"}
                              >
                                {announcement.is_pinned ? (
                                  <PinOff className="w-4 h-4 text-yellow-400" />
                                ) : (
                                  <Pin className="w-4 h-4 text-slate-400 hover:text-yellow-400" />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleHidden(announcement)}
                                className="p-2 hover:bg-slate-700 rounded transition-all"
                                title={announcement.is_hidden ? "Show announcement" : "Hide announcement"}
                              >
                                {announcement.is_hidden ? (
                                  <EyeOff className="w-4 h-4 text-orange-400" />
                                ) : (
                                  <Eye className="w-4 h-4 text-slate-400 hover:text-green-400" />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => startEdit(announcement)}
                                className="p-2 hover:bg-slate-700 rounded transition-all"
                              >
                                <Edit className="w-4 h-4 text-blue-400" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeletingId(announcement.id)}
                                className="p-2 hover:bg-slate-700 rounded transition-all"
                              >
                                <Trash2 className="w-4 h-4 text-red-400" />
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <style>{`
        /* Announcement preview image styles */
        .announcement-preview img {
          margin: 0.75rem 0;
          border-radius: 0.5rem;
          border: 1px solid rgba(59, 130, 246, 0.2);
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
          max-width: 100%;
          height: auto;
          display: block;
          background: rgba(15, 23, 42, 0.3);
        }

        /* Video styles */
        .announcement-preview video {
          margin: 0.75rem 0;
          border-radius: 0.5rem;
          border: 1px solid rgba(59, 130, 246, 0.2);
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
          max-width: 100%;
          height: auto;
          display: block;
          background: rgba(0, 0, 0, 0.5);
        }

        .announcement-preview p {
          margin: 0.5rem 0;
        }

        .announcement-preview p:has(img) {
          margin: 0;
        }

        .announcement-preview p:has(video) {
          margin: 0;
        }

        .announcement-preview > *:first-child {
          margin-top: 0;
        }

        .announcement-preview > *:last-child {
          margin-bottom: 0;
        }

        /* Ordered and unordered list styles */
        .announcement-preview ol,
        .announcement-preview ul {
          margin: 0.75rem 0;
          padding-left: 2rem;
          list-style-position: outside;
        }

        .announcement-preview ol {
          list-style-type: decimal;
        }

        .announcement-preview ul {
          list-style-type: disc;
        }

        .announcement-preview li {
          margin: 0.25rem 0;
          padding-left: 0.25rem;
        }

        .announcement-preview ol ol {
          list-style-type: lower-alpha;
        }

        .announcement-preview ol ol ol {
          list-style-type: lower-roman;
        }
      `}</style>

      {/* Pin Order Modal */}
      {pinOrderModalId && (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setPinOrderModalId(null)}>
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
          <h3 className="text-xl font-bold text-white mb-4">Set Pin Order</h3>
          <p className="text-slate-300 mb-4">
            Set the display order for this pinned announcement. Lower numbers appear first.
          </p>
          <div className="mb-6">
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Pin Order (1-999)
            </label>
            <input
              type="number"
              min="1"
              max="999"
              value={pinOrderValue}
              onChange={(e) => setPinOrderValue(parseInt(e.target.value) || 999)}
              className="w-full px-4 py-2 bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-yellow-500"
              autoFocus
            />
            <p className="text-xs text-slate-500 mt-2">
              Employee view: Pinned announcements appear at the top, sorted by this order number (1, 2, 3...), then regular announcements by publish date.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setPinOrderModalId(null)}
              className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-all"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmPin}
              className="flex-1 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg transition-all"
            >
              Pin
            </button>
          </div>
        </div>
      </div>
      )}

      {/* Enhanced Delete Confirmation Dialog - Using Portal for proper positioning */}
      {deletingId && createPortal(
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-[9999] p-4 animate-fadeIn"
          onClick={() => setDeletingId(null)}
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
        >
          <div
            className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border-2 border-red-500/30 rounded-2xl p-8 max-w-md w-full shadow-2xl shadow-red-500/20 animate-scaleIn relative overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Background Effects */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(239,68,68,0.1),transparent_50%)]"></div>
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-red-500 to-transparent"></div>

            {/* Warning Icon */}
            <div className="relative flex items-center justify-center mb-6">
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-20 h-20 bg-red-500/20 rounded-full blur-xl animate-pulse"></div>
              </div>
              <div className="relative w-16 h-16 bg-gradient-to-br from-red-500/20 to-red-600/20 rounded-full flex items-center justify-center border-2 border-red-500/40">
                <Trash2 className="w-8 h-8 text-red-400" />
              </div>
            </div>

            {/* Content */}
            <div className="relative">
              <h3 className="text-2xl font-black text-white mb-3 text-center bg-gradient-to-r from-white to-red-200 bg-clip-text text-transparent">
                Confirm Deletion
              </h3>
              <p className="text-slate-300 mb-8 text-center leading-relaxed">
                Are you sure you want to delete this announcement?
                <span className="block mt-2 text-red-400 font-semibold">This action cannot be undone.</span>
              </p>

              {/* Action Buttons */}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setDeletingId(null)}
                  className="relative flex-1 px-6 py-3 bg-slate-700/50 hover:bg-slate-600/50 text-white rounded-xl transition-all font-semibold border border-slate-600/50 hover:border-slate-500 group overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-slate-400/10 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-500"></div>
                  <span className="relative">Cancel</span>
                </button>
                <button
                  type="button"
                  onClick={() => deleteAnnouncement(deletingId)}
                  className="relative flex-1 px-6 py-3 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white rounded-xl transition-all font-bold shadow-lg shadow-red-500/30 hover:shadow-red-500/50 border border-red-500/50 hover:border-red-400 group overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-500"></div>
                  <span className="relative flex items-center justify-center gap-2">
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
