// notifications.ts — Client helpers for the in-app notifications feed
// and per-user preferences. Push delivery is handled separately on the server.

import { supabase } from './supabase';

export type NotificationRow = {
  id: string;
  recipient_id: string;
  type: 'like' | 'comment' | 'follow' | 'new_post' | 'chat';
  aggregation_key: string;
  actor_count: number;
  last_actor_id: string | null;
  workout_id: string | null;
  comment_id: string | null;
  room_id: string | null;
  preview: string | null;
  read_at: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields:
  last_actor?: {
    id: string;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
  workout?: {
    id: string;
    image_url: string | null;
    activity_type: string | null;
  } | null;
};

export type NotificationPrefs = {
  user_id: string;
  likes: boolean;
  comments: boolean;
  follows: boolean;
  new_posts: boolean;
  chats: boolean;
  daily_roast: boolean;
  push_enabled: boolean;
};

// ---------- FETCHING ----------

export async function fetchNotifications(limit = 50): Promise<NotificationRow[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select(`
      id, recipient_id, type, aggregation_key, actor_count, last_actor_id,
      workout_id, comment_id, room_id, preview, read_at, created_at, updated_at,
      last_actor:profiles!last_actor_id(id, username, display_name, avatar_url),
      workout:workouts!workout_id(id, image_url, activity_type)
    `)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []) as any;
}

export async function fetchUnreadCount(): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .is('read_at', null);
  if (error) throw error;
  return count || 0;
}

// ---------- READ STATE ----------

export async function markAllRead() {
  return supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null);
}

export async function markRead(notificationId: string) {
  return supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId);
}

// ---------- PREFERENCES ----------

// Returns prefs row for the given user, creating it with defaults if missing.
export async function fetchPreferences(userId: string): Promise<NotificationPrefs> {
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;

  if (!data) {
    // Create a default row so future updates work without insert/update branching
    const defaults: NotificationPrefs = {
      user_id: userId,
      likes: true,
      comments: true,
      follows: true,
      new_posts: true,
      chats: true,
      daily_roast: true,
      push_enabled: true,
    };
    await supabase.from('notification_preferences').insert(defaults);
    return defaults;
  }
  return data as NotificationPrefs;
}

export async function updatePreference(
  userId: string,
  key: keyof Omit<NotificationPrefs, 'user_id'>,
  value: boolean
) {
  return supabase
    .from('notification_preferences')
    .upsert(
      { user_id: userId, [key]: value, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
}

// ---------- DISPLAY HELPERS ----------

// Builds the notification text from a row. e.g.:
//   "Alice liked your workout"
//   "Alice and 3 others liked your workout"
//   "Alice commented: nice form"
//   "Alice started following you"
//   "Alice posted a new workout"
export function notificationText(n: NotificationRow): string {
  const actorName = n.last_actor?.display_name || n.last_actor?.username || 'Someone';
  const others = n.actor_count - 1;
  const subject = others > 0 ? `${actorName} and ${others} ${others === 1 ? 'other' : 'others'}` : actorName;

  switch (n.type) {
    case 'like':
      return `${subject} liked your workout`;
    case 'comment':
      return n.preview ? `${actorName} commented: ${n.preview}` : `${actorName} commented on your workout`;
    case 'follow':
      return `${actorName} started following you`;
    case 'new_post':
      return `${actorName} posted a new workout`;
    case 'chat':
      return n.preview ? `${actorName}: ${n.preview}` : `${actorName} sent a message`;
    default:
      return 'New notification';
  }
}