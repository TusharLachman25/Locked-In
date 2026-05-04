import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  View, Text, StyleSheet, FlatList, TouchableOpacity, Pressable,
  ActivityIndicator, LayoutAnimation, Platform, UIManager, 
  Modal, ScrollView, Image, Dimensions, Animated, Alert, RefreshControl, PanResponder, TextInput
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons'; 
import { supabase } from './supabase';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useTheme } from './ThemeContext'; // <-- THEME BRAIN
import { useCustomAlert } from './AlertContext';
import {
  toggleLike, fetchLikes, fetchComments, addComment,
  recordStoryView, fetchStoryViewers, shareStoryNative
} from './social';
import { fetchUnreadCount } from './notificationsApi';

const { width, height } = Dimensions.get('window');

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// --- MATH & HELPERS ---
// Activities that earn a +5 bonus just for logging.
// Soft activities (Casual football, Beach Volleyball, Table Tennis, Stretching)
// get pure effort points.
const LOG_BONUS_ELIGIBLE = new Set([
  'Gym', 'Running', 'Swim', 'Padel', 'Badminton',
  'Football (Competitive)', 'Volleyball', 'Cricket'
]);

const calculatePoints = (activity: string, duration: number, distance: string) => {
  let effortPoints = 0;
  const numericValue = parseFloat((distance || '').replace(/[^0-9.]/g, '')) || 0;

  switch (activity) {
    case 'Swim':                    effortPoints = (numericValue / 100) * 6; break;   // 6 pts per 100 m
    case 'Running':                 effortPoints = numericValue * 13; break;          // 13 pts per 1 km
    case 'Football (Competitive)':  effortPoints = duration * 1.1; break;
    case 'Badminton':               effortPoints = duration * 0.95; break;
    case 'Volleyball':              effortPoints = duration * 0.9; break;
    case 'Padel':                   effortPoints = duration * 0.85; break;
    case 'Gym':                     effortPoints = duration * 0.75; break;
    case 'Football (Casual)':       effortPoints = duration * 0.7; break;
    case 'Beach Volleyball':        effortPoints = duration * 0.7; break;
    case 'Cricket':                 effortPoints = duration * 0.6; break;
    case 'Table Tennis':            effortPoints = duration * 0.5; break;
    case 'Stretching':              effortPoints = duration * 0.25; break;
    default:                        effortPoints = duration * 0.25;
  }

  const basePoints = LOG_BONUS_ELIGIBLE.has(activity) ? 5 : 0;
  return Math.round(basePoints + effortPoints);
};

const formatWeekRange = (weeksAgo: number) => {
  if (weeksAgo === 0) return 'This Week';
  if (weeksAgo === 1) return 'Last Week';

  const now = new Date();
  const day = now.getUTCDay();
  const diffToMonday = day === 0 ? 6 : day - 1; 
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diffToMonday));
  start.setUTCDate(start.getUTCDate() - (weeksAgo * 7));
  const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000); 

  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${start.toLocaleDateString(undefined, options)} - ${end.toLocaleDateString(undefined, options)}`;
};

// Instagram-style relative time: "now", "5m", "3h", "2d", "1w"
const formatTimeAgo = (timestamp: string | number | undefined) => {
  if (!timestamp) return '';
  const then = new Date(timestamp).getTime();
  if (isNaN(then)) return '';

  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w`;
};

const ROASTS = [
  "Bro skipped leg day... and arm day... and chest day.",
  "Couch potato mode activated 🥔",
  "All talk, no walk. Literally.",
  "Even a sloth moves more than this.",
  "Your muscles are staging a protest.",
  "Did you get lost on the way to the gym?",
  "Rest day? More like rest week.",
  "Zero points. Zero effort. Zero respect.",
  "The only heavy lifting you did was the TV remote."
];

// Small helper for playing story videos. expo-video uses hooks (useVideoPlayer)
// so we can't call it inline in JSX — it needs its own component.
function StoryVideo({ uri, style }: { uri: string; style: any }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.play();
  });
  return (
    <VideoView
      player={player}
      style={style}
      contentFit="contain"
      nativeControls={false}
    />
  );
}

