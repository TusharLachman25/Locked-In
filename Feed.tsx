import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  View, Text, StyleSheet, FlatList, TouchableOpacity, 
  ActivityIndicator, LayoutAnimation, Platform, UIManager, 
  Modal, ScrollView, Image, Dimensions, Animated, Alert, RefreshControl, PanResponder, TextInput
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons'; 
import { supabase } from './supabase';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { Video, ResizeMode } from 'expo-av';
import { useTheme } from './ThemeContext'; // <-- THEME BRAIN
import { useCustomAlert } from './AlertContext';

const { width, height } = Dimensions.get('window');

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// --- MATH & HELPERS ---
const calculatePoints = (activity: string, duration: number, distance: string) => {
  let effortPoints = 0;
  const basePoints = 5; 
  const numericValue = parseFloat((distance || '').replace(/[^0-9.]/g, '')) || 0;

  switch (activity) {
    case 'Swim': effortPoints = (numericValue / 100) * 10; break;
    case 'Running': effortPoints = numericValue * 10; break;
    case 'Gym': effortPoints = (duration / 5) * 2; break;
    case 'Football (Competitive)': effortPoints = duration / 1.5; break;
    case 'Padel':
    case 'Badminton': effortPoints = duration / 2; break;
    case 'Football (Casual)': effortPoints = duration / 3; break;
    case 'Table Tennis': effortPoints = duration / 4; break;
    default: effortPoints = duration / 5; 
  }
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

export default function Feed() {
  const { showAlert } = useCustomAlert();
  const { colors, theme } = useTheme(); // <-- PULL IN COLORS
  const styles = useMemo(() => getStyles(colors, theme), [colors, theme]); // <-- DYNAMIC STYLES

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
  const progressAnimation = useRef(new Animated.Value(0)).current;

  useFocusEffect(
    useCallback(() => {
      supabase.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id || null));
      fetchFeedData();
    }, [weeksAgo]) 
  );

  useEffect(() => {
    if (viewedStoryUser && activeStoryIndex !== null) {
      progressAnimation.setValue(0);
      Animated.timing(progressAnimation, {
        toValue: 1, duration: 5000, useNativeDriver: false, 
      }).start(({ finished }) => {
        if (finished) handleNextStory();
      });
    }
  }, [viewedStoryUser, activeStoryIndex]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchFeedData();
    setRefreshing(false);
  };

  const fetchFeedData = async () => {
    try {
      setLoading(true);
      const { data: profiles } = await supabase.from('profiles').select('*');
      
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
      
      const { data: workouts } = await supabase
        .from('workouts')
        .select('*')
        .gte('created_at', fetchThreshold.toISOString()) 
        .order('created_at', { ascending: true }); 

      if (!profiles) return;

      const processed = profiles.map(profile => {
        const allUserWorkouts = workouts?.filter(w => w.user_id === profile.id) || [];
        
        const weeklyWorkouts = allUserWorkouts.filter(w => {
           const d = new Date(w.created_at);
           return d >= startOfWeekDate && d < endOfWeekDate;
        });

        const recentWorkouts = allUserWorkouts.filter(w => new Date(w.created_at) >= yesterdayDate);
        let stories: any[] = recentWorkouts.map(w => ({ type: 'image', url: w.image_url }));

        const name = profile.display_name || profile.username || profile.name || 'User';
        const isCurrent = profile.id === currentUserId;

        if (!isCurrent) {
            if (name.includes('Jerry') && stories.length === 0) stories.push({ type: 'image', url: 'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?q=80&w=800&auto=format&fit=crop' });
            if (name.includes('Ayaan') && stories.length === 0) stories.push({ type: 'image', url: 'https://images.unsplash.com/photo-1526506114620-3b4e7ebdf213?q=80&w=800&auto=format&fit=crop' });
            if (name.includes('Prashant') && stories.length === 0) stories.push({ type: 'image', url: 'https://images.unsplash.com/photo-1541534741688-6078c6bfb5c5?q=80&w=800&auto=format&fit=crop' });
        }

        const hasPostedStory = stories.length > 0;

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

        return {
          id: profile.id, name: name,
          avatar: profile.avatar_url || 'https://via.placeholder.com/150',
          totalDuration, totalCalories, totalPoints,
          weeklyWorkouts: weeklyList,     
          stories: stories,   
          hasPostedStory: hasPostedStory, 
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
  const closeStory = () => { progressAnimation.stopAnimation(); setViewedStoryUser(null); setActiveStoryIndex(null); };

  const handleNextStory = () => {
    progressAnimation.stopAnimation();
    if (activeStoryIndex !== null && activeStoryIndex < viewedStoryUser.stories.length - 1) {
      setActiveStoryIndex(prev => prev! + 1);
    } else closeStory(); 
  };

  const handlePrevStory = () => {
    progressAnimation.stopAnimation();
    if (activeStoryIndex !== null && activeStoryIndex > 0) setActiveStoryIndex(prev => prev! - 1);
    else closeStory();
  };

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (evt, gestureState) => gestureState.dy > 20 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx),
    onPanResponderRelease: (evt, gestureState) => { if (gestureState.dy > 50) closeStory(); },
  }), []);

  const handleYourStoryTap = async () => {
    showAlert('New Story', 'Choose how to share your moment:', [
        { text: 'Take Photo', onPress: () => captureMedia(ImagePicker.MediaTypeOptions.Images) },
        { text: 'Record Video', onPress: () => captureMedia(ImagePicker.MediaTypeOptions.Videos) },
        { text: 'Choose from Gallery', onPress: () => chooseFromGallery() },
        { text: 'Cancel', style: 'cancel' }
    ]);
  };

  const chooseFromGallery = async () => {
     let permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
     if (!permissionResult.granted) return;

     let result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.All, 
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

  const captureMedia = async (mediaType: ImagePicker.MediaTypeOptions) => {
    let cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
    if (!cameraPermission.granted) return showAlert("Permission Required", "Camera access is needed.");
    
    let result = await ImagePicker.launchCameraAsync({
        mediaTypes: mediaType, allowsEditing: true, aspect: [3, 4], quality: 0.8, videoMaxDuration: 15,
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
          <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
          <View style={styles.metricColDur}><Text style={styles.durCell} numberOfLines={1} adjustsFontSizeToFit>{item.totalDuration}m</Text></View>
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
                      <Text style={styles.workoutMeta}>{displayDate} at {displayTime} • {w.duration_minutes}m {w.distance ? `• ${w.distance}` : ''} {w.calories ? `• ${w.calories} kcal` : ''}</Text>
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

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Locked In</Text>
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

                {data.map((user, idx) => {
                    const gradientColors = user.name.includes('Prashant') 
                        ? ['#F58529', '#DD2A7B', '#8134AF', '#515BD4'] 
                        : user.name.includes('Ayaan') 
                        ? ['#DD2A7B', '#8134AF', '#515BD4', '#405DE6'] 
                        : ['#DD2A7B', '#F58529', '#8134AF', '#515BD4']; 

                    return (
                        <TouchableOpacity key={user.id} style={styles.storyBubble} onPress={() => openStory(user)}>
                            {user.hasPostedStory ? (
                                <LinearGradient colors={gradientColors as [string, string, ...string[]]} start={{x: 0, y: 1}} end={{x: 1, y: 0}} style={styles.storyGradientRing}>
                                    <View style={styles.storyGradientRingInner}>
                                        <Image source={{ uri: user.avatar }} style={styles.avatar} />
                                    </View>
                                </LinearGradient>
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
        />
      )}

      {/* STORY VIEWER MODAL */}
      <Modal visible={viewedStoryUser !== null} animationType="fade" transparent={false}>
        <View style={styles.storyModalContainer}>
          <View style={styles.modalNavWrapper}>
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
              <View style={styles.modalUserInfo}>
                <Image source={{ uri: viewedStoryUser?.avatar }} style={styles.modalAvatar} />
                <Text style={styles.modalUsername}>{viewedStoryUser?.name.split(' ')[0].toLowerCase()}</Text>
                {viewedStoryUser?.stories[activeStoryIndex!]?.type !== 'roast' && (
                    <Text style={styles.modalTime}>4h</Text>
                )}
              </View>
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
                   <Video source={{ uri: viewedStoryUser.stories[activeStoryIndex].url }} style={styles.storyImage} useNativeControls={false} resizeMode={ResizeMode.CONTAIN} shouldPlay isLooping />
                </View>
            ) : (
                <View style={styles.roastContent}>
                   <Ionicons name="warning-outline" size={80} color="#ff4040" />
                   <Text style={styles.roastText}>{viewedStoryUser?.stories[activeStoryIndex!]?.text}</Text>
                </View>
            )}
            
            <View style={styles.touchZones}>
               <TouchableOpacity style={styles.leftZone} onPress={handlePrevStory} activeOpacity={1}/>
               <TouchableOpacity style={styles.rightZone} onPress={handleNextStory} activeOpacity={1}/>
            </View>

            <View style={styles.interactionBar}>
               <TextInput style={styles.messageInput} placeholder="Send message" placeholderTextColor="rgba(255,255,255,0.7)" />
               <View style={styles.modalActions}>
                  <TouchableOpacity style={styles.modalActionBtn}><Ionicons name="heart-outline" size={28} color="#fff" /></TouchableOpacity>
                  <TouchableOpacity style={styles.modalActionBtn}><Ionicons name="paper-plane-outline" size={26} color="#fff" /></TouchableOpacity>
               </View>
            </View>
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
              +5 base points per log.{"\n"}
              +1 pt / 1.5 mins for Comp Football.{"\n"}
              +1 pt / 2 mins for Padel/Badminton.{"\n"}
              +1 pt / 3 mins for Casual Football.{"\n"}
              +1 pt / 4 mins for Table Tennis.{"\n"}
              +2 pts / 5 mins for Gym.{"\n"}
              +1 pt / 5 mins for Stretching.{"\n"}
              +10 pts per 1km Run / 100m Swim.{"\n\n"}
              
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
  header: { padding: 20 },
  headerTitle: { fontSize: 36, fontWeight: '900', fontStyle: 'italic', letterSpacing: -1, color: colors.text },
  
  storiesStrip: { paddingBottom: 20, marginBottom: 20, paddingHorizontal: 15 },
  storyBubble: { alignItems: 'center', marginRight: 15, width: 70 },
  storyRingWrapper: { width: 68, height: 68, borderRadius: 34, borderWidth: 2, borderColor: colors.border, justifyContent: 'center', alignItems: 'center', position: 'relative' },
  storyGradientRing: { width: 68, height: 68, borderRadius: 34, justifyContent: 'center', alignItems: 'center' },
  storyGradientRingInner: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' },
  storyRingInactive: { width: 68, height: 68, borderRadius: 34, borderWidth: 2, borderColor: colors.border, justifyContent: 'center', alignItems: 'center' },
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
  headerColDur: { width: 50, alignItems: 'flex-end' },
  headerColCal: { width: 65, alignItems: 'flex-end' },
  headerColPts: { width: 40, alignItems: 'flex-end', marginLeft: 5 },
  sortLabel: { fontSize: 11, fontWeight: '800', color: colors.textMuted },
  activeSort: { color: colors.text },
  infoIconBtn: { width: 25, alignItems: 'flex-end' },
  
  card: { marginHorizontal: 15, backgroundColor: colors.surface, borderRadius: 16, marginBottom: 10 },
  mainRow: { flexDirection: 'row', alignItems: 'center', padding: 18 },
  rank: { width: 30, fontSize: 14, fontWeight: '800', color: colors.textMuted },
  name: { flex: 1, fontSize: 16, fontWeight: '800', color: colors.text, marginRight: 5 },
  metricColDur: { width: 50, alignItems: 'flex-end' },
  metricColCal: { width: 65, alignItems: 'flex-end' },
  metricColPts: { width: 40, alignItems: 'flex-end', marginLeft: 5 },
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
  modalActionBtn: { marginLeft: 15 },
  storyCentralContent: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1a1a1a' },
  storyImage: { width: width, height: height, resizeMode: 'contain' },
  
  roastContent: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40, backgroundColor: '#1a1a1a' },
  roastText: { color: '#fff', fontSize: 24, fontWeight: '800', textAlign: 'center', marginTop: 20 },
});