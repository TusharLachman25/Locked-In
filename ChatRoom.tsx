import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  View, Text, StyleSheet, TextInput, TouchableOpacity, 
  FlatList, KeyboardAvoidingView, Platform, ActivityIndicator, Image,
  PanResponder, Animated, Alert, Modal
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { supabase, sendPushNotification } from './supabase';
import { useTheme } from './ThemeContext'; // <-- THEME INJECTED
import { useCustomAlert } from './AlertContext';

const formatTime = (dateString: string) => {
  const d = new Date(dateString);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const formatDateSeparator = (dateString: string) => {
  const date = new Date(dateString);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }); 
};

export default function ChatRoom({ route, navigation }: any) {
  const { showAlert } = useCustomAlert();
  const { colors, theme } = useTheme();
  const styles = useMemo(() => getStyles(colors, theme), [colors, theme]);

  const { roomId, roomName, roomAvatar } = route.params;

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  
  const flatListRef = useRef<FlatList>(null);
  const swipeAnim = useRef(new Animated.Value(0)).current;

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (evt, gestureState) => Math.abs(gestureState.dx) > 10 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy),
    onPanResponderMove: (evt, gestureState) => {
      let newX = gestureState.dx;
      if (newX > 70) newX = 70;
      if (newX < -70) newX = -70;
      swipeAnim.setValue(newX);
    },
    onPanResponderRelease: () => { Animated.spring(swipeAnim, { toValue: 0, useNativeDriver: true, bounciness: 8 }).start(); }
  }), []);

  useEffect(() => {
    setupChat();
    const channel = supabase.channel(`room:${roomId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` },
        () => { fetchMessages(); markRoomAsRead(); }
      ).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [roomId]);

  const setupChat = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      setCurrentUserId(user.id);
      await fetchMessages();
      await markRoomAsReadUser(user.id);
    }
  };

  const markRoomAsReadUser = async (userId: string) => {
    await supabase.from('chat_participants').update({ last_read_at: new Date().toISOString() }).eq('room_id', roomId).eq('user_id', userId);
  };

  const markRoomAsRead = async () => { if (currentUserId) await markRoomAsReadUser(currentUserId); };

  const fetchMessages = async () => {
    try {
      const { data, error } = await supabase.from('messages').select('*, profiles(*), workouts(*)').eq('room_id', roomId).order('created_at', { ascending: false });
      if (error) throw error;
      setMessages(data || []);
    } catch (error) { console.error(error); } finally { setLoading(false); }
  };

  const notifyRoomMembers = async (messageBody: string) => {
    try {
      const { data: participants } = await supabase.from('chat_participants').select('user_id, profiles(expo_push_token)').eq('room_id', roomId).neq('user_id', currentUserId);
      if (participants) {
        for (const p of participants) {
          const profileInfo = Array.isArray(p.profiles) ? p.profiles[0] : p.profiles;
          const token = profileInfo?.expo_push_token;
          if (token) await sendPushNotification(token, roomName, messageBody);
        }
      }
    } catch (error) { console.error(error); }
  };

  const sendMessage = async () => {
    if (!inputText.trim() || !currentUserId) return;
    const messageContent = inputText.trim();
    setInputText(''); 
    try {
      const { error } = await supabase.from('messages').insert({ room_id: roomId, sender_id: currentUserId, content: messageContent });
      if (error) throw error;
      markRoomAsRead();
      notifyRoomMembers(messageContent);
    } catch (error: any) { console.error(error); }
  };

  const openCamera = async () => {
    const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
    if (permissionResult.granted === false) return showAlert("Permission Required", "Allow camera access to send live selfies!");
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 0.6, base64: true });
    if (!result.canceled && result.assets[0].base64) await uploadAndSendImage(result.assets[0].base64);
  };

  const openGallery = async () => {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permissionResult.granted === false) return showAlert("Permission Required", "Allow gallery access to send photos!");
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 0.6, base64: true });
    if (!result.canceled && result.assets[0].base64) await uploadAndSendImage(result.assets[0].base64);
  };

  const uploadAndSendImage = async (base64: string) => {
    if (!currentUserId) return;
    try {
      setUploadingImage(true);
      const filePath = `chat-selfies/${currentUserId}/${Date.now()}.png`;
      const { error: uploadError } = await supabase.storage.from('workout-images').upload(filePath, decode(base64), { contentType: 'image/png' });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from('workout-images').getPublicUrl(filePath);
      const finalMessageContent = inputText.trim() || "📸 Photo";
      const { error: msgError } = await supabase.from('messages').insert({ room_id: roomId, sender_id: currentUserId, content: finalMessageContent, image_url: publicUrl });
      if (msgError) throw msgError;
      setInputText('');
      markRoomAsRead();
      notifyRoomMembers(finalMessageContent);
    } catch (error: any) { showAlert("Upload Failed", error.message); } finally { setUploadingImage(false); }
  };

  const renderMessage = ({ item, index }: { item: any, index: number }) => {
    const isMe = item.sender_id === currentUserId;
    const hasWorkout = item.workout_id && item.workouts;
    const hasImage = !!item.image_url;

    const olderMessage = messages[index + 1];
    const showDateSeparator = !olderMessage || new Date(item.created_at).toDateString() !== new Date(olderMessage.created_at).toDateString();

    const translateXMe = swipeAnim.interpolate({ inputRange: [-70, 0, 70], outputRange: [-60, 0, 0], extrapolate: 'clamp' });
    const translateXThem = swipeAnim.interpolate({ inputRange: [-70, 0, 70], outputRange: [0, 0, 60], extrapolate: 'clamp' });
    const opacityMe = swipeAnim.interpolate({ inputRange: [-60, -20], outputRange: [1, 0], extrapolate: 'clamp' });
    const opacityThem = swipeAnim.interpolate({ inputRange: [20, 60], outputRange: [0, 1], extrapolate: 'clamp' });

    return (
      <View>
        {showDateSeparator && (
          <View style={styles.dateSeparatorContainer}>
            <Text style={styles.dateSeparatorText}>{formatDateSeparator(item.created_at)}</Text>
          </View>
        )}

        <View style={styles.messageRowContainer}>
          {isMe && (
            <Animated.View style={[styles.timeRevealContainerRight, { opacity: opacityMe }]}>
              <Text style={styles.timeRevealText}>{formatTime(item.created_at)}</Text>
            </Animated.View>
          )}
          
          {!isMe && (
            <Animated.View style={[styles.timeRevealContainerLeft, { opacity: opacityThem }]}>
              <Text style={styles.timeRevealText}>{formatTime(item.created_at)}</Text>
            </Animated.View>
          )}

          <Animated.View style={[ styles.messageWrapper, isMe ? styles.messageWrapperMe : styles.messageWrapperThem, { transform: [{ translateX: isMe ? translateXMe : translateXThem }] } ]}>
            {!isMe && <Image source={{ uri: item.profiles?.avatar_url || 'https://via.placeholder.com/150' }} style={styles.avatar} />}
            <View style={[ styles.messageBubble, isMe ? styles.messageBubbleMe : styles.messageBubbleThem, (hasImage || hasWorkout) && styles.messageBubbleMedia ]}>
              
              {hasWorkout && (
                <View style={styles.sharedCard}>
                  <Image source={{ uri: item.workouts.image_url }} style={styles.sharedImage} />
                  <View style={styles.sharedOverlay}>
                    <Text style={styles.sharedActivity}>{item.workouts.activity_type.toUpperCase()}</Text>
                    <Text style={styles.sharedStats}>{item.workouts.duration_minutes}m</Text>
                  </View>
                </View>
              )}

              {hasImage && (
                <TouchableOpacity activeOpacity={0.9} onPress={() => setSelectedImage(item.image_url)}>
                  <Image source={{ uri: item.image_url }} style={styles.chatImage} />
                </TouchableOpacity>
              )}

              {(!hasImage || item.content !== "📸 Photo") && (
                  <Text style={[ styles.messageText, isMe ? styles.messageTextMe : styles.messageTextThem, (hasWorkout || hasImage) && styles.captionText ]}>
                    {item.content}
                  </Text>
              )}
            </View>
          </Animated.View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </TouchableOpacity>
        <Image source={{ uri: roomAvatar || 'https://via.placeholder.com/150' }} style={styles.headerAvatar} />
        <Text style={styles.headerTitle} numberOfLines={1}>{roomName}</Text>
        <View style={{ width: 40 }} /> 
      </View>

      <KeyboardAvoidingView style={styles.keyboardAvoidingView} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 25}>
        {loading ? ( <ActivityIndicator style={{ flex: 1 }} color={colors.primary} /> ) : (
          <View style={{ flex: 1 }} {...panResponder.panHandlers}>
            <FlatList data={messages} keyExtractor={item => item.id} renderItem={renderMessage} inverted contentContainerStyle={styles.listContainer} showsVerticalScrollIndicator={false} />
          </View>
        )}

        <View style={styles.inputContainer}>
          <TouchableOpacity style={styles.attachBtn} onPress={openCamera} disabled={uploadingImage}>
            <Ionicons name="camera-outline" size={26} color={colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.attachBtn} onPress={openGallery} disabled={uploadingImage}>
            <Ionicons name="image-outline" size={26} color={colors.textMuted} />
          </TouchableOpacity>
          <TextInput style={styles.input} placeholder={uploadingImage ? "Sending photo..." : "Message..."} placeholderTextColor={colors.textMuted} value={inputText} onChangeText={setInputText} multiline editable={!uploadingImage} />
          <TouchableOpacity style={styles.sendBtn} onPress={sendMessage} disabled={!inputText.trim() || uploadingImage}>
            {uploadingImage ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="send" size={24} color={inputText.trim() ? colors.primary : colors.textMuted} />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={!!selectedImage} transparent={true} animationType="fade" onRequestClose={() => setSelectedImage(null)}>
        <View style={styles.fullScreenOverlay}>
          <TouchableOpacity style={styles.fullScreenCloseBtn} onPress={() => setSelectedImage(null)}><Ionicons name="close" size={32} color="#fff" /></TouchableOpacity>
          {selectedImage && <Image source={{ uri: selectedImage }} style={styles.fullScreenImage} />}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const getStyles = (colors: any, theme: string) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn: { padding: 5, marginRight: 5 },
  headerAvatar: { width: 36, height: 36, borderRadius: 18, marginRight: 10, backgroundColor: colors.surface },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '700', color: colors.text },
  keyboardAvoidingView: { flex: 1 },
  listContainer: { paddingHorizontal: 15, paddingVertical: 20 },
  
  dateSeparatorContainer: { alignItems: 'center', marginVertical: 20 },
  dateSeparatorText: { fontSize: 12, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },

  messageRowContainer: { position: 'relative', marginBottom: 12 },
  timeRevealContainerRight: { position: 'absolute', right: 0, top: 0, bottom: 0, justifyContent: 'center', width: 50, alignItems: 'center' },
  timeRevealContainerLeft: { position: 'absolute', left: 0, top: 0, bottom: 0, justifyContent: 'center', width: 50, alignItems: 'center' },
  timeRevealText: { fontSize: 11, fontWeight: '600', color: colors.textMuted },

  messageWrapper: { flexDirection: 'row', alignItems: 'flex-end' },
  messageWrapperMe: { justifyContent: 'flex-end' },
  messageWrapperThem: { justifyContent: 'flex-start' },
  avatar: { width: 28, height: 28, borderRadius: 14, marginRight: 8, marginBottom: 2 },
  
  messageBubble: { maxWidth: '75%', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20 },
  messageBubbleMe: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  messageBubbleThem: { backgroundColor: colors.surface, borderBottomLeftRadius: 4 },
  messageBubbleMedia: { paddingHorizontal: 4, paddingVertical: 4 }, 

  messageText: { fontSize: 16, lineHeight: 22 },
  messageTextMe: { color: '#fff' },
  messageTextThem: { color: colors.text },
  captionText: { marginTop: 8, marginBottom: 4, paddingHorizontal: 12, fontStyle: 'italic', fontSize: 14 }, 

  sharedCard: { width: 200, height: 200, borderRadius: 16, overflow: 'hidden', backgroundColor: '#000' },
  sharedImage: { width: '100%', height: '100%', resizeMode: 'cover', opacity: 0.8 },
  sharedOverlay: { position: 'absolute', bottom: 10, left: 10 },
  sharedActivity: { color: colors.primary, fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  sharedStats: { color: '#fff', fontSize: 20, fontWeight: '800' },

  chatImage: { width: 220, height: 293, borderRadius: 16, resizeMode: 'cover', backgroundColor: colors.surface },

  inputContainer: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background },
  attachBtn: { marginRight: 10 },
  input: { flex: 1, backgroundColor: colors.surface, color: colors.text, borderRadius: 20, paddingHorizontal: 15, paddingTop: 10, paddingBottom: 10, fontSize: 16, maxHeight: 100 },
  sendBtn: { marginLeft: 10, padding: 5 },

  fullScreenOverlay: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  fullScreenCloseBtn: { position: 'absolute', top: 50, right: 20, zIndex: 10, padding: 10 },
  fullScreenImage: { width: '100%', height: '100%', resizeMode: 'contain' }
});