export default function Feed() {
  const { showAlert } = useCustomAlert();
  const { colors, theme } = useTheme();
  const styles = useMemo(() => getStyles(colors, theme), [colors, theme]);
  const navigation = useNavigation<any>();

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<any[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sortField, setSortField] = useState<'points' | 'duration' | 'calories'>('points');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [showInfo, setShowInfo] = useState(false);
  const [weeksAgo, setWeeksAgo] = useState(0);
  
  const [activeStoryIndex, setActiveStoryIndex] = useState<number | null>(null);
  const [viewedStoryUser, setViewedStoryUser] = useState<any>(null);
  const [isStoryPaused, setIsStoryPaused] = useState(false);
  const progressAnimation = useRef(new Animated.Value(0)).current;

  // Story interactions for whichever story is currently open in the modal.
  // Re-fetched whenever activeStoryIndex changes.
  const [storyLikes, setStoryLikes] = useState<{ count: number; likedByMe: boolean; likers: any[] }>({ count: 0, likedByMe: false, likers: [] });
  const [storyComments, setStoryComments] = useState<any[]>([]);
  const [showCommentsSheet, setShowCommentsSheet] = useState(false);
  const [showLikersSheet, setShowLikersSheet] = useState(false);
  const [showViewersSheet, setShowViewersSheet] = useState(false);
  const [storyViewers, setStoryViewers] = useState<any[]>([]);
  const [commentDraft, setCommentDraft] = useState('');
  const [postingComment, setPostingComment] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      supabase.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id || null));
      fetchFeedData();
      fetchUnreadCount().then(setUnreadCount).catch(() => {});
    }, [weeksAgo]) 
  );

  // Realtime subscription on the notifications table — keeps the bell badge live
  // even while the user stays on the Feed screen.
  useEffect(() => {
    if (!currentUserId) return;
    const channel = supabase
      .channel(`notifications:${currentUserId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${currentUserId}` },
        () => {
          fetchUnreadCount().then(setUnreadCount).catch(() => {});
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [currentUserId]);

  // Track which story is currently being played, so we know whether
  // to reset progress (new story) or resume (just unpausing).
  const playingStoryKeyRef = useRef<string | null>(null);

  useEffect(() => {
    // Don't auto-advance while a sheet is open or story is paused (long-press)
    if (showCommentsSheet || showLikersSheet || showViewersSheet || isStoryPaused) {
      progressAnimation.stopAnimation();
      return;
    }

    if (viewedStoryUser && activeStoryIndex !== null) {
      const currentKey = `${viewedStoryUser.id}:${activeStoryIndex}`;
      const isNewStory = playingStoryKeyRef.current !== currentKey;
      playingStoryKeyRef.current = currentKey;

      const TOTAL_MS = 5000;

      if (isNewStory) {
        // Brand-new story: reset and play full duration
        progressAnimation.setValue(0);
        Animated.timing(progressAnimation, {
          toValue: 1,
          duration: TOTAL_MS,
          useNativeDriver: false,
        }).start(({ finished }) => {
          if (finished) handleNextStory();
        });
      } else {
        // Resuming after pause: continue from current value
        progressAnimation.stopAnimation((current) => {
          const remaining = TOTAL_MS * (1 - current);
          Animated.timing(progressAnimation, {
            toValue: 1,
            duration: remaining > 0 ? remaining : TOTAL_MS,
            useNativeDriver: false,
          }).start(({ finished }) => {
            if (finished) handleNextStory();
          });
        });
      }
    } else {
      // Story closed
      playingStoryKeyRef.current = null;
    }
  }, [viewedStoryUser, activeStoryIndex, showCommentsSheet, showLikersSheet, showViewersSheet, isStoryPaused]);

  // Helper to read the currently-active story object (or null if it's a roast).
  const activeStory = (viewedStoryUser && activeStoryIndex !== null)
    ? viewedStoryUser.stories[activeStoryIndex]
    : null;
  const activeWorkoutId: string | null = activeStory?.workout_id || null;

  // Load likes + comments + record view when the active story changes.
  useEffect(() => {
    if (!activeWorkoutId || !currentUserId) {
      setStoryLikes({ count: 0, likedByMe: false, likers: [] });
      setStoryComments([]);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const [likes, comments] = await Promise.all([
          fetchLikes(activeWorkoutId, currentUserId),
          fetchComments(activeWorkoutId),
        ]);
        if (!cancelled) {
          setStoryLikes(likes);
          setStoryComments(comments);
        }
      } catch (e) { console.warn('Failed to load story interactions:', e); }

      // Record a view (don't await, don't block UI). Skip if I'm viewing my own story.
      if (viewedStoryUser?.id !== currentUserId) {
        recordStoryView(activeWorkoutId, currentUserId).catch(() => {});
      }
    })();

    return () => { cancelled = true; };
  }, [activeWorkoutId, currentUserId, viewedStoryUser?.id]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchFeedData();
    setRefreshing(false);
  };

  const fetchFeedData = async () => {
    try {
      setLoading(true);

      // 1. Figure out who the current user is
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setData([]); return; }

      // 2. Get the IDs the current user follows
      const { data: followRows } = await supabase
        .from('follows')
        .select('following_id')
        .eq('follower_id', user.id);

      const followedIds = (followRows || []).map(r => r.following_id);
      // Always include the current user — they should see themselves on their own leaderboard
      const visibleIds = Array.from(new Set([user.id, ...followedIds]));

      // 3. Fetch only the profiles of people in that list
      const { data: profiles } = await supabase
        .from('profiles')
        .select('*')
        .in('id', visibleIds);

      const yesterdayDate = new Date();
      yesterdayDate.setDate(yesterdayDate.getDate() - 1);

      const getStartOfWeekUTC = (weeksBack: number) => {
        const now = new Date();
        const day = now.getUTCDay();
        const diffToMonday = day === 0 ? 6 : day - 1;
        const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diffToMonday));
        start.setUTCDate(start.getUTCDate() - (weeksBack * 7));
        return start;
      };

      const startOfWeekDate = getStartOfWeekUTC(weeksAgo);
      const endOfWeekDate = new Date(startOfWeekDate.getTime() + 7 * 24 * 60 * 60 * 1000);

      const fetchThreshold = startOfWeekDate < yesterdayDate ? startOfWeekDate : yesterdayDate;

      // 4. Workouts only from visible users
      const { data: workouts } = await supabase
        .from('workouts')
        .select('*')
        .in('user_id', visibleIds)
        .gte('created_at', fetchThreshold.toISOString())
        .order('created_at', { ascending: true });

      if (!profiles) return;

      // 4b. Which of these workouts have I viewed? Used for the grey/gradient ring.
      // RLS lets a viewer see only their own row in workout_views, so this is fine.
      const recentWorkoutIds = (workouts || [])
        .filter(w => new Date(w.created_at) >= yesterdayDate)
        .map(w => w.id);
      let viewedIds = new Set<string>();
      if (recentWorkoutIds.length > 0) {
        const { data: viewRows, error: viewErr } = await supabase
          .from('workout_views')
          .select('workout_id')
          .eq('viewer_id', user.id)
          .in('workout_id', recentWorkoutIds);
        if (viewErr) {
          console.warn('[Feed] workout_views fetch failed:', viewErr.message);
        }
        viewedIds = new Set((viewRows || []).map(r => r.workout_id));
      }

      const processed = profiles.map(profile => {
        const allUserWorkouts = workouts?.filter(w => w.user_id === profile.id) || [];

        const weeklyWorkouts = allUserWorkouts.filter(w => {
           const d = new Date(w.created_at);
           return d >= startOfWeekDate && d < endOfWeekDate;
        });

        // Stories within a single user: oldest -> newest (Instagram-style chronological)
        const recentWorkouts = allUserWorkouts
          .filter(w => new Date(w.created_at) >= yesterdayDate)
          .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        let stories: any[] = recentWorkouts.map(w => ({
          type: 'image',
          url: w.image_url,
          created_at: w.created_at,
          workout_id: w.id,
        }));

        const name = profile.display_name || profile.username || profile.name || 'User';
        const isCurrent = profile.id === user.id;

        const hasPostedStory = stories.length > 0;

        // For the story strip ring color: have I viewed every one of this user's
        // recent stories? Also true (vacuously) when there are no stories.
        // Always false for my own stories — Instagram doesn't grey out your own.
        const allStoriesViewed = hasPostedStory
          ? recentWorkouts.every(w => viewedIds.has(w.id))
          : false;

        if (!hasPostedStory) {
          stories.push({ type: 'roast', text: ROASTS[Math.floor(Math.random() * ROASTS.length)] });
        }

        let totalDuration = 0, totalCalories = 0, totalPoints = 0;
        let weeklyList = weeklyWorkouts.map(w => {
          const pts = calculatePoints(w.activity_type, w.duration_minutes, w.distance);
          totalDuration += w.duration_minutes;
          totalCalories += (w.calories || 0);
          totalPoints += pts;
          return { ...w, points: pts };
        });

        // Latest real story timestamp (used for sorting the story strip).
        // Roast/placeholder entries don't count as "recent activity".
        const latestStoryAt = recentWorkouts.length > 0
          ? new Date(recentWorkouts[recentWorkouts.length - 1].created_at).getTime()
          : 0;

        return {
          id: profile.id, name: name,
          avatar: profile.avatar_url || 'https://via.placeholder.com/150',
          totalDuration, totalCalories, totalPoints,
          weeklyWorkouts: weeklyList,
          stories: stories,
          hasPostedStory: hasPostedStory,
          allStoriesViewed,
          latestStoryAt,
          isCurrentUser: isCurrent
        };
      });

      setData(processed.sort((a, b) => b.totalPoints - a.totalPoints));
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  const handleSort = (field: 'points' | 'duration' | 'calories') => {
    const newOrder = sortField === field && sortOrder === 'desc' ? 'asc' : 'desc';
    setSortField(field); setSortOrder(newOrder);
    const sorted = [...data].sort((a, b) => {
      let valA = a.totalPoints, valB = b.totalPoints;
      if (field === 'duration') { valA = a.totalDuration; valB = b.totalDuration; }
      if (field === 'calories') { valA = a.totalCalories; valB = b.totalCalories; }
      return newOrder === 'desc' ? valB - valA : valA - valB;
    });
    setData(sorted);
  };

  const openStory = (user: any) => { setViewedStoryUser(user); setActiveStoryIndex(0); };
  const closeStory = () => {
    progressAnimation.stopAnimation();
    // Capture which user's stories we were just viewing — used to update the
    // ring color in place. We do this before clearing viewedStoryUser.
    const justViewedUserId = viewedStoryUser?.id;
    setViewedStoryUser(null);
    setActiveStoryIndex(null);

    // Mark all of that user's stories as viewed in local state, so the ring
    // turns grey immediately. No re-fetch needed.
    if (justViewedUserId && justViewedUserId !== currentUserId) {
      setData(prev => prev.map(u =>
        u.id === justViewedUserId ? { ...u, allStoriesViewed: true } : u
      ));
    }
  };

  const handleNextStory = () => {
    progressAnimation.stopAnimation();
    if (!viewedStoryUser || activeStoryIndex === null) return;

    // Still more stories from this user? Advance within them.
    if (activeStoryIndex < viewedStoryUser.stories.length - 1) {
      setActiveStoryIndex(prev => prev! + 1);
      return;
    }

    // Otherwise jump to the next user in the story strip — but only consider
    // users who actually have a posted story. A user whose only "story" is a
    // roast placeholder shouldn't auto-play.
    const playable = storyStripUsers.filter(u => u.hasPostedStory);
    const currentIdx = playable.findIndex(u => u.id === viewedStoryUser.id);

    if (currentIdx !== -1 && currentIdx < playable.length - 1) {
      const nextUser = playable[currentIdx + 1];
      setViewedStoryUser(nextUser);
      setActiveStoryIndex(0);
    } else {
      // No more users — close.
      closeStory();
    }
  };

  const handlePrevStory = () => {
    progressAnimation.stopAnimation();
    if (!viewedStoryUser || activeStoryIndex === null) return;

    // Tap-back within the current user goes to the previous story.
    if (activeStoryIndex > 0) {
      setActiveStoryIndex(prev => prev! - 1);
      return;
    }

    // Otherwise jump to the previous user's last story.
    const playable = storyStripUsers.filter(u => u.hasPostedStory);
    const currentIdx = playable.findIndex(u => u.id === viewedStoryUser.id);

    if (currentIdx > 0) {
      const prevUser = playable[currentIdx - 1];
      setViewedStoryUser(prevUser);
      setActiveStoryIndex(prevUser.stories.length - 1);
    } else {
      // Already at the very first story of the very first user — just close.
      closeStory();
    }
  };

  // ---------- STORY ACTIONS ----------

  const handleLike = async () => {
    if (!activeWorkoutId || !currentUserId) return;
    const wasLiked = storyLikes.likedByMe;

    // Optimistic update
    setStoryLikes(prev => ({
      ...prev,
      likedByMe: !wasLiked,
      count: prev.count + (wasLiked ? -1 : 1),
    }));

    try {
      const { error } = await toggleLike(activeWorkoutId, currentUserId, wasLiked);
      if (error) throw error;
    } catch (e) {
      // Revert on failure
      setStoryLikes(prev => ({
        ...prev,
        likedByMe: wasLiked,
        count: prev.count + (wasLiked ? 1 : -1),
      }));
      showAlert("Couldn't update like", "Please try again.");
    }
  };

  const handleOpenComments = () => {
    progressAnimation.stopAnimation();
    setShowCommentsSheet(true);
  };

  const handlePostComment = async () => {
    if (!activeWorkoutId || !currentUserId || !commentDraft.trim()) return;
    setPostingComment(true);
    try {
      const { data, error } = await addComment(activeWorkoutId, currentUserId, commentDraft);
      if (error) throw error;
      if (data) setStoryComments(prev => [...prev, data]);
      setCommentDraft('');
    } catch (e: any) {
      showAlert("Couldn't post comment", e?.message || "Try again.");
    } finally {
      setPostingComment(false);
    }
  };

  const handleShare = async () => {
    if (!activeStory?.url) return;
    progressAnimation.stopAnimation();
    await shareStoryNative({
      title: `${viewedStoryUser?.name}'s workout`,
      message: `Check out ${viewedStoryUser?.name}'s workout on Locked In`,
      url: activeStory.url,
    });
  };

  const handleOpenViewers = async () => {
    if (!activeWorkoutId) return;
    progressAnimation.stopAnimation();
    try {
      const viewers = await fetchStoryViewers(activeWorkoutId);
      setStoryViewers(viewers);
      setShowViewersSheet(true);
    } catch (e) {
      showAlert("Couldn't load viewers", "Try again.");
    }
  };

  const handleOpenLikers = () => {
    if (storyLikes.count === 0) return;
    progressAnimation.stopAnimation();
    setShowLikersSheet(true);
  };

  const isMyStory = viewedStoryUser?.id === currentUserId;

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (evt, gestureState) => gestureState.dy > 20 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx),
    onPanResponderRelease: (evt, gestureState) => { if (gestureState.dy > 50) closeStory(); },
  }), []);

  const handleYourStoryTap = async () => {
    showAlert('New Story', 'Choose how to share your moment:', [
        { text: 'Take Photo', onPress: () => captureMedia('images') },
        { text: 'Record Video', onPress: () => captureMedia('videos') },
        { text: 'Choose from Gallery', onPress: () => chooseFromGallery() },
        { text: 'Cancel', style: 'cancel' }
    ]);
  };

  const chooseFromGallery = async () => {
     let permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
     if (!permissionResult.granted) return;

     let result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'], 
        allowsEditing: true, aspect: [3, 4], quality: 0.8
     });

     if (!result.canceled) { 
        const asset = result.assets[0];
        const mediaType = asset.type === 'video' ? 'video' : 'image';
        const updatedData = [...data];
        const userIdx = updatedData.findIndex(user => user.id === currentUserId);
        if (userIdx > -1) {
          updatedData[userIdx].hasPostedStory = true;
          updatedData[userIdx].stories = [{type: mediaType, url: asset.uri}]; 
          setData(updatedData);
        }
     }
  };

  const captureMedia = async (mediaType: ImagePicker.MediaType) => {
    let cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
    if (!cameraPermission.granted) return showAlert("Permission Required", "Camera access is needed.");
    
    let result = await ImagePicker.launchCameraAsync({
        mediaTypes: [mediaType], allowsEditing: true, aspect: [3, 4], quality: 0.8, videoMaxDuration: 15,
    });

    if (!result.canceled) { 
        const asset = result.assets[0];
        const resolvedType = asset.type === 'video' ? 'video' : 'image';
        const updatedData = [...data];
        const userIdx = updatedData.findIndex(user => user.id === currentUserId);
        if (userIdx > -1) {
          updatedData[userIdx].hasPostedStory = true;
          updatedData[userIdx].stories = [{type: resolvedType, url: asset.uri}]; 
          setData(updatedData);
        }
    }
  };

  const renderLeaderboardItem = ({ item, index }: { item: any, index: number }) => {
    const isExpanded = expandedId === item.id;
    return (
      <View style={styles.card}>
        <TouchableOpacity style={styles.mainRow} onPress={() => {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setExpandedId(isExpanded ? null : item.id);
        }}>
          <Text style={styles.rank}>#{index + 1}</Text>
          <TouchableOpacity onPress={(e) => {
            e.stopPropagation?.();
            if (item.id !== currentUserId) navigation.navigate('UserProfile', { userId: item.id });
          }} style={{ flex: 1, marginRight: 5 }}>
            <Text style={styles.name} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{item.name}</Text>
          </TouchableOpacity>
          <View style={styles.metricColDur}><Text style={styles.durCell} numberOfLines={1} adjustsFontSizeToFit>{item.totalDuration} min</Text></View>
          <View style={styles.metricColCal}><Text style={styles.calCell} numberOfLines={1} adjustsFontSizeToFit>{item.totalCalories} kcal</Text></View>
          <View style={styles.metricColPts}><Text style={styles.ptsCell} numberOfLines={1}>{item.totalPoints}</Text></View>
          <View style={styles.chevronBox}><Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={14} color={colors.textMuted} /></View>
        </TouchableOpacity>
        
        {isExpanded && (
          <View style={styles.expandedSection}>
             <Text style={styles.expandedTitle}>Activity Log ({formatWeekRange(weeksAgo)})</Text>
            {item.weeklyWorkouts.length === 0 && (
                <Text style={{color: colors.textMuted, fontSize: 13, fontStyle: 'italic'}}>No activity recorded.</Text>
            )}
            {item.weeklyWorkouts.map((w: any) => {
              const dateObj = new Date(w.created_at);
              const displayDate = dateObj.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
              const displayTime = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

              return (
                <View key={w.id} style={styles.workoutItem}>
                  <View style={{flex: 1}}>
                      <Text style={styles.workoutType}>{w.activity_type}</Text>
                      <Text style={styles.workoutMeta}>{displayDate} at {displayTime} • {w.duration_minutes} min {w.distance ? `• ${w.distance}` : ''} {w.calories ? `• ${w.calories} kcal` : ''}</Text>
                  </View>
                  <Text style={styles.workoutPoints}>+{w.points}</Text>
                </View>
              );
            })}
          </View>
        )}
      </View>
    );
  };

  const currentUserData = data.find(u => u.id === currentUserId);

  // Story strip ordering: users with recent stories first (newest -> oldest),
  // followed by users with no recent activity. The current user is included when
  // they have a real posted story (so they can tap their own avatar in the strip
  // to view what they posted). The dedicated "Your story" bubble is still rendered
  // separately as the entry-point for adding new stories.
  const storyStripUsers = useMemo(() => {
    return [...data]
      .filter(u => !u.isCurrentUser || u.hasPostedStory)
      .sort((a, b) => {
        // 1. People with stories before people without
        if (a.hasPostedStory && !b.hasPostedStory) return -1;
        if (!a.hasPostedStory && b.hasPostedStory) return 1;
        // 2. Among people with stories: unviewed before viewed (Instagram-style)
        // Treat the current user's stories as always "unviewed" so they don't sink to the back.
        const aViewed = a.allStoriesViewed && !a.isCurrentUser;
        const bViewed = b.allStoriesViewed && !b.isCurrentUser;
        if (!aViewed && bViewed) return -1;
        if (aViewed && !bViewed) return 1;
        // 3. Within each group: most recent story first
        return b.latestStoryAt - a.latestStoryAt;
      });
  }, [data]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Locked In</Text>
        <TouchableOpacity onPress={() => navigation.navigate('Notifications')} style={{ padding: 4 }}>
          <Ionicons name="notifications-outline" size={26} color={colors.text} />
          {unreadCount > 0 && (
            <View style={styles.bellBadge}>
              <Text style={styles.bellBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {loading ? ( <ActivityIndicator style={{ marginTop: 50 }} color={colors.primary} /> ) : (
        <FlatList
          data={data}
          keyExtractor={item => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListHeaderComponent={
            <View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.storiesStrip} contentContainerStyle={{paddingHorizontal: 15}}>
                
                <TouchableOpacity style={styles.storyBubble} onPress={handleYourStoryTap}>
                    <View style={styles.storyRingWrapper}>
                        <Image source={{ uri: currentUserData?.avatar || 'https://via.placeholder.com/150' }} style={styles.avatar} />
                        <View style={styles.addStoryBtn}><Ionicons name="add" size={16} color={colors.background} /></View>
                    </View>
                    <Text style={styles.storyName}>Your story</Text>
                </TouchableOpacity>

                <View style={styles.storyDivider} />

                {storyStripUsers.map((user, idx) => {
                    const gradientColors = user.name.includes('Prashant') 
                        ? ['#F58529', '#DD2A7B', '#8134AF', '#515BD4'] 
                        : user.name.includes('Ayaan') 
                        ? ['#DD2A7B', '#8134AF', '#515BD4', '#405DE6'] 
                        : ['#DD2A7B', '#F58529', '#8134AF', '#515BD4']; 

                    const showColored = user.hasPostedStory && (!user.allStoriesViewed || user.isCurrentUser);
                    const showGrey = user.hasPostedStory && user.allStoriesViewed && !user.isCurrentUser;

                    return (
                        <TouchableOpacity key={user.id} style={styles.storyBubble} onPress={() => openStory(user)}>
                            {showColored ? (
                                <LinearGradient colors={gradientColors as [string, string, ...string[]]} start={{x: 0, y: 1}} end={{x: 1, y: 0}} style={styles.storyGradientRing}>
                                    <View style={styles.storyGradientRingInner}>
                                        <Image source={{ uri: user.avatar }} style={styles.avatar} />
                                    </View>
                                </LinearGradient>
                            ) : showGrey ? (
                                <View style={styles.storyRingViewed}>
                                    <View style={styles.storyGradientRingInner}>
                                        <Image source={{ uri: user.avatar }} style={styles.avatar} />
                                    </View>
                                </View>
                            ) : (
                                <View style={styles.storyRingInactive}>
                                    <Image source={{ uri: user.avatar }} style={styles.avatar} />
                                </View>
                            )}
                            <Text style={styles.storyName} numberOfLines={1}>{(user.name.split(' ')[0]).toLowerCase()}</Text>
                        </TouchableOpacity>
                    );
                })}
              </ScrollView>
              
              <View style={styles.tableHeader}>
                <View>
                  <Text style={styles.rankingsLabel}>Rankings</Text>
                  <View style={styles.weekSelector}>
                    <TouchableOpacity onPress={() => setWeeksAgo(w => w + 1)}>
                      <Ionicons name="chevron-back" size={18} color={colors.textMuted} />
                    </TouchableOpacity>
                    <Text style={styles.weekText}>{formatWeekRange(weeksAgo)}</Text>
                    <TouchableOpacity onPress={() => setWeeksAgo(w => Math.max(0, w - 1))} disabled={weeksAgo === 0}>
                      <Ionicons name="chevron-forward" size={18} color={weeksAgo === 0 ? colors.border : colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.headerControls}>
                    <TouchableOpacity onPress={() => handleSort('duration')} style={styles.headerColDur}><Text style={[styles.sortLabel, sortField === 'duration' && styles.activeSort]}>DUR</Text></TouchableOpacity>
                    <TouchableOpacity onPress={() => handleSort('calories')} style={styles.headerColCal}><Text style={[styles.sortLabel, sortField === 'calories' && styles.activeSort]}>CAL</Text></TouchableOpacity>
                    <TouchableOpacity onPress={() => handleSort('points')} style={styles.headerColPts}><Text style={[styles.sortLabel, sortField === 'points' && styles.activeSort]}>PTS</Text></TouchableOpacity>
                    <TouchableOpacity onPress={() => setShowInfo(true)} style={styles.infoIconBtn}><Ionicons name="information-circle-outline" size={18} color={colors.textMuted} /></TouchableOpacity>
                </View>
              </View>
            </View>
          }
          renderItem={renderLeaderboardItem}
          ListFooterComponent={
            data.length <= 1 ? (
              <View style={styles.emptyFollowsCard}>
                <Ionicons name="people-outline" size={32} color={colors.textMuted} />
                <Text style={styles.emptyFollowsTitle}>It's quiet in here</Text>
                <Text style={styles.emptyFollowsBody}>
                  Follow people to see their stories and compete on the leaderboard.
                </Text>
                <TouchableOpacity
                  style={styles.emptyFollowsButton}
                  onPress={() => navigation.navigate('Search')}
                >
                  <Text style={styles.emptyFollowsButtonText}>Find friends</Text>
                </TouchableOpacity>
              </View>
            ) : null
          }
        />
      )}

      {/* STORY VIEWER MODAL */}
      <Modal visible={viewedStoryUser !== null} animationType="fade" transparent={false}>
        <View style={styles.storyModalContainer}>
          <View style={[styles.modalNavWrapper, isStoryPaused && styles.hiddenWhenPaused]} pointerEvents={isStoryPaused ? 'none' : 'auto'}>
            <View style={styles.progressRow}>
              {viewedStoryUser?.stories.map((story: any, idx: number) => {
                 let widthInterpolation: any; 
                 if (idx < activeStoryIndex!) widthInterpolation = '100%'; 
                 else if (idx === activeStoryIndex!) widthInterpolation = progressAnimation.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
                 else widthInterpolation = '0%'; 

                 return (
                    <View key={idx} style={styles.progressBarBackground}>
                        <Animated.View style={[styles.progressBarFill, { width: widthInterpolation }]} />
                    </View>
                 );
              })}
            </View>
            <View style={styles.modalNav}>
              <TouchableOpacity
                style={styles.modalUserInfo}
                onPress={() => {
                  if (viewedStoryUser?.id && viewedStoryUser.id !== currentUserId) {
                    closeStory();
                    navigation.navigate('UserProfile', { userId: viewedStoryUser.id });
                  }
                }}
                activeOpacity={0.8}
              >
                <Image source={{ uri: viewedStoryUser?.avatar }} style={styles.modalAvatar} />
                <Text style={styles.modalUsername}>{viewedStoryUser?.name.split(' ')[0].toLowerCase()}</Text>
                {viewedStoryUser?.stories[activeStoryIndex!]?.type !== 'roast' && (
                    <Text style={styles.modalTime}>
                      {formatTimeAgo(viewedStoryUser?.stories[activeStoryIndex!]?.created_at)}
                    </Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity onPress={closeStory} style={styles.closeBtn}><Ionicons name="close" size={24} color="#fff" /></TouchableOpacity>
            </View>
          </View>
          
          <View style={styles.storyContent} {...panResponder.panHandlers}>
            {activeStoryIndex !== null && viewedStoryUser.stories[activeStoryIndex].type === 'image' ? (
                <View style={styles.storyCentralContent}>
                   <Image source={{ uri: viewedStoryUser.stories[activeStoryIndex].url }} style={styles.storyImage} />
                </View>
            ) : activeStoryIndex !== null && viewedStoryUser.stories[activeStoryIndex].type === 'video' ? (
                <View style={styles.storyCentralContent}>
                   <StoryVideo uri={viewedStoryUser.stories[activeStoryIndex].url} style={styles.storyImage} />
                </View>
            ) : (
                <View style={styles.roastContent}>
                   <Ionicons name="warning-outline" size={80} color="#ff4040" />
                   <Text style={styles.roastText}>{viewedStoryUser?.stories[activeStoryIndex!]?.text}</Text>
                </View>
            )}
            
            <View style={styles.touchZones}>
               <Pressable
                 style={styles.leftZone}
                 onPress={handlePrevStory}
                 onLongPress={() => setIsStoryPaused(true)}
                 onPressOut={() => setIsStoryPaused(false)}
                 delayLongPress={200}
               />
               <Pressable
                 style={styles.rightZone}
                 onPress={handleNextStory}
                 onLongPress={() => setIsStoryPaused(true)}
                 onPressOut={() => setIsStoryPaused(false)}
                 delayLongPress={200}
               />
            </View>

            {/* Owner-only viewer/like summary at the bottom-left, like Instagram */}
            {isMyStory && activeWorkoutId && !isStoryPaused && (
              <View style={styles.ownerStatsBar} pointerEvents="box-none">
                <TouchableOpacity onPress={handleOpenViewers} style={styles.ownerStatItem}>
                  <Ionicons name="eye-outline" size={20} color="#fff" />
                  <Text style={styles.ownerStatText}>Viewers</Text>
                </TouchableOpacity>
                {storyLikes.count > 0 && (
                  <TouchableOpacity onPress={handleOpenLikers} style={styles.ownerStatItem}>
                    <Ionicons name="heart" size={18} color="#ff3b30" />
                    <Text style={styles.ownerStatText}>{storyLikes.count}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            <View style={[styles.interactionBar, isStoryPaused && styles.hiddenWhenPaused]} pointerEvents={isStoryPaused ? 'none' : 'auto'}>
               {!isMyStory && activeWorkoutId ? (
                 <TouchableOpacity
                   style={styles.commentTrigger}
                   onPress={handleOpenComments}
                   activeOpacity={0.7}
                 >
                   <Text style={styles.commentTriggerText}>
                     {storyComments.length > 0 ? `View all ${storyComments.length} comments` : 'Add a comment...'}
                   </Text>
                 </TouchableOpacity>
               ) : (
                 <View style={{ flex: 1 }} />
               )}
               {activeWorkoutId && (
                 <View style={styles.modalActions}>
                    <TouchableOpacity style={styles.modalActionBtn} onPress={handleLike}>
                       <Ionicons
                         name={storyLikes.likedByMe ? 'heart' : 'heart-outline'}
                         size={28}
                         color={storyLikes.likedByMe ? '#ff3b30' : '#fff'}
                       />
                       {storyLikes.count > 0 && !isMyStory && (
                         <Text style={styles.actionCount}>{storyLikes.count}</Text>
                       )}
                    </TouchableOpacity>
                    {!isMyStory && (
                      <TouchableOpacity style={styles.modalActionBtn} onPress={handleOpenComments}>
                        <Ionicons name="chatbubble-outline" size={26} color="#fff" />
                        {storyComments.length > 0 && (
                          <Text style={styles.actionCount}>{storyComments.length}</Text>
                        )}
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity style={styles.modalActionBtn} onPress={handleShare}>
                      <Ionicons name="paper-plane-outline" size={26} color="#fff" />
                    </TouchableOpacity>
                 </View>
               )}
            </View>
          </View>
        </View>
      </Modal>

      {/* COMMENTS SHEET */}
      <Modal
        visible={showCommentsSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCommentsSheet(false)}
      >
        <View style={styles.sheetOverlay}>
          <TouchableOpacity style={{ flex: 1 }} onPress={() => setShowCommentsSheet(false)} />
          <View style={[styles.sheetContent, { backgroundColor: colors.background }]}>
            <View style={styles.sheetHandle} />
            <Text style={[styles.sheetTitle, { color: colors.text }]}>Comments</Text>
            <ScrollView style={styles.sheetScroll}>
              {storyComments.length === 0 ? (
                <Text style={[styles.sheetEmpty, { color: colors.textMuted }]}>Be the first to comment.</Text>
              ) : storyComments.map((c: any) => (
                <View key={c.id} style={styles.commentRow}>
                  <Image
                    source={{ uri: c.profiles?.avatar_url || 'https://via.placeholder.com/40' }}
                    style={styles.commentAvatar}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.commentName, { color: colors.text }]}>
                      {c.profiles?.display_name || c.profiles?.username || 'User'}
                      <Text style={{ color: colors.textMuted, fontWeight: '400' }}>{'  '}{formatTimeAgo(c.created_at)}</Text>
                    </Text>
                    <Text style={[styles.commentText, { color: colors.text }]}>{c.content}</Text>
                  </View>
                </View>
              ))}
            </ScrollView>
            <View style={[styles.commentInputRow, { borderTopColor: colors.border }]}>
              <TextInput
                style={[styles.commentInput, { color: colors.text, backgroundColor: colors.surface }]}
                placeholder="Add a comment..."
                placeholderTextColor={colors.textMuted}
                value={commentDraft}
                onChangeText={setCommentDraft}
                maxLength={500}
                editable={!postingComment}
              />
              <TouchableOpacity
                style={[styles.commentPostBtn, !commentDraft.trim() && { opacity: 0.4 }]}
                onPress={handlePostComment}
                disabled={!commentDraft.trim() || postingComment}
              >
                <Text style={styles.commentPostText}>{postingComment ? '...' : 'Post'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* LIKERS SHEET */}
      <Modal
        visible={showLikersSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowLikersSheet(false)}
      >
        <View style={styles.sheetOverlay}>
          <TouchableOpacity style={{ flex: 1 }} onPress={() => setShowLikersSheet(false)} />
          <View style={[styles.sheetContent, { backgroundColor: colors.background }]}>
            <View style={styles.sheetHandle} />
            <Text style={[styles.sheetTitle, { color: colors.text }]}>Liked by</Text>
            <ScrollView style={styles.sheetScroll}>
              {storyLikes.likers.length === 0 ? (
                <Text style={[styles.sheetEmpty, { color: colors.textMuted }]}>No likes yet.</Text>
              ) : storyLikes.likers.map((p: any) => (
                <View key={p.id} style={styles.commentRow}>
                  <Image source={{ uri: p.avatar_url || 'https://via.placeholder.com/40' }} style={styles.commentAvatar} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.commentName, { color: colors.text }]}>{p.display_name || p.username}</Text>
                    <Text style={[styles.commentText, { color: colors.textMuted }]}>@{p.username}</Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* VIEWERS SHEET (owner only) */}
      <Modal
        visible={showViewersSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowViewersSheet(false)}
      >
        <View style={styles.sheetOverlay}>
          <TouchableOpacity style={{ flex: 1 }} onPress={() => setShowViewersSheet(false)} />
          <View style={[styles.sheetContent, { backgroundColor: colors.background }]}>
            <View style={styles.sheetHandle} />
            <Text style={[styles.sheetTitle, { color: colors.text }]}>Viewers ({storyViewers.length})</Text>
            <ScrollView style={styles.sheetScroll}>
              {storyViewers.length === 0 ? (
                <Text style={[styles.sheetEmpty, { color: colors.textMuted }]}>No views yet.</Text>
              ) : storyViewers.map((v: any) => (
                <View key={v.viewer_id} style={styles.commentRow}>
                  <Image source={{ uri: v.profiles?.avatar_url || 'https://via.placeholder.com/40' }} style={styles.commentAvatar} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.commentName, { color: colors.text }]}>{v.profiles?.display_name || v.profiles?.username}</Text>
                    <Text style={[styles.commentText, { color: colors.textMuted }]}>{formatTimeAgo(v.viewed_at)}</Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* INFO MODAL */}
      <Modal visible={showInfo} animationType="slide" transparent={true}>
        <View style={styles.infoModalOverlay}>
          <View style={styles.infoModalContent}>
            <View style={styles.infoModalHeader}>
              <Text style={styles.infoModalTitle}>Point Rules</Text>
              <TouchableOpacity onPress={() => setShowInfo(false)}><Ionicons name="close-circle" size={28} color={colors.text}/></TouchableOpacity>
            </View>
            <Text style={styles.infoModalDesc}>
              <Text style={{fontWeight: '800'}}>Distance</Text>{"\n"}
              Running: 13 pts per 1 km{"\n"}
              Swim: 6 pts per 100 m{"\n\n"}

              <Text style={{fontWeight: '800'}}>Per minute</Text>{"\n"}
              Football (Competitive): 1.1 pts/min{"\n"}
              Badminton: 0.95 pts/min{"\n"}
              Volleyball: 0.9 pts/min{"\n"}
              Padel: 0.85 pts/min{"\n"}
              Gym: 0.75 pts/min{"\n"}
              Football (Casual): 0.7 pts/min{"\n"}
              Beach Volleyball: 0.7 pts/min{"\n"}
              Cricket: 0.6 pts/min{"\n"}
              Table Tennis: 0.5 pts/min{"\n"}
              Stretching: 0.25 pts/min{"\n\n"}

              <Text style={{fontWeight: '800'}}>+5 log bonus</Text> on Gym, Running, Swim, Padel, Badminton, Volleyball, Cricket, and Competitive Football.{"\n\n"}

              ⏱️ <Text style={{fontWeight: '800', color: colors.primary}}>Leaderboard Resets (00:00 UTC):</Text>{"\n"}
              🇦🇺 Melbourne: <Text style={{fontWeight: '700'}}>Monday 10:00 AM</Text>{"\n"}
              🇮🇩 Jakarta: <Text style={{fontWeight: '700'}}>Monday 7:00 AM</Text>{"\n"}
              🇳🇱 Netherlands: <Text style={{fontWeight: '700'}}>Monday 2:00 AM</Text>{"\n"}
              🇨🇦 Toronto: <Text style={{fontWeight: '700'}}>Sunday 8:00 PM</Text>
            </Text>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// --- DYNAMIC STYLES ---
const getStyles = (colors: any, theme: string) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { padding: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { fontSize: 36, fontWeight: '900', fontStyle: 'italic', letterSpacing: -1, color: colors.text },
  bellBadge: { position: 'absolute', top: 0, right: 0, backgroundColor: '#ff3b30', borderRadius: 9, minWidth: 18, height: 18, paddingHorizontal: 4, justifyContent: 'center', alignItems: 'center' },
  bellBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  
  storiesStrip: { paddingBottom: 20, marginBottom: 20, paddingHorizontal: 15 },
  storyBubble: { alignItems: 'center', marginRight: 15, width: 70 },
  storyRingWrapper: { width: 68, height: 68, borderRadius: 34, borderWidth: 2, borderColor: colors.border, justifyContent: 'center', alignItems: 'center', position: 'relative' },
  storyGradientRing: { width: 68, height: 68, borderRadius: 34, justifyContent: 'center', alignItems: 'center' },
  storyGradientRingInner: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' },
  storyRingInactive: { width: 68, height: 68, borderRadius: 34, borderWidth: 2, borderColor: colors.border, justifyContent: 'center', alignItems: 'center' },
  storyRingViewed: { width: 68, height: 68, borderRadius: 34, borderWidth: 2, borderColor: colors.textMuted, justifyContent: 'center', alignItems: 'center' },
  storyDivider: { width: 1, height: 40, backgroundColor: colors.border, marginHorizontal: 5, alignSelf: 'center', marginBottom: 15 },
  avatar: { width: 58, height: 58, borderRadius: 29 },
  addStoryBtn: { position: 'absolute', bottom: -2, right: -2, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.text, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: colors.background },
  storyName: { fontSize: 12, fontWeight: '700', marginTop: 6, color: colors.text },
  
  tableHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingHorizontal: 20, marginBottom: 15 },
  rankingsLabel: { fontSize: 22, fontWeight: '900', color: colors.text },
  weekSelector: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  weekText: { fontSize: 12, fontWeight: '800', color: colors.textMuted, marginHorizontal: 6, textTransform: 'uppercase' },
  // Replace these lines in your style object:
  headerControls: { flexDirection: 'row', alignItems: 'center' },
  headerColDur: { width: 60, alignItems: 'center' },
  headerColCal: { width: 65, alignItems: 'center' },
  headerColPts: { width: 40, alignItems: 'center', marginLeft: 5 },
  sortLabel: { fontSize: 11, fontWeight: '800', color: colors.textMuted },
  activeSort: { color: colors.text },
  infoIconBtn: { width: 25, alignItems: 'flex-end' },
  
  card: { marginHorizontal: 15, backgroundColor: colors.surface, borderRadius: 16, marginBottom: 10 },
  mainRow: { flexDirection: 'row', alignItems: 'center', padding: 18 },
  rank: { width: 30, fontSize: 14, fontWeight: '800', color: colors.textMuted },
  name: { fontSize: 16, fontWeight: '800', color: colors.text },
  metricColDur: { width: 60, alignItems: 'center' },
  metricColCal: { width: 65, alignItems: 'center' },
  metricColPts: { width: 40, alignItems: 'center', marginLeft: 5 },
  durCell: { fontSize: 14, fontWeight: '600', color: colors.textMuted },
  calCell: { fontSize: 14, fontWeight: '600', color: colors.textMuted },
  ptsCell: { fontSize: 15, fontWeight: '800', color: colors.primary },
  chevronBox: { width: 25, alignItems: 'flex-end' },
  expandedSection: { padding: 18, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: theme === 'dark' ? '#111' : '#f2f2f7', borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  expandedTitle: { fontSize: 11, fontWeight: '800', color: colors.textMuted, marginBottom: 10, textTransform: 'uppercase' },
  workoutItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  workoutType: { fontSize: 15, fontWeight: '700', color: colors.text },
  workoutMeta: { fontSize: 12, color: colors.textMuted },
  workoutPoints: { fontSize: 14, fontWeight: '800', color: colors.primary },

  infoModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  infoModalContent: { backgroundColor: colors.background, padding: 30, borderTopLeftRadius: 30, borderTopRightRadius: 30 },
  infoModalHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15 },
  infoModalTitle: { fontSize: 24, fontWeight: '900', color: colors.text },
  infoModalDesc: { fontSize: 15, lineHeight: 24, color: colors.text },

  storyModalContainer: { flex: 1, backgroundColor: '#000' },
  modalNavWrapper: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, paddingTop: 10 },
  hiddenWhenPaused: { opacity: 0 },
  progressRow: { flexDirection: 'row', paddingHorizontal: 10, marginBottom: 10 },
  progressBarBackground: { flex: 1, height: 3, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 2, marginHorizontal: 2, overflow: 'hidden' },
  progressBarFill: { height: '100%', backgroundColor: '#fff', borderRadius: 2 },
  modalNav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20 },
  modalUserInfo: { flexDirection: 'row', alignItems: 'center' },
  modalAvatar: { width: 32, height: 32, borderRadius: 16, marginRight: 8 },
  modalUsername: { color: '#fff', fontSize: 14, fontWeight: '700' },
  modalTime: { color: '#fff', fontSize: 12, opacity: 0.8, marginLeft: 6 },
  closeBtn: { padding: 5 },
  storyContent: { flex: 1, position: 'relative' },
  touchZones: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, flexDirection: 'row', zIndex: 5 },
  leftZone: { flex: 1 }, 
  rightZone: { flex: 1 }, 
  interactionBar: { position: 'absolute', bottom: 30, right: 20, left: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', zIndex: 10 },
  messageInput: { flex: 1, height: 44, borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)', borderRadius: 22, paddingHorizontal: 18, color: '#fff', marginRight: 15 },
  modalActions: { flexDirection: 'row', alignItems: 'center' },
  modalActionBtn: { marginLeft: 15, alignItems: 'center' },
  actionCount: { color: '#fff', fontSize: 11, fontWeight: '700', marginTop: 2 },
  commentTrigger: { flex: 1, height: 44, borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)', borderRadius: 22, paddingHorizontal: 18, marginRight: 15, justifyContent: 'center' },
  commentTriggerText: { color: 'rgba(255,255,255,0.85)', fontSize: 14 },

  // Owner-only viewer/like indicator (bottom-left of story)
  ownerStatsBar: { position: 'absolute', bottom: 90, left: 20, right: 20, flexDirection: 'row', alignItems: 'center', zIndex: 10 },
  ownerStatItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.4)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, marginRight: 8 },
  ownerStatText: { color: '#fff', fontWeight: '700', marginLeft: 6, fontSize: 13 },

  // Sheets (comments / likers / viewers)
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheetContent: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 30, maxHeight: '70%' },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(127,127,127,0.4)', alignSelf: 'center', marginTop: 10, marginBottom: 10 },
  sheetTitle: { fontSize: 17, fontWeight: '700', textAlign: 'center', paddingBottom: 15 },
  sheetScroll: { paddingHorizontal: 20, maxHeight: 380 },
  sheetEmpty: { textAlign: 'center', paddingVertical: 30, fontSize: 14 },
  commentRow: { flexDirection: 'row', paddingVertical: 12 },
  commentAvatar: { width: 36, height: 36, borderRadius: 18, marginRight: 12, backgroundColor: '#eee' },
  commentName: { fontSize: 14, fontWeight: '700', marginBottom: 3 },
  commentText: { fontSize: 14, lineHeight: 18 },
  commentInputRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4, borderTopWidth: 1 },
  commentInput: { flex: 1, height: 40, borderRadius: 20, paddingHorizontal: 14, fontSize: 14, marginRight: 10 },
  commentPostBtn: { paddingHorizontal: 14, paddingVertical: 10 },
  commentPostText: { color: colors.primary, fontWeight: '700', fontSize: 15 },
  storyCentralContent: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1a1a1a' },
  storyImage: { width: width, height: height, resizeMode: 'contain' },
  
  roastContent: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40, backgroundColor: '#1a1a1a' },
  roastText: { color: '#fff', fontSize: 24, fontWeight: '800', textAlign: 'center', marginTop: 20 },

  emptyFollowsCard: {
    margin: 20,
    padding: 24,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  emptyFollowsTitle: { fontSize: 17, fontWeight: '800', color: colors.text, marginTop: 12 },
  emptyFollowsBody: { fontSize: 14, color: colors.textMuted, textAlign: 'center', lineHeight: 20, marginTop: 6, marginBottom: 18 },
  emptyFollowsButton: { backgroundColor: colors.primary, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 24 },
  emptyFollowsButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});