import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Image, ActivityIndicator, RefreshControl
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

import { useTheme } from './ThemeContext';
import { supabase } from './supabase';
import {
  fetchNotifications, markAllRead, markRead, notificationText,
  type NotificationRow,
} from './notificationsApi';

// "5m" / "3h" / "2d" — same style as story timestamps
const formatTimeAgo = (timestamp: string | undefined) => {
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

export default function Notifications() {
  const { colors, theme } = useTheme();
  const styles = useMemo(() => getStyles(colors, theme), [colors, theme]);
  const navigation = useNavigation<any>();

  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchNotifications(50);
      setItems(data);
    } catch (e) {
      console.warn('Failed to load notifications:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    load();
    // Mark everything as read when the screen is focused. The list itself
    // keeps showing the unread highlight until the next refresh, so the
    // user can still see what's new.
    markAllRead().catch(() => {});
  }, [load]));

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const handleTap = async (n: NotificationRow) => {
    if (!n.read_at) markRead(n.id).catch(() => {});

    if (n.type === 'chat' && n.room_id) {
      // Look up room metadata so ChatRoom's header has a name and avatar to render.
      // Group rooms have a stored name; DMs use the other participant's profile.
      try {
        const { data: room } = await supabase
          .from('chat_rooms')
          .select('id, is_group, name')
          .eq('id', n.room_id)
          .single();

        let roomName = room?.name || 'Chat';
        let roomAvatar: string | null = null;

        if (!room?.is_group) {
          // Direct message — use the other participant's profile
          roomName = n.last_actor?.display_name || n.last_actor?.username || 'Chat';
          roomAvatar = n.last_actor?.avatar_url || null;
        }

        navigation.navigate('ChatRoom', { roomId: n.room_id, roomName, roomAvatar });
      } catch {
        navigation.navigate('ChatRoom', { roomId: n.room_id, roomName: 'Chat', roomAvatar: null });
      }
    } else if (n.type === 'follow' && n.last_actor?.id) {
      navigation.navigate('UserProfile', { userId: n.last_actor.id });
    } else if (n.workout_id) {
      const targetId = n.type === 'new_post' ? n.last_actor?.id : null;
      if (targetId) navigation.navigate('UserProfile', { userId: targetId });
    }
  };

  const renderItem = ({ item }: { item: NotificationRow }) => {
    const isUnread = !item.read_at;
    return (
      <TouchableOpacity
        style={[styles.row, isUnread && { backgroundColor: colors.surface }]}
        onPress={() => handleTap(item)}
        activeOpacity={0.7}
      >
        <Image
          source={{ uri: item.last_actor?.avatar_url || 'https://via.placeholder.com/48' }}
          style={styles.avatar}
        />
        <View style={styles.body}>
          <Text style={[styles.text, { color: colors.text }]} numberOfLines={2}>
            {notificationText(item)}
          </Text>
          <Text style={[styles.time, { color: colors.textMuted }]}>
            {formatTimeAgo(item.updated_at)}
          </Text>
        </View>
        {item.workout?.image_url && (
          <Image source={{ uri: item.workout.image_url }} style={styles.thumb} />
        )}
        {isUnread && <View style={[styles.unreadDot, { backgroundColor: colors.primary }]} />}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Notifications</Text>
      </View>

      {loading && items.length === 0 ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="notifications-outline" size={56} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No notifications yet</Text>
          <Text style={[styles.emptyBody, { color: colors.textMuted }]}>
            When friends like, comment, or follow, it'll show up here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        />
      )}
    </SafeAreaView>
  );
}

const getStyles = (colors: any, theme: string) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10 },
  headerTitle: { fontSize: 28, fontWeight: '800', color: colors.text },

  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, paddingHorizontal: 16,
    borderBottomWidth: 0.5, borderBottomColor: colors.border,
  },
  avatar: { width: 48, height: 48, borderRadius: 24, marginRight: 12, backgroundColor: '#eee' },
  body: { flex: 1, paddingRight: 8 },
  text: { fontSize: 14, lineHeight: 19 },
  time: { fontSize: 12, marginTop: 3 },
  thumb: { width: 44, height: 44, borderRadius: 6, backgroundColor: '#eee' },
  unreadDot: { position: 'absolute', left: 6, top: '50%', width: 6, height: 6, borderRadius: 3 },

  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  emptyTitle: { fontSize: 17, fontWeight: '800', marginTop: 14 },
  emptyBody: { fontSize: 14, textAlign: 'center', lineHeight: 20, marginTop: 6 },
});