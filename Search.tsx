import React, { useState, useEffect, useMemo } from 'react';
import { 
  View, Text, TextInput, StyleSheet, TouchableOpacity, 
  Image, FlatList, ActivityIndicator 
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from './supabase';
import { useTheme } from './ThemeContext'; // <-- THEME INJECTED

export default function Search() {
  const { colors, theme } = useTheme();
  const styles = useMemo(() => getStyles(colors, theme), [colors, theme]);

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [followingIds, setFollowingIds] = useState<string[]>([]);

  useEffect(() => {
    setupUser();
  }, []);

  const setupUser = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      setCurrentUserId(user.id);
      fetchYourFollows(user.id);
      searchProfiles('', user.id); 
    }
  };

  const fetchYourFollows = async (userId: string) => {
    const { data } = await supabase.from('follows').select('following_id').eq('follower_id', userId);
    if (data) setFollowingIds(data.map(f => f.following_id));
  };

  const searchProfiles = async (text: string, userId: string | null = currentUserId) => {
    setSearchQuery(text);
    if (!userId) return;
    setIsSearching(true);

    try {
      let query = supabase.from('profiles').select('id, username, display_name, avatar_url').neq('id', userId).limit(20);
      if (text.trim() !== '') query = query.or(`username.ilike.%${text}%,display_name.ilike.%${text}%`);

      const { data, error } = await query;
      if (error) throw error;
      setResults(data || []);
    } catch (error) { console.error(error); } finally { setIsSearching(false); }
  };

  const toggleFollow = async (targetUserId: string) => {
    if (!currentUserId) return;
    const isFollowing = followingIds.includes(targetUserId);

    if (isFollowing) setFollowingIds(prev => prev.filter(id => id !== targetUserId));
    else setFollowingIds(prev => [...prev, targetUserId]);

    try {
      if (isFollowing) await supabase.from('follows').delete().match({ follower_id: currentUserId, following_id: targetUserId });
      else await supabase.from('follows').insert({ follower_id: currentUserId, following_id: targetUserId });
    } catch (error) { fetchYourFollows(currentUserId); }
  };

  const renderItem = ({ item }: { item: any }) => {
    const isFollowing = followingIds.includes(item.id);
    return (
      <View style={styles.userCard}>
        <Image source={{ uri: item.avatar_url || 'https://via.placeholder.com/150' }} style={styles.avatar} />
        <View style={styles.userInfo}>
          <Text style={styles.displayName}>{item.display_name || item.username}</Text>
          <Text style={styles.username}>@{item.username}</Text>
        </View>
        <TouchableOpacity style={[styles.followBtn, isFollowing && styles.followingBtn]} onPress={() => toggleFollow(item.id)}>
          <Text style={[styles.followBtnText, isFollowing && styles.followingBtnText]}>{isFollowing ? 'Following' : 'Follow'}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Find Friends</Text>
      </View>

      <View style={styles.searchContainer}>
        <Ionicons name="search" size={20} color={colors.textMuted} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name or username..."
          placeholderTextColor={colors.textMuted}
          value={searchQuery}
          onChangeText={searchProfiles}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {isSearching && results.length === 0 ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContainer}
          ListEmptyComponent={<Text style={styles.emptyText}>No users found.</Text>}
        />
      )}
    </SafeAreaView>
  );
}

const getStyles = (colors: any, theme: string) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10 },
  headerTitle: { fontSize: 28, fontWeight: '800', color: colors.text },
  
  searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, marginHorizontal: 20, borderRadius: 12, paddingHorizontal: 15, height: 45, marginBottom: 20 },
  searchIcon: { marginRight: 10 },
  searchInput: { flex: 1, fontSize: 16, color: colors.text },
  
  listContainer: { paddingHorizontal: 20, paddingBottom: 40 },
  userCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, padding: 15, borderRadius: 16, marginBottom: 10, shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 5, elevation: 1 },
  avatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: colors.background },
  userInfo: { flex: 1, marginLeft: 15 },
  displayName: { fontSize: 16, fontWeight: '700', color: colors.text },
  username: { fontSize: 14, color: colors.textMuted, marginTop: 2 },
  
  followBtn: { backgroundColor: colors.primary, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20 },
  followBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  
  followingBtn: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  followingBtnText: { color: colors.text },
  
  emptyText: { textAlign: 'center', color: colors.textMuted, marginTop: 40, fontSize: 16 },
});