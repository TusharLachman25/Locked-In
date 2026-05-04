// social.ts — Helpers for likes, comments, story views, and shares.
// Centralised here so Feed, Profile, etc. can reuse the same logic.

import { Platform, Share } from 'react-native';
import { supabase } from './supabase';

// ---------- LIKES ----------

export async function toggleLike(workoutId: string, userId: string, currentlyLiked: boolean) {
  if (currentlyLiked) {
    return supabase.from('workout_likes')
      .delete()
      .match({ workout_id: workoutId, user_id: userId });
  }
  return supabase.from('workout_likes')
    .insert({ workout_id: workoutId, user_id: userId });
}

// Get likes for a single workout: returns { count, likedByMe, likers (full list) }
export async function fetchLikes(workoutId: string, currentUserId: string) {
  const { data, error } = await supabase
    .from('workout_likes')
    .select('user_id, profiles:profiles!workout_likes_user_id_fkey(id, username, display_name, avatar_url)')
    .eq('workout_id', workoutId);
  if (error) throw error;

  const likers = (data || []).map((row: any) => row.profiles).filter(Boolean);
  return {
    count: likers.length,
    likedByMe: likers.some(p => p.id === currentUserId),
    likers,
  };
}

// Bulk version for the leaderboard / profile grid where you have many workouts at once.
// Returns a Map<workoutId, { count, likedByMe }> (no liker profiles, just counts).
export async function fetchLikeSummaries(workoutIds: string[], currentUserId: string) {
  const map = new Map<string, { count: number; likedByMe: boolean }>();
  if (!workoutIds.length) return map;

  const { data, error } = await supabase
    .from('workout_likes')
    .select('workout_id, user_id')
    .in('workout_id', workoutIds);
  if (error) throw error;

  for (const id of workoutIds) map.set(id, { count: 0, likedByMe: false });
  for (const row of (data || [])) {
    const entry = map.get(row.workout_id) || { count: 0, likedByMe: false };
    entry.count += 1;
    if (row.user_id === currentUserId) entry.likedByMe = true;
    map.set(row.workout_id, entry);
  }
  return map;
}


// ---------- COMMENTS ----------

export async function fetchComments(workoutId: string) {
  const { data, error } = await supabase
    .from('workout_comments')
    .select('id, workout_id, user_id, content, created_at, profiles:profiles!workout_comments_user_id_fkey(id, username, display_name, avatar_url)')
    .eq('workout_id', workoutId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function addComment(workoutId: string, userId: string, content: string): Promise<{ data: any | null; error: Error | null }> {
  const trimmed = content.trim();
  if (!trimmed) return { data: null, error: new Error('Comment cannot be empty') };
  if (trimmed.length > 500) return { data: null, error: new Error('Comment too long (max 500)') };

  const result = await supabase.from('workout_comments')
    .insert({ workout_id: workoutId, user_id: userId, content: trimmed })
    .select('id, workout_id, user_id, content, created_at, profiles:profiles!workout_comments_user_id_fkey(id, username, display_name, avatar_url)')
    .single();

  if (result.error) return { data: null, error: result.error };
  return { data: result.data, error: null };
}

export async function deleteComment(commentId: string) {
  return supabase.from('workout_comments').delete().eq('id', commentId);
}

// Bulk comment counts for many workouts.
export async function fetchCommentCounts(workoutIds: string[]) {
  const map = new Map<string, number>();
  if (!workoutIds.length) return map;

  const { data, error } = await supabase
    .from('workout_comments')
    .select('workout_id')
    .in('workout_id', workoutIds);
  if (error) throw error;

  for (const id of workoutIds) map.set(id, 0);
  for (const row of (data || [])) {
    map.set(row.workout_id, (map.get(row.workout_id) || 0) + 1);
  }
  return map;
}


// ---------- STORY VIEWS ----------

// Idempotent: calling repeatedly with the same viewer just no-ops at the DB level.
// We use upsert with onConflict so the viewed_at gets refreshed on each new view.
export async function recordStoryView(workoutId: string, viewerId: string) {
  return supabase
    .from('workout_views')
    .upsert(
      { workout_id: workoutId, viewer_id: viewerId, viewed_at: new Date().toISOString() },
      { onConflict: 'workout_id,viewer_id' }
    );
}

// Only the workout owner gets the full list (RLS enforces this). Returns an empty list
// for non-owners due to the policy.
export async function fetchStoryViewers(workoutId: string) {
  const { data, error } = await supabase
    .from('workout_views')
    .select('viewer_id, viewed_at, profiles:profiles!workout_views_viewer_id_fkey(id, username, display_name, avatar_url)')
    .eq('workout_id', workoutId)
    .order('viewed_at', { ascending: false });
  if (error) throw error;
  return data || [];
}


// ---------- SHARING ----------

// Native: invokes the system share sheet with a link (or text fallback).
// Web: copies the URL to clipboard.
export async function shareStoryNative(opts: { title: string; message: string; url?: string }) {
  if (Platform.OS === 'web') {
    if ((navigator as any)?.share) {
      try { await (navigator as any).share(opts); return { ok: true }; } catch { return { ok: false }; }
    }
    if (navigator?.clipboard) {
      await navigator.clipboard.writeText(opts.url || opts.message);
      return { ok: true, copied: true };
    }
    return { ok: false };
  }

  try {
    const result = await Share.share({
      title: opts.title,
      message: opts.url ? `${opts.message}\n${opts.url}` : opts.message,
      url: opts.url, // iOS only
    });
    return { ok: result.action !== Share.dismissedAction };
  } catch {
    return { ok: false };
  }
}

// Share a story image. On native, the OS share sheet receives the URL.
// On web, falls back to navigator.share or clipboard.
export async function shareImageNative(imageUrl: string) {
  return shareStoryNative({
    title: 'Workout',
    message: 'Check this out',
    url: imageUrl,
  });
}