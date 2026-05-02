import React, { useState, useCallback, useMemo } from 'react';
import { 
  View, Text, StyleSheet, FlatList, TouchableOpacity, 
  ActivityIndicator, Image, Modal, TextInput, Alert, RefreshControl
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from './supabase';
import { useTheme } from './ThemeContext'; 
import ActionSheet from './ActionSheet'; // <-- ADDED ACTION SHEET
import { useCustomAlert } from './AlertContext';

const timeSince = (dateString: string) => {
  if (!dateString) return '';
  const seconds = Math.floor((new Date().getTime() - new Date(dateString).getTime()) / 1000);
  let interval = seconds / 31536000;
  if (interval > 1) return Math.floor(interval) + 'y';
  interval = seconds / 604800;
  if (interval >= 1) return Math.floor(interval) + 'w';
  interval = seconds / 86400;
  if (interval >= 1) return Math.floor(interval) + 'd';
  interval = seconds / 3600;
  if (interval >= 1) return Math.floor(interval) + 'h';
  interval = seconds / 60;
  if (interval >= 1) return Math.floor(interval) + 'm';
  return 'now';
};

export default function Inbox({ navigation }: any) {
  const { showAlert } = useCustomAlert();
  const { colors, theme } = useTheme();
  const styles = useMemo(() => getStyles(colors, theme), [colors, theme]);

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [rooms, setRooms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [showNewChat, setShowNewChat] = useState(false);
  const [availableUsers, setAvailableUsers] = useState<any[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');
  const [creating, setCreating] = useState(false);

  // --- ADDED ACTION SHEET STATE ---
  const [actionSheetVisible, setActionSheetVisible] = useState(false);
  const [actionSheetConfig, setActionSheetConfig] = useState<any>({});

  useFocusEffect(
    useCallback(() => {
      fetchInbox();
    }, [])
  );

  const fetchInbox = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setCurrentUserId(user.id);

      const { data: myParticipantRows } = await supabase.from('chat_participants').select('room_id').eq('user_id', user.id);
      if (!myParticipantRows || myParticipantRows.length === 0) { setRooms([]); setLoading(false); return; }

      const roomIds = myParticipantRows.map(row => row.room_id);

      const { data: roomData } = await supabase.from('chat_rooms').select('*').in('id', roomIds).order('created_at', { ascending: false });
      const { data: allParticipants } = await supabase.from('chat_participants').select('room_id, user_id, last_read_at, profiles(*)').in('room_id', roomIds);
      const { data: latestMessages } = await supabase.from('messages').select('*').in('room_id', roomIds).order('created_at', { ascending: false });

      const lastMessages: Record<string, any> = {};
      if (latestMessages) {
        latestMessages.forEach(msg => {
          if (!lastMessages[msg.room_id]) lastMessages[msg.room_id] = msg;
        });
      }

      if (roomData && allParticipants) {
        const formattedRooms = roomData.map(room => {
          const myParticipantData = allParticipants.find(p => p.room_id === room.id && p.user_id === user.id);
          const otherMembers = allParticipants.filter(p => p.room_id === room.id && p.user_id !== user.id).map(p => ({ ...p.profiles, last_read_at: p.last_read_at }));

          let displayTitle = '';
          let displayAvatar = '';

          if (room.is_group) {
            displayTitle = room.name || 'Squad Group';
            displayAvatar = 'https://ui-avatars.com/api/?name=Group&background=e5e5ea&color=000';
          } else {
            const rawProfile = otherMembers[0] as any;
            const otherPerson = Array.isArray(rawProfile) ? rawProfile[0] : rawProfile;
            displayTitle = otherPerson?.display_name || otherPerson?.username || 'Unknown';
            displayAvatar = otherPerson?.avatar_url || 'https://via.placeholder.com/150';
          }

          const lastMessage = lastMessages[room.id];
          let subtitle = room.is_group ? `${otherMembers.length + 1} members` : 'Tap to chat';
          let isUnread = false;
          let lastMessageTime = '';

          if (lastMessage && myParticipantData) {
            lastMessageTime = timeSince(lastMessage.created_at);
            const isMe = lastMessage.sender_id === user.id;
            const messageContent = lastMessage.workout_id ? 'Shared a workout' : lastMessage.content;

            if (isMe) {
              const someoneReadIt = otherMembers.some(m => new Date(m.last_read_at) >= new Date(lastMessage.created_at));
              subtitle = `You: ${messageContent} • ${someoneReadIt ? 'Seen' : 'Delivered'}`;
            } else {
              isUnread = new Date(lastMessage.created_at) > new Date(myParticipantData.last_read_at);
              subtitle = messageContent;
            }
          }

          return { 
            ...room, displayTitle, displayAvatar, otherMembers, 
            subtitle, isUnread, lastMessageTime, 
            lastActivity: lastMessage ? new Date(lastMessage.created_at).getTime() : new Date(room.created_at).getTime()
          };
        });

        setRooms(formattedRooms.sort((a, b) => b.lastActivity - a.lastActivity));
      }
    } catch (error) { console.error(error); } finally { setLoading(false); }
  };

  const onRefresh = async () => { setRefreshing(true); await fetchInbox(); setRefreshing(false); };

  // --- UPDATED DELETE CHAT TO USE ACTION SHEET ---
  const handleDeleteChat = (roomId: string, roomName: string) => {
    setActionSheetConfig({
      title: `Are you sure you want to permanently delete your chat with ${roomName}?`,
      options: [
        { 
          text: "Delete", 
          style: "destructive", 
          onPress: async () => {
            try {
              await supabase.from('chat_rooms').delete().eq('id', roomId);
              setRooms(prev => prev.filter(r => r.id !== roomId));
            } catch (e: any) { showAlert("Error", e.message); }
          }
        },
        { text: "Cancel", style: "cancel", onPress: () => {} }
      ]
    });
    setActionSheetVisible(true);
  };

  const openNewChatModal = async () => {
    setShowNewChat(true); setSelectedUsers([]); setGroupName('');
    if (currentUserId) {
      const { data: follows } = await supabase.from('follows').select('following_id').eq('follower_id', currentUserId);
      if (follows && follows.length > 0) {
        const followingIds = follows.map(f => f.following_id);
        const { data: profiles } = await supabase.from('profiles').select('*').in('id', followingIds);
        setAvailableUsers(profiles || []);
      }
    }
  };

  const toggleUserSelection = (id: string) => {
    if (selectedUsers.includes(id)) setSelectedUsers(selectedUsers.filter(userId => userId !== id));
    else setSelectedUsers([...selectedUsers, id]);
  };

  const startChat = async () => {
    if (selectedUsers.length === 0) return showAlert("Hold up", "Select at least one friend.");
    if (selectedUsers.length > 1 && groupName.trim() === '') return showAlert("Name the Squad", "Group chats need a name.");

    try {
      setCreating(true);
      const isGroup = selectedUsers.length > 1;

      if (!isGroup) {
        const targetUserId = selectedUsers[0];
        const existingDM = rooms.find(room => {
          if (room.is_group) return false;
          return room.otherMembers.some((member: any) => {
            const unwrappedMember = Array.isArray(member) ? member[0] : member;
            return unwrappedMember?.id === targetUserId;
          });
        });

        if (existingDM) {
          setShowNewChat(false);
          navigation.navigate('ChatRoom', { roomId: existingDM.id, roomName: existingDM.displayTitle, roomAvatar: existingDM.displayAvatar });
          setCreating(false); return;
        }
      }

      const { data: newRoom, error: roomError } = await supabase.from('chat_rooms').insert({ is_group: isGroup, name: isGroup ? groupName : null }).select().single();
      if (roomError) throw roomError;

      const participants = [{ room_id: newRoom.id, user_id: currentUserId }, ...selectedUsers.map(id => ({ room_id: newRoom.id, user_id: id }))];
      const { error: partError } = await supabase.from('chat_participants').insert(participants);
      if (partError) throw partError;

      await fetchInbox();
      setShowNewChat(false);
    } catch (error: any) { showAlert("Error", error.message); } finally { setCreating(false); }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Messages</Text>
        <TouchableOpacity onPress={openNewChatModal} style={styles.newChatBtn}><Ionicons name="create-outline" size={28} color={colors.text} /></TouchableOpacity>
      </View>

      {loading ? ( <ActivityIndicator style={{ marginTop: 50 }} color={colors.primary} /> ) : (
        <FlatList
          data={rooms}
          keyExtractor={item => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          contentContainerStyle={{ padding: 20 }}
          renderItem={({ item }) => (
            <TouchableOpacity 
              style={styles.roomCard}
              onPress={() => navigation.navigate('ChatRoom', { roomId: item.id, roomName: item.displayTitle, roomAvatar: item.displayAvatar })}
              onLongPress={() => handleDeleteChat(item.id, item.displayTitle)}
              delayLongPress={300}
            >
              <Image source={{ uri: item.displayAvatar }} style={styles.roomAvatar} />
              <View style={styles.roomInfo}>
                <Text style={[styles.roomName, item.isUnread && styles.unreadText]}>{item.displayTitle}</Text>
                <View style={styles.subtitleRow}>
                  <Text style={[styles.roomSubtitle, item.isUnread && styles.unreadText]} numberOfLines={1}>
                    {item.subtitle}
                  </Text>
                  {item.lastMessageTime ? <Text style={[styles.timeText, item.isUnread && styles.unreadText]}> • {item.lastMessageTime}</Text> : null}
                </View>
              </View>
              {item.isUnread ? <View style={styles.unreadDot} /> : <Ionicons name="camera-outline" size={26} color={colors.textMuted} />}
            </TouchableOpacity>
          )}
          ListEmptyComponent={<Text style={styles.emptyText}>No messages yet. Start a chat with the squad!</Text>}
        />
      )}

      {/* NEW CHAT MODAL */}
      <Modal visible={showNewChat} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowNewChat(false)}><Text style={styles.modalCancel}>Cancel</Text></TouchableOpacity>
            <Text style={styles.modalTitle}>New Chat</Text>
            <TouchableOpacity onPress={startChat} disabled={creating}>
              {creating ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.modalSave}>Start</Text>}
            </TouchableOpacity>
          </View>
          <View style={styles.modalContent}>
            {selectedUsers.length > 1 && (
              <View style={styles.groupNameContainer}>
                <TextInput style={styles.groupInput} placeholder="Group Name (e.g. Sunday Padel)" placeholderTextColor={colors.textMuted} value={groupName} onChangeText={setGroupName} />
              </View>
            )}
            <Text style={styles.sectionLabel}>Suggested</Text>
            <FlatList
              data={availableUsers}
              keyExtractor={item => item.id}
              renderItem={({ item }) => {
                const isSelected = selectedUsers.includes(item.id);
                return (
                  <TouchableOpacity style={styles.userSelectCard} onPress={() => toggleUserSelection(item.id)}>
                    <Image source={{ uri: item.avatar_url || 'https://via.placeholder.com/150' }} style={styles.userSelectAvatar} />
                    <View style={styles.userSelectInfo}>
                      <Text style={styles.userSelectName}>{item.display_name || item.username}</Text>
                      <Text style={styles.userSelectUsername}>@{item.username}</Text>
                    </View>
                    <Ionicons name={isSelected ? "checkmark-circle" : "ellipse-outline"} size={28} color={isSelected ? colors.primary : colors.border} />
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={<Text style={styles.emptyText}>Follow some friends to start a chat!</Text>}
            />
          </View>
        </SafeAreaView>
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

const getStyles = (colors: any, theme: string) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 15, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTitle: { fontSize: 32, fontWeight: '900', letterSpacing: -1, color: colors.text },
  newChatBtn: { padding: 5 },
  
  roomCard: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  roomAvatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.surface },
  roomInfo: { flex: 1, marginLeft: 15, marginRight: 10 },
  roomName: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 2 },
  subtitleRow: { flexDirection: 'row', alignItems: 'center' },
  roomSubtitle: { fontSize: 14, color: colors.textMuted, flexShrink: 1 },
  timeText: { fontSize: 14, color: colors.textMuted },
  
  unreadText: { fontWeight: '800', color: colors.text }, 
  unreadDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary, marginRight: 8 },

  emptyText: { textAlign: 'center', color: colors.textMuted, marginTop: 40, fontSize: 15 },
  modalContainer: { flex: 1, backgroundColor: colors.background },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 15, borderBottomWidth: 1, borderBottomColor: colors.border },
  modalCancel: { fontSize: 16, color: colors.text },
  modalTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  modalSave: { fontSize: 16, fontWeight: '700', color: colors.primary },
  modalContent: { flex: 1 },
  groupNameContainer: { padding: 15, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  groupInput: { fontSize: 16, fontWeight: '600', paddingVertical: 10, color: colors.text },
  sectionLabel: { fontSize: 13, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 10 },
  userSelectCard: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12 },
  userSelectAvatar: { width: 50, height: 50, borderRadius: 25 },
  userSelectInfo: { flex: 1, marginLeft: 15 },
  userSelectName: { fontSize: 16, fontWeight: '700', color: colors.text },
  userSelectUsername: { fontSize: 14, color: colors.textMuted, marginTop: 2 }
});