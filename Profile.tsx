import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { 
  View, Text, TextInput, StyleSheet, TouchableOpacity, 
  Image, Alert, ActivityIndicator, FlatList, Dimensions, Modal, KeyboardAvoidingView, Platform, RefreshControl, Switch, ScrollView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage'; 
import { supabase } from './supabase';
import { useTheme } from './ThemeContext'; 
import { scheduleMorningRoasts } from './App';
import ActionSheet from './ActionSheet'; // <-- ADDED ACTION SHEET
import { useCustomAlert } from './AlertContext';
import {
  toggleLike, fetchLikes, fetchComments, addComment, fetchLikeSummaries, fetchCommentCounts
} from './social';
import { fetchPreferences, updatePreference, type NotificationPrefs } from './notificationsApi';

const { width } = Dimensions.get('window');
const GRID_SIZE = width / 3;

const timeSince = (dateString: string) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
  let interval = seconds / 3600;
  if (interval >= 1) return Math.floor(interval) + 'h';
  interval = seconds / 60;
  if (interval >= 1) return Math.floor(interval) + 'm';
  return 'Just now';
};

export default function Profile({ route, navigation }: any) {
  const { showAlert } = useCustomAlert();
  const { colors, theme, toggleTheme } = useTheme(); 
  const styles = useMemo(() => getStyles(colors, theme), [colors, theme]);

  // If a userId param is passed, we're viewing someone else's profile.
  // Otherwise (when used as a tab), we're viewing the current user's profile.
  const viewingUserId: string | null = route?.params?.userId || null;
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const isOwnProfile = !viewingUserId || viewingUserId === currentUserId;

  // Follow state — only relevant when viewing someone else's profile
  const [isFollowing, setIsFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [stats, setStats] = useState({ followers: 0, following: 0, posts: 0 });
  const [workouts, setWorkouts] = useState<any[]>([]);
  
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editUsername, setEditUsername] = useState('');
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editAvatarUrl, setEditAvatarUrl] = useState<string | null>(null);

  const [isSettingsVisible, setIsSettingsVisible] = useState(false);
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);

  const [networkType, setNetworkType] = useState<'followers' | 'following' | null>(null);
  const [networkList, setNetworkList] = useState<any[]>([]);
  const [loadingNetwork, setLoadingNetwork] = useState(false);

  const [selectedPost, setSelectedPost] = useState<any | null>(null);
  // Likes & comments for the currently-open post in the detail modal
  const [postLikes, setPostLikes] = useState<{ count: number; likedByMe: boolean; likers: any[] }>({ count: 0, likedByMe: false, likers: [] });
  const [postComments, setPostComments] = useState<any[]>([]);
  const [postCommentDraft, setPostCommentDraft] = useState('');
  const [postingPostComment, setPostingPostComment] = useState(false);
  const [showPostLikersSheet, setShowPostLikersSheet] = useState(false);
  // Bulk counts for the grid display
  const [likeCounts, setLikeCounts] = useState<Map<string, { count: number; likedByMe: boolean }>>(new Map());
  const [commentCounts, setCommentCounts] = useState<Map<string, number>>(new Map());
  const [isEditingPost, setIsEditingPost] = useState(false);
  const [editPostNotes, setEditPostNotes] = useState('');

  // --- ADDED ACTION SHEET STATE ---
  const [actionSheetVisible, setActionSheetVisible] = useState(false);
  const [actionSheetConfig, setActionSheetConfig] = useState<any>({});

  useFocusEffect(
    useCallback(() => {
      fetchFullProfile();
      // Load notification preferences (only for own profile)
      if (!viewingUserId) {
        supabase.auth.getUser().then(({ data }) => {
          if (data.user) {
            fetchPreferences(data.user.id).then(setPrefs).catch(() => {});
          }
        });
      }
    }, [viewingUserId])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchFullProfile();
    setRefreshing(false);
  };

  const fetchFullProfile = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setCurrentUserId(user.id);

      // Target = whoever's profile we're showing
      const targetId = viewingUserId || user.id;

      const { data: profile } = await supabase.from('profiles').select('*').eq('id', targetId).single();
      setUserProfile(profile);
      setEditUsername(profile?.username || '');
      setEditDisplayName(profile?.display_name || '');
      setEditBio(profile?.bio || '');
      setEditAvatarUrl(profile?.avatar_url || null);

      const { count: followers } = await supabase.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', targetId);
      const { count: following } = await supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', targetId);
      const { count: posts } = await supabase.from('workouts').select('*', { count: 'exact', head: true }).eq('user_id', targetId);
      
      setStats({ followers: followers || 0, following: following || 0, posts: posts || 0 });

      // Am I following this user? (only meaningful when viewing someone else)
      if (targetId !== user.id) {
        const { data: existingFollow } = await supabase
          .from('follows')
          .select('follower_id')
          .eq('follower_id', user.id)
          .eq('following_id', targetId)
          .maybeSingle();
        setIsFollowing(!!existingFollow);
      }

      const { data: myWorkouts } = await supabase.from('workouts').select('*').eq('user_id', targetId).order('created_at', { ascending: false });
      setWorkouts(myWorkouts || []);

      // Load bulk like + comment counts for the grid (likedByMe is from current user's POV)
      if (myWorkouts && myWorkouts.length > 0) {
        const ids = myWorkouts.map(w => w.id);
        try {
          const [likes, comments] = await Promise.all([
            fetchLikeSummaries(ids, user.id),
            fetchCommentCounts(ids),
          ]);
          setLikeCounts(likes);
          setCommentCounts(comments);
        } catch (e) { console.warn('Failed to load post counts:', e); }
      }

    } catch (error) { console.error(error); } finally { setLoading(false); }
  };

  const toggleFollow = async () => {
    if (!currentUserId || !viewingUserId || followBusy) return;
    const wasFollowing = isFollowing;
    setFollowBusy(true);
    // Optimistic UI
    setIsFollowing(!wasFollowing);
    setStats(prev => ({ ...prev, followers: prev.followers + (wasFollowing ? -1 : 1) }));

    try {
      if (wasFollowing) {
        const { error } = await supabase.from('follows').delete().match({
          follower_id: currentUserId,
          following_id: viewingUserId,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.from('follows').insert({
          follower_id: currentUserId,
          following_id: viewingUserId,
        });
        if (error) throw error;
      }
    } catch (e: any) {
      // Revert on failure
      setIsFollowing(wasFollowing);
      setStats(prev => ({ ...prev, followers: prev.followers + (wasFollowing ? 1 : -1) }));
      showAlert("Couldn't update follow", e?.message || "Please try again.");
    } finally {
      setFollowBusy(false);
    }
  };

  const togglePref = async (key: keyof Omit<NotificationPrefs, 'user_id'>, value: boolean) => {
    if (!prefs) return;
    setPrefs({ ...prefs, [key]: value });
    try {
      await updatePreference(prefs.user_id, key, value);
      // Reschedule morning roasts when daily_roast toggle changes
      if (key === 'daily_roast') {
        // We still keep an AsyncStorage mirror so the App.tsx scheduler can read it
        // without a network call on app boot.
        await AsyncStorage.setItem('dailyRoasts', value ? 'true' : 'false');
        scheduleMorningRoasts();
      }
    } catch (e) {
      // Revert on failure
      setPrefs({ ...prefs, [key]: !value });
    }
  };

  const openNetworkList = async (type: 'followers' | 'following') => {
    setNetworkType(type);
    setLoadingNetwork(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      let ids: string[] = [];
      if (type === 'followers') {
        const { data } = await supabase.from('follows').select('follower_id').eq('following_id', user.id);
        ids = data ? data.map(d => d.follower_id) : [];
      } else {
        const { data } = await supabase.from('follows').select('following_id').eq('follower_id', user.id);
        ids = data ? data.map(d => d.following_id) : [];
      }

      if (ids.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('*').in('id', ids);
        setNetworkList(profiles || []);
      } else {
        setNetworkList([]);
      }
    } catch (error) { console.error(error); } finally { setLoadingNetwork(false); }
  };

  const pickAvatar = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.5, base64: true });
    if (!result.canceled && result.assets[0].uri) setEditAvatarUrl(result.assets[0].uri);
  };

  const saveProfile = async () => {
    try {
      setSaving(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      let finalAvatarUrl = editAvatarUrl;
      
      // If the image is a newly picked local image (not an existing http url)
      if (editAvatarUrl && !editAvatarUrl.startsWith('http')) {
        let base64 = '';

        if (Platform.OS === 'web') {
          // Web: Fetch the blob and convert to base64
          const response = await fetch(editAvatarUrl);
          const blob = await response.blob();
          base64 = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const result = reader.result?.toString().split(',')[1] || '';
              resolve(result);
            };
            reader.readAsDataURL(blob);
          });
        } else {
          // Native (Android/iOS): Use FileSystem
          base64 = await FileSystem.readAsStringAsync(editAvatarUrl, { encoding: 'base64' });
        }

        if (base64) {
          const filePath = `${user.id}/${Date.now()}.png`;
          const { error: uploadError } = await supabase.storage
            .from('avatars')
            .upload(filePath, decode(base64), { contentType: 'image/png' });
          
          if (uploadError) throw uploadError;
          
          const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(filePath);
          finalAvatarUrl = publicUrl;
        }
      }

      const updates = { 
        id: user.id, 
        username: editUsername.toLowerCase().trim(), 
        display_name: editDisplayName, 
        bio: editBio.trim() || null,
        avatar_url: finalAvatarUrl 
      };
      
      const { error } = await supabase.from('profiles').upsert(updates);
      if (error) throw error;
      
      await fetchFullProfile();
      setIsEditingProfile(false);
    } catch (error: any) { 
      // Safe to use standard alert here since it's just a simple 1-button error prompt
      showAlert('Error', error.message); 
    } finally { 
      setSaving(false); 
    }
  };

  const openPost = async (post: any) => {
    setSelectedPost(post);
    setEditPostNotes(post.notes || '');
    setIsEditingPost(false);
    setPostCommentDraft('');
    setPostLikes({ count: 0, likedByMe: false, likers: [] });
    setPostComments([]);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    try {
      const [likes, comments] = await Promise.all([
        fetchLikes(post.id, user.id),
        fetchComments(post.id),
      ]);
      setPostLikes(likes);
      setPostComments(comments);
    } catch (e) { console.warn('Failed to load post interactions:', e); }
  };

  const handlePostLikeToggle = async () => {
    if (!selectedPost) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const wasLiked = postLikes.likedByMe;
    setPostLikes(prev => ({ ...prev, likedByMe: !wasLiked, count: prev.count + (wasLiked ? -1 : 1) }));
    // Also keep the grid count in sync
    setLikeCounts(prev => {
      const next = new Map(prev);
      const cur = next.get(selectedPost.id) || { count: 0, likedByMe: false };
      next.set(selectedPost.id, { count: cur.count + (wasLiked ? -1 : 1), likedByMe: !wasLiked });
      return next;
    });
    try {
      await toggleLike(selectedPost.id, user.id, wasLiked);
    } catch (e) {
      // Revert
      setPostLikes(prev => ({ ...prev, likedByMe: wasLiked, count: prev.count + (wasLiked ? 1 : -1) }));
      showAlert("Couldn't update like", "Please try again.");
    }
  };

  const handleAddPostComment = async () => {
    if (!selectedPost || !postCommentDraft.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setPostingPostComment(true);
    try {
      const { data, error } = await addComment(selectedPost.id, user.id, postCommentDraft);
      if (error) throw error;
      if (data) {
        setPostComments(prev => [...prev, data]);
        setCommentCounts(prev => {
          const next = new Map(prev);
          next.set(selectedPost.id, (next.get(selectedPost.id) || 0) + 1);
          return next;
        });
      }
      setPostCommentDraft('');
    } catch (e: any) {
      showAlert("Couldn't post comment", e?.message || "Try again.");
    } finally {
      setPostingPostComment(false);
    }
  };

  const savePostEdit = async () => {
    if (!selectedPost) return;
    try {
      const { error } = await supabase.from('workouts').update({ notes: editPostNotes }).eq('id', selectedPost.id);
      if (error) throw error;
      
      const updatedWorkouts = workouts.map(w => w.id === selectedPost.id ? { ...w, notes: editPostNotes } : w);
      setWorkouts(updatedWorkouts);
      setSelectedPost({ ...selectedPost, notes: editPostNotes });
      setIsEditingPost(false);
    } catch (error: any) { showAlert('Error', error.message); }
  };

  // --- UPDATED DELETE POST TO USE ACTION SHEET ---
  const triggerDeletePost = () => {
    setActionSheetConfig({
      title: "Are you sure you want to delete this workout?",
      options: [
        { 
          text: "Delete", 
          style: "destructive", 
          onPress: async () => {
            if (!selectedPost) return;
            try {
              await supabase.from('workouts').delete().eq('id', selectedPost.id);
              setWorkouts(workouts.filter(w => w.id !== selectedPost.id));
              setStats(prev => ({ ...prev, posts: prev.posts - 1 }));
              setSelectedPost(null);
            } catch (error: any) { showAlert("Error", error.message); }
          }
        },
        { text: "Cancel", style: "cancel", onPress: () => {} }
      ]
    });
    setActionSheetVisible(true);
  };

  // --- UPDATED LOGOUT TO USE ACTION SHEET ---
  const handleLogout = async () => {
    setActionSheetConfig({
      title: "Are you sure you want to log out?",
      options: [
        { text: "Log Out", style: "destructive", onPress: () => supabase.auth.signOut() },
        { text: "Cancel", style: "cancel", onPress: () => {} }
      ]
    });
    setActionSheetVisible(true);
  };

  const renderGridItem = ({ item }: { item: any }) => {
    const likeInfo = likeCounts.get(item.id);
    const commentCount = commentCounts.get(item.id) || 0;
    return (
      <TouchableOpacity style={styles.gridItem} onPress={() => openPost(item)} activeOpacity={0.8}>
        <Image source={{ uri: item.image_url }} style={styles.gridImage} />
        <View style={styles.gridOverlay}>
          <Text style={styles.gridActivity}>{item.activity_type}</Text>
          {(likeInfo?.count || commentCount) ? (
            <View style={styles.gridStats}>
              {!!likeInfo?.count && (
                <View style={styles.gridStatItem}>
                  <Ionicons name="heart" size={11} color="#fff" />
                  <Text style={styles.gridStatText}>{likeInfo.count}</Text>
                </View>
              )}
              {!!commentCount && (
                <View style={styles.gridStatItem}>
                  <Ionicons name="chatbubble" size={11} color="#fff" />
                  <Text style={styles.gridStatText}>{commentCount}</Text>
                </View>
              )}
            </View>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  const renderHeader = () => (
    <View style={styles.profileHeader}>
      <View style={styles.statsRow}>
        <Image source={{ uri: userProfile?.avatar_url || 'https://via.placeholder.com/150' }} style={styles.profileAvatar} />
        <View style={styles.statsContainer}>
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>{stats.posts}</Text>
            <Text style={styles.statLabel}>Posts</Text>
          </View>
          <TouchableOpacity style={styles.statBox} onPress={() => openNetworkList('followers')}>
            <Text style={styles.statNumber}>{stats.followers}</Text>
            <Text style={styles.statLabel}>Followers</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.statBox} onPress={() => openNetworkList('following')}>
            <Text style={styles.statNumber}>{stats.following}</Text>
            <Text style={styles.statLabel}>Following</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.bioContainer}>
        <Text style={styles.bioName}>{userProfile?.display_name || 'Set your name'}</Text>
        <Text style={styles.bioText}>{userProfile?.bio || 'Sweat now, shine later. 💧'}</Text>
      </View>

      <View style={styles.actionButtons}>
        {isOwnProfile ? (
          <TouchableOpacity style={styles.editButton} onPress={() => setIsEditingProfile(true)}>
            <Text style={styles.editButtonText}>Edit Profile</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[
              styles.editButton,
              !isFollowing && { backgroundColor: colors.primary, borderColor: colors.primary },
              followBusy && { opacity: 0.6 }
            ]}
            onPress={toggleFollow}
            disabled={followBusy}
          >
            <Text style={[styles.editButtonText, !isFollowing && { color: '#fff' }]}>
              {isFollowing ? 'Following' : 'Follow'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
      
      <View style={styles.gridTabs}>
        <Ionicons name="grid-outline" size={24} color={colors.text} />
      </View>
    </View>
  );

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.topNav}>
        {isOwnProfile ? (
          <View style={{ width: 28 }} />
        ) : (
          <TouchableOpacity onPress={() => navigation?.goBack?.()}>
            <Ionicons name="arrow-back" size={28} color={colors.text} />
          </TouchableOpacity>
        )}
        <Text style={styles.navUsername}>@{userProfile?.username || 'username'}</Text>
        {isOwnProfile ? (
          <TouchableOpacity onPress={() => setIsSettingsVisible(true)}>
            <Ionicons name="settings-outline" size={28} color={colors.text} />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 28 }} />
        )}
      </View>

      <FlatList
        data={workouts}
        keyExtractor={item => item.id}
        numColumns={3}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
        ListHeaderComponent={renderHeader}
        renderItem={renderGridItem}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={<Text style={styles.emptyText}>No workouts logged yet. Time to hit the gym!</Text>}
      />

      {/* --- MODAL 1: SETTINGS --- */}
      <Modal visible={isSettingsVisible} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setIsSettingsVisible(false)}>
              <Ionicons name="close" size={28} color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Settings</Text>
            <View style={{ width: 28 }} />
          </View>
          <View style={{ padding: 20 }}>
            <View style={styles.settingsCard}>
              <View style={styles.settingsRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name={theme === 'dark' ? 'moon' : 'sunny'} size={24} color={colors.primary} style={{ marginRight: 15 }} />
                  <Text style={styles.settingsRowText}>Dark Mode</Text>
                </View>
                <Switch value={theme === 'dark'} onValueChange={toggleTheme} trackColor={{ false: '#e5e5ea', true: colors.primary }} />
              </View>
            </View>

            <View style={styles.settingsCard}>
              <View style={styles.settingsRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="flame" size={24} color={colors.primary} style={{ marginRight: 15 }} />
                  <Text style={styles.settingsRowText}>Morning Roasts (9AM)</Text>
                </View>
                <Switch
                  value={prefs?.daily_roast ?? true}
                  onValueChange={(v) => togglePref('daily_roast', v)}
                  trackColor={{ false: '#e5e5ea', true: colors.primary }}
                />
              </View>
              <View style={[styles.settingsRow, { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 10, paddingTop: 10 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="notifications" size={24} color={colors.primary} style={{ marginRight: 15 }} />
                  <Text style={styles.settingsRowText}>New Posts from Friends</Text>
                </View>
                <Switch
                  value={prefs?.new_posts ?? true}
                  onValueChange={(v) => togglePref('new_posts', v)}
                  trackColor={{ false: '#e5e5ea', true: colors.primary }}
                />
              </View>
              <View style={[styles.settingsRow, { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 10, paddingTop: 10 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="heart" size={24} color={colors.primary} style={{ marginRight: 15 }} />
                  <Text style={styles.settingsRowText}>Likes</Text>
                </View>
                <Switch
                  value={prefs?.likes ?? true}
                  onValueChange={(v) => togglePref('likes', v)}
                  trackColor={{ false: '#e5e5ea', true: colors.primary }}
                />
              </View>
              <View style={[styles.settingsRow, { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 10, paddingTop: 10 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="chatbubble" size={24} color={colors.primary} style={{ marginRight: 15 }} />
                  <Text style={styles.settingsRowText}>Comments</Text>
                </View>
                <Switch
                  value={prefs?.comments ?? true}
                  onValueChange={(v) => togglePref('comments', v)}
                  trackColor={{ false: '#e5e5ea', true: colors.primary }}
                />
              </View>
              <View style={[styles.settingsRow, { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 10, paddingTop: 10 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="person-add" size={24} color={colors.primary} style={{ marginRight: 15 }} />
                  <Text style={styles.settingsRowText}>New Followers</Text>
                </View>
                <Switch
                  value={prefs?.follows ?? true}
                  onValueChange={(v) => togglePref('follows', v)}
                  trackColor={{ false: '#e5e5ea', true: colors.primary }}
                />
              </View>
              <View style={[styles.settingsRow, { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 10, paddingTop: 10 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="chatbubbles" size={24} color={colors.primary} style={{ marginRight: 15 }} />
                  <Text style={styles.settingsRowText}>Chat Messages</Text>
                </View>
                <Switch
                  value={prefs?.chats ?? true}
                  onValueChange={(v) => togglePref('chats', v)}
                  trackColor={{ false: '#e5e5ea', true: colors.primary }}
                />
              </View>
              <View style={[styles.settingsRow, { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 10, paddingTop: 10 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="phone-portrait" size={24} color={colors.primary} style={{ marginRight: 15 }} />
                  <Text style={styles.settingsRowText}>Push Notifications</Text>
                </View>
                <Switch
                  value={prefs?.push_enabled ?? true}
                  onValueChange={(v) => togglePref('push_enabled', v)}
                  trackColor={{ false: '#e5e5ea', true: colors.primary }}
                />
              </View>
            </View>

            <TouchableOpacity style={[styles.settingsCard, { alignItems: 'center', marginTop: 20 }]} onPress={handleLogout}>
              <Text style={{ color: '#ff3b30', fontSize: 18, fontWeight: '700' }}>Sign Out</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* --- MODAL 2: NETWORK LIST --- */}
      <Modal visible={networkType !== null} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setNetworkType(null)}><Ionicons name="close" size={28} color={colors.text} /></TouchableOpacity>
            <Text style={styles.modalTitle}>{networkType === 'followers' ? 'Followers' : 'Following'}</Text>
            <View style={{ width: 28 }} />
          </View>
          {loadingNetwork ? (
             <ActivityIndicator style={{ marginTop: 50 }} color={colors.primary} />
          ) : (
            <FlatList
              data={networkList}
              keyExtractor={item => item.id}
              contentContainerStyle={styles.networkList}
              renderItem={({ item }) => (
                <View style={styles.networkCard}>
                  <Image source={{ uri: item.avatar_url || 'https://via.placeholder.com/150' }} style={styles.networkAvatar} />
                  <View style={styles.networkInfo}>
                    <Text style={styles.networkName}>{item.display_name || item.username}</Text>
                    <Text style={styles.networkUsername}>@{item.username}</Text>
                  </View>
                </View>
              )}
              ListEmptyComponent={<Text style={styles.emptyText}>No users found.</Text>}
            />
          )}
        </View>
      </Modal>

      {/* --- MODAL 3: INSTAGRAM POST VIEWER --- */}
      <Modal visible={selectedPost !== null} animationType="slide">
        <SafeAreaView style={styles.postContainer}>
          <View style={styles.postHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TouchableOpacity onPress={() => setSelectedPost(null)} style={{ marginRight: 15 }}>
                 <Ionicons name="chevron-back" size={28} color={colors.text} />
              </TouchableOpacity>
              <Image source={{ uri: userProfile?.avatar_url || 'https://via.placeholder.com/150' }} style={styles.postAvatar} />
              <View>
                <Text style={styles.postUsername}>{userProfile?.username}</Text>
                <Text style={styles.postLocation}>{selectedPost?.activity_type}</Text>
              </View>
            </View>
            
            {/* UPDATED: TRIGGER ACTION SHEET (only on own posts) */}
            {isOwnProfile ? (
              <TouchableOpacity onPress={() => {
                setActionSheetConfig({
                  title: "What would you like to do?",
                  options: [
                    { text: "Edit Caption", onPress: () => setIsEditingPost(true) },
                    { text: "Delete Post", style: "destructive", onPress: triggerDeletePost },
                    { text: "Cancel", style: "cancel", onPress: () => {} }
                  ]
                });
                setActionSheetVisible(true);
              }}>
                <Ionicons name="ellipsis-horizontal" size={24} color={colors.text} />
              </TouchableOpacity>
            ) : (
              <View style={{ width: 24 }} />
            )}

          </View>

          <Image source={{ uri: selectedPost?.image_url }} style={styles.postImage} />

          <View style={styles.postInteractionBar}>
            <View style={{ flexDirection: 'row' }}>
              <TouchableOpacity onPress={handlePostLikeToggle} style={styles.postIcon}>
                 <Ionicons name={postLikes.likedByMe ? "heart" : "heart-outline"} size={28} color={postLikes.likedByMe ? "#ff4040" : colors.text} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.postIcon}>
                 <Ionicons name="chatbubble-outline" size={26} color={colors.text} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.postIcon}>
                 <Ionicons name="paper-plane-outline" size={26} color={colors.text} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.postDetails}>
            <TouchableOpacity onPress={() => postLikes.count > 0 && setShowPostLikersSheet(true)}>
              <Text style={styles.likesText}>
                {postLikes.count} {postLikes.count === 1 ? 'like' : 'likes'}
              </Text>
            </TouchableOpacity>
            
            {/* Stats as chips (read-only, just visual context for the caption below) */}
            <View style={styles.captionStatsRow}>
              {selectedPost?.duration_minutes ? (
                <View style={styles.captionChip}>
                  <Ionicons name="time-outline" size={12} color={colors.textMuted} />
                  <Text style={styles.captionChipText}>{selectedPost.duration_minutes} min</Text>
                </View>
              ) : null}
              {selectedPost?.distance ? (
                <View style={styles.captionChip}>
                  <Ionicons name="map-outline" size={12} color={colors.textMuted} />
                  <Text style={styles.captionChipText}>{selectedPost.distance}</Text>
                </View>
              ) : null}
              {selectedPost?.calories ? (
                <View style={styles.captionChip}>
                  <Ionicons name="flame-outline" size={12} color={colors.textMuted} />
                  <Text style={styles.captionChipText}>{selectedPost.calories} kcal</Text>
                </View>
              ) : null}
            </View>

            {/* Caption text */}
            {isEditingPost ? (
              <View style={styles.editPostForm}>
                <TextInput
                  style={styles.editPostInput}
                  value={editPostNotes}
                  onChangeText={setEditPostNotes}
                  autoFocus
                  multiline
                  placeholder="Write a caption..."
                  placeholderTextColor={colors.textMuted}
                  maxLength={500}
                />
                <View style={styles.editPostActions}>
                  <TouchableOpacity onPress={() => setIsEditingPost(false)}><Text style={styles.editPostCancel}>Cancel</Text></TouchableOpacity>
                  <TouchableOpacity onPress={savePostEdit}><Text style={styles.editPostSave}>Save</Text></TouchableOpacity>
                </View>
              </View>
            ) : selectedPost?.notes ? (
              <TouchableOpacity
                onPress={() => isOwnProfile && setIsEditingPost(true)}
                activeOpacity={isOwnProfile ? 0.6 : 1}
              >
                <Text style={styles.captionText}>
                  <Text style={styles.captionUsername}>{userProfile?.username} </Text>
                  {selectedPost.notes}
                </Text>
              </TouchableOpacity>
            ) : isOwnProfile ? (
              <TouchableOpacity onPress={() => setIsEditingPost(true)} activeOpacity={0.6}>
                <Text style={styles.captionPlaceholder}>+ Add a caption</Text>
              </TouchableOpacity>
            ) : null}
            <Text style={styles.timeText}>
              {selectedPost?.created_at && (
                <>
                  {new Date(selectedPost.created_at).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} at {new Date(selectedPost.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {" • "}
                  {timeSince(selectedPost.created_at)}
                </>
              )}
            </Text>

            {/* COMMENTS */}
            <View style={styles.profileCommentsSection}>
              {postComments.length > 0 && (
                <ScrollView style={{ maxHeight: 200 }}>
                  {postComments.map((c: any) => (
                    <View key={c.id} style={styles.profileCommentRow}>
                      <Image source={{ uri: c.profiles?.avatar_url || 'https://via.placeholder.com/40' }} style={styles.profileCommentAvatar} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.profileCommentName, { color: colors.text }]}>
                          {c.profiles?.display_name || c.profiles?.username || 'User'}
                        </Text>
                        <Text style={{ color: colors.text, fontSize: 14 }}>{c.content}</Text>
                      </View>
                    </View>
                  ))}
                </ScrollView>
              )}
              <View style={[styles.profileCommentInputRow, { borderTopColor: colors.border }]}>
                <TextInput
                  style={[styles.profileCommentInput, { color: colors.text, backgroundColor: colors.surface }]}
                  placeholder="Add a comment..."
                  placeholderTextColor={colors.textMuted}
                  value={postCommentDraft}
                  onChangeText={setPostCommentDraft}
                  maxLength={500}
                  editable={!postingPostComment}
                />
                <TouchableOpacity
                  style={[!postCommentDraft.trim() && { opacity: 0.4 }]}
                  onPress={handleAddPostComment}
                  disabled={!postCommentDraft.trim() || postingPostComment}
                >
                  <Text style={{ color: colors.primary, fontWeight: '700' }}>{postingPostComment ? '...' : 'Post'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </SafeAreaView>
      </Modal>

      {/* POST LIKERS SHEET */}
      <Modal
        visible={showPostLikersSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPostLikersSheet(false)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <TouchableOpacity style={{ flex: 1 }} onPress={() => setShowPostLikersSheet(false)} />
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 30, maxHeight: '70%' }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(127,127,127,0.4)', alignSelf: 'center', marginTop: 10, marginBottom: 10 }} />
            <Text style={{ fontSize: 17, fontWeight: '700', textAlign: 'center', paddingBottom: 15, color: colors.text }}>Liked by</Text>
            <ScrollView style={{ paddingHorizontal: 20, maxHeight: 380 }}>
              {postLikes.likers.map((p: any) => (
                <View key={p.id} style={styles.profileCommentRow}>
                  <Image source={{ uri: p.avatar_url || 'https://via.placeholder.com/40' }} style={styles.profileCommentAvatar} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.profileCommentName, { color: colors.text }]}>{p.display_name || p.username}</Text>
                    <Text style={{ color: colors.textMuted, fontSize: 13 }}>@{p.username}</Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* --- MODAL 4: EDIT PROFILE FORM --- */}
      <Modal visible={isEditingProfile} animationType="slide" presentationStyle="pageSheet">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setIsEditingProfile(false)}><Text style={styles.modalCancel}>Cancel</Text></TouchableOpacity>
            <Text style={styles.modalTitle}>Edit Profile</Text>
            <TouchableOpacity onPress={saveProfile}>
              {saving ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.modalSave}>Done</Text>}
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.formContainer} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>
            <TouchableOpacity onPress={pickAvatar} style={styles.avatarEditContainer}>
              <Image source={{ uri: editAvatarUrl || 'https://via.placeholder.com/150' }} style={styles.editAvatar} />
              <Text style={styles.changePhotoText}>Change Profile Photo</Text>
            </TouchableOpacity>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Name</Text>
              <TextInput style={styles.input} value={editDisplayName} onChangeText={setEditDisplayName} placeholder="Name" placeholderTextColor={colors.textMuted} />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Username</Text>
              <TextInput style={styles.input} value={editUsername} onChangeText={setEditUsername} placeholder="Username" autoCapitalize="none" placeholderTextColor={colors.textMuted} />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Bio</Text>
              <TextInput
                style={[styles.input, { minHeight: 70, textAlignVertical: 'top', paddingTop: 12 }]}
                value={editBio}
                onChangeText={setEditBio}
                placeholder="A short tagline or motto..."
                placeholderTextColor={colors.textMuted}
                multiline
                maxLength={160}
              />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* --- ADDED ACTION SHEET --- */}
      <ActionSheet 
        visible={actionSheetVisible}
        title={actionSheetConfig.title}
        options={actionSheetConfig.options || []}
        onClose={() => setActionSheetVisible(false)}
      />

    </SafeAreaView>
  );
}

// --- DYNAMIC STYLES ---
const getStyles = (colors: any, theme: string) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  
  topNav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 15, paddingBottom: 10 },
  navUsername: { fontSize: 22, fontWeight: '800', color: colors.text },

  profileHeader: { paddingBottom: 0 },
  statsRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, marginTop: 10 },
  profileAvatar: { width: 86, height: 86, borderRadius: 43 },
  statsContainer: { flex: 1, flexDirection: 'row', justifyContent: 'space-around', marginLeft: 20 },
  statBox: { alignItems: 'center' },
  statNumber: { fontSize: 18, fontWeight: '800', color: colors.text },
  statLabel: { fontSize: 13, color: colors.textMuted, marginTop: 2 },

  bioContainer: { paddingHorizontal: 15, marginTop: 12 },
  bioName: { fontSize: 15, fontWeight: '700', color: colors.text },
  bioText: { fontSize: 14, color: colors.textMuted, marginTop: 2 },

  actionButtons: { paddingHorizontal: 15, marginTop: 15 },
  editButton: { backgroundColor: colors.surface, borderRadius: 8, paddingVertical: 8, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  editButtonText: { fontSize: 14, fontWeight: '700', color: colors.text },

  gridTabs: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 20, paddingVertical: 10, alignItems: 'center' },
  gridItem: { width: GRID_SIZE, height: GRID_SIZE, borderWidth: 0.5, borderColor: colors.background },
  gridImage: { width: '100%', height: '100%', resizeMode: 'cover', backgroundColor: colors.surface },
  gridOverlay: { position: 'absolute', bottom: 5, left: 5, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  gridActivity: { color: '#fff', fontSize: 10, fontWeight: '800' },
  emptyText: { textAlign: 'center', color: colors.textMuted, marginTop: 40, paddingHorizontal: 20 },

  modalContent: { flex: 1, backgroundColor: colors.background },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 15, borderBottomWidth: 1, borderBottomColor: colors.border },
  modalCancel: { fontSize: 16, color: colors.text },
  modalTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  modalSave: { fontSize: 16, fontWeight: '700', color: colors.primary },
  formContainer: { padding: 20 },
  avatarEditContainer: { alignItems: 'center', marginBottom: 30 },
  editAvatar: { width: 100, height: 100, borderRadius: 50, marginBottom: 10 },
  changePhotoText: { color: colors.primary, fontSize: 14, fontWeight: '700' },
  inputGroup: { marginBottom: 20, borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 5 },
  label: { fontSize: 12, color: colors.textMuted, marginBottom: 5 },
  input: { fontSize: 16, color: colors.text, paddingVertical: 5 },

  // Settings Styles
  settingsCard: { backgroundColor: colors.surface, borderRadius: 16, padding: 20, marginBottom: 15 },
  settingsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5 },
  settingsRowText: { fontSize: 18, fontWeight: '600', color: colors.text },

  // Network List Styles
  networkList: { padding: 15 },
  networkCard: { flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
  networkAvatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: colors.surface },
  networkInfo: { marginLeft: 15, flex: 1 },
  networkName: { fontSize: 16, fontWeight: '700', color: colors.text },
  networkUsername: { fontSize: 14, color: colors.textMuted, marginTop: 2 },

  // Instagram Post Styles
  postContainer: { flex: 1, backgroundColor: colors.background },
  postHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 15, paddingVertical: 10 },
  postAvatar: { width: 36, height: 36, borderRadius: 18, marginRight: 10 },
  postUsername: { fontSize: 14, fontWeight: '700', color: colors.text },
  postLocation: { fontSize: 12, color: colors.textMuted },
  postImage: { width: width, aspectRatio: 9/16, resizeMode: 'cover', backgroundColor: colors.surface },
  postInteractionBar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 15, paddingVertical: 12 },
  postIcon: { marginRight: 15 },
  postDetails: { paddingHorizontal: 15 },
  likesText: { fontWeight: '700', color: colors.text, marginBottom: 5 },
  profileCommentsSection: { marginTop: 14 },
  profileCommentRow: { flexDirection: 'row', paddingVertical: 8 },
  profileCommentAvatar: { width: 32, height: 32, borderRadius: 16, marginRight: 10, backgroundColor: '#eee' },
  profileCommentName: { fontSize: 13, fontWeight: '700', marginBottom: 2 },
  profileCommentInputRow: { flexDirection: 'row', alignItems: 'center', paddingTop: 12, marginTop: 6, borderTopWidth: 1 },
  profileCommentInput: { flex: 1, height: 38, borderRadius: 19, paddingHorizontal: 14, fontSize: 14, marginRight: 10 },
  gridStats: { flexDirection: 'row', marginTop: 4 },
  gridStatItem: { flexDirection: 'row', alignItems: 'center', marginRight: 8 },
  gridStatText: { color: '#fff', fontSize: 10, fontWeight: '700', marginLeft: 3 },
  captionStatsRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4, marginBottom: 10 },
  captionChip: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: 12,
    paddingVertical: 4, paddingHorizontal: 10,
    marginRight: 6, marginBottom: 6,
  },
  captionChipText: { fontSize: 12, color: colors.text, marginLeft: 4, fontWeight: '600' },
  captionText: { fontSize: 14, color: colors.text, lineHeight: 20 },
  captionUsername: { fontWeight: '700' },
  captionPlaceholder: { fontSize: 14, color: colors.textMuted, fontStyle: 'italic', paddingVertical: 6 },
  timeText: { fontSize: 12, color: colors.textMuted, marginTop: 8 },
  
  // Inline Edit Post Styles
  editPostForm: { marginTop: 5 },
  editPostInput: {
    backgroundColor: colors.surface,
    borderRadius: 12, padding: 12,
    fontSize: 14, color: colors.text,
    minHeight: 80, textAlignVertical: 'top',
  },
  editPostActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 },
  editPostCancel: { color: colors.textMuted, fontWeight: '600', marginRight: 15 },
  editPostSave: { color: colors.primary, fontWeight: '700' }
});