import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { 
  View, Text, TextInput, StyleSheet, TouchableOpacity, 
  Image, Alert, ActivityIndicator, FlatList, Dimensions, Modal, KeyboardAvoidingView, Platform, RefreshControl, Switch
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

export default function Profile() {
  const { showAlert } = useCustomAlert();
  const { colors, theme, toggleTheme } = useTheme(); 
  const styles = useMemo(() => getStyles(colors, theme), [colors, theme]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [stats, setStats] = useState({ followers: 0, following: 0, posts: 0 });
  const [workouts, setWorkouts] = useState<any[]>([]);
  
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editUsername, setEditUsername] = useState('');
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editAvatarUrl, setEditAvatarUrl] = useState<string | null>(null);

  const [isSettingsVisible, setIsSettingsVisible] = useState(false);
  const [postAlerts, setPostAlerts] = useState(true);
  const [chatAlerts, setChatAlerts] = useState(true);
  const [dailyRoasts, setDailyRoasts] = useState(true);

  const [networkType, setNetworkType] = useState<'followers' | 'following' | null>(null);
  const [networkList, setNetworkList] = useState<any[]>([]);
  const [loadingNetwork, setLoadingNetwork] = useState(false);

  const [selectedPost, setSelectedPost] = useState<any | null>(null);
  const [isEditingPost, setIsEditingPost] = useState(false);
  const [editPostNotes, setEditPostNotes] = useState('');
  const [isLiked, setIsLiked] = useState(false); 

  // --- ADDED ACTION SHEET STATE ---
  const [actionSheetVisible, setActionSheetVisible] = useState(false);
  const [actionSheetConfig, setActionSheetConfig] = useState<any>({});

  useFocusEffect(
    useCallback(() => {
      fetchFullProfile();
      AsyncStorage.getItem('dailyRoasts').then(val => {
        if (val === 'false') setDailyRoasts(false);
      });
    }, [])
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

      const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      setUserProfile(profile);
      setEditUsername(profile?.username || '');
      setEditDisplayName(profile?.display_name || '');
      setEditAvatarUrl(profile?.avatar_url || null);

      const { count: followers } = await supabase.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', user.id);
      const { count: following } = await supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', user.id);
      const { count: posts } = await supabase.from('workouts').select('*', { count: 'exact', head: true }).eq('user_id', user.id);
      
      setStats({ followers: followers || 0, following: following || 0, posts: posts || 0 });

      const { data: myWorkouts } = await supabase.from('workouts').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
      setWorkouts(myWorkouts || []);

    } catch (error) { console.error(error); } finally { setLoading(false); }
  };

  const toggleDailyRoasts = async (value: boolean) => {
    setDailyRoasts(value);
    await AsyncStorage.setItem('dailyRoasts', value ? 'true' : 'false');
    scheduleMorningRoasts(); 
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
    let result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.5, base64: true });
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

  const openPost = (post: any) => {
    setSelectedPost(post);
    setEditPostNotes(post.notes || '');
    setIsEditingPost(false);
    setIsLiked(false);
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

  const renderGridItem = ({ item }: { item: any }) => (
    <TouchableOpacity style={styles.gridItem} onPress={() => openPost(item)} activeOpacity={0.8}>
      <Image source={{ uri: item.image_url }} style={styles.gridImage} />
      <View style={styles.gridOverlay}>
        <Text style={styles.gridActivity}>{item.activity_type}</Text>
      </View>
    </TouchableOpacity>
  );

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
        <Text style={styles.bioText}>Sweat now, shine later. 💧</Text> 
      </View>

      <View style={styles.actionButtons}>
        <TouchableOpacity style={styles.editButton} onPress={() => setIsEditingProfile(true)}>
          <Text style={styles.editButtonText}>Edit Profile</Text>
        </TouchableOpacity>
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
        <Text style={styles.navUsername}>@{userProfile?.username || 'username'}</Text>
        <TouchableOpacity onPress={() => setIsSettingsVisible(true)}>
          <Ionicons name="settings-outline" size={28} color={colors.text} />
        </TouchableOpacity>
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
                <Switch value={dailyRoasts} onValueChange={toggleDailyRoasts} trackColor={{ false: '#e5e5ea', true: colors.primary }} />
              </View>
              <View style={[styles.settingsRow, { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 10, paddingTop: 10 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="notifications" size={24} color={colors.primary} style={{ marginRight: 15 }} />
                  <Text style={styles.settingsRowText}>Post Alerts</Text>
                </View>
                <Switch value={postAlerts} onValueChange={setPostAlerts} trackColor={{ false: '#e5e5ea', true: colors.primary }} />
              </View>
              <View style={[styles.settingsRow, { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 10, paddingTop: 10 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="chatbubbles" size={24} color={colors.primary} style={{ marginRight: 15 }} />
                  <Text style={styles.settingsRowText}>Chat Alerts</Text>
                </View>
                <Switch value={chatAlerts} onValueChange={setChatAlerts} trackColor={{ false: '#e5e5ea', true: colors.primary }} />
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
            
            {/* UPDATED: TRIGGER ACTION SHEET */}
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

          </View>

          <Image source={{ uri: selectedPost?.image_url }} style={styles.postImage} />

          <View style={styles.postInteractionBar}>
            <View style={{ flexDirection: 'row' }}>
              <TouchableOpacity onPress={() => setIsLiked(!isLiked)} style={styles.postIcon}>
                 <Ionicons name={isLiked ? "heart" : "heart-outline"} size={28} color={isLiked ? "#ff4040" : colors.text} />
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
            <Text style={styles.likesText}>{isLiked ? '1 like' : '0 likes'}</Text>
            
            {isEditingPost ? (
              <View style={styles.editPostForm}>
                <TextInput 
                  style={styles.editPostInput} 
                  value={editPostNotes} 
                  onChangeText={setEditPostNotes} 
                  autoFocus 
                  multiline
                />
                <View style={styles.editPostActions}>
                  <TouchableOpacity onPress={() => setIsEditingPost(false)}><Text style={styles.editPostCancel}>Cancel</Text></TouchableOpacity>
                  <TouchableOpacity onPress={savePostEdit}><Text style={styles.editPostSave}>Save</Text></TouchableOpacity>
                </View>
              </View>
            ) : (
              <Text style={styles.captionText}>
                <Text style={styles.captionUsername}>{userProfile?.username} </Text>
                [ {selectedPost?.duration_minutes}m {selectedPost?.distance ? `• ${selectedPost.distance}` : ''} {selectedPost?.calories ? `• ${selectedPost.calories} kcal` : ''} ] 
                {selectedPost?.notes ? ` - ${selectedPost.notes}` : ''}
              </Text>
            )}
            <Text style={styles.timeText}>
              {selectedPost?.created_at && (
                <>
                  {new Date(selectedPost.created_at).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} at {new Date(selectedPost.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {" • "}
                  {timeSince(selectedPost.created_at)}
                </>
              )}
            </Text>
          </View>
        </SafeAreaView>
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
          <View style={styles.formContainer}>
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
          </View>
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
  postImage: { width: width, height: width, resizeMode: 'cover', backgroundColor: colors.surface },
  postInteractionBar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 15, paddingVertical: 12 },
  postIcon: { marginRight: 15 },
  postDetails: { paddingHorizontal: 15 },
  likesText: { fontWeight: '700', color: colors.text, marginBottom: 5 },
  captionText: { fontSize: 14, color: colors.text, lineHeight: 20 },
  captionUsername: { fontWeight: '700' },
  timeText: { fontSize: 12, color: colors.textMuted, marginTop: 8 },
  
  // Inline Edit Post Styles
  editPostForm: { marginTop: 5 },
  editPostInput: { borderBottomWidth: 1, borderBottomColor: colors.border, fontSize: 14, paddingVertical: 5, color: colors.text },
  editPostActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 },
  editPostCancel: { color: colors.textMuted, fontWeight: '600', marginRight: 15 },
  editPostSave: { color: colors.primary, fontWeight: '700' }
});