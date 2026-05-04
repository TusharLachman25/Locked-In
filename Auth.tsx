import React, { useState, useMemo } from 'react';
import { 
  View, Text, TextInput, TouchableOpacity, StyleSheet, 
  Image, KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView 
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from './supabase';
import { useTheme } from './ThemeContext';
import { useCustomAlert } from './AlertContext';

export default function Auth() {
  const { colors, theme } = useTheme();
  const styles = useMemo(() => getStyles(colors, theme), [colors, theme]);
  const { showAlert } = useCustomAlert();

  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);

  // Form State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);

  const pickAvatar = async () => {
    let result = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!result.granted) {
      showAlert("Permission Required", "Allow gallery access to choose a profile picture.");
      return;
    }

    let imageResult = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
      base64: true,
    });

    if (!imageResult.canceled && imageResult.assets[0].uri) {
      setAvatarUri(imageResult.assets[0].uri);
    }
  };

  const handleAuth = async () => {
    if (!email || !password) return showAlert("Missing Info", "Please enter both an email and password.");
    
    setLoading(true);
    
    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        if (!username || !displayName) throw new Error("Please provide a name and username to get Locked In.");

        const cleanUsername = username.toLowerCase().trim();
        const cleanDisplayName = displayName.trim();

        const { data, error } = await supabase.auth.signUp({ 
          email, 
          password,
          options: {
            data: {
              username: cleanUsername,
              display_name: cleanDisplayName,
            }
          }
        });

        if (error) throw error;
        if (!data.user) throw new Error("Signup didn't return a user. Try again.");

        // Upload the avatar first (if any) so we can save the URL with the rest of the profile.
        // Email confirmation is OFF, so data.session exists here and RLS will allow the writes.
        let avatarPublicUrl: string | null = null;

        if (avatarUri && data.session) {
          try {
            let base64 = '';
            if (Platform.OS === 'web') {
              const response = await fetch(avatarUri);
              const blob = await response.blob();
              base64 = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result?.toString().split(',')[1] || '');
                reader.readAsDataURL(blob);
              });
            } else {
              base64 = await FileSystem.readAsStringAsync(avatarUri, { encoding: 'base64' });
            }

            if (base64) {
              const filePath = `${data.user.id}/${Date.now()}.png`;
              const { error: uploadError } = await supabase.storage
                .from('avatars')
                .upload(filePath, decode(base64), { contentType: 'image/png' });

              if (!uploadError) {
                const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(filePath);
                avatarPublicUrl = publicUrl;
              } else {
                console.warn('Avatar upload failed:', uploadError);
              }
            }
          } catch (uploadErr) {
            console.warn('Avatar processing failed:', uploadErr);
            // Don't fail the whole signup just because the avatar didn't upload
          }
        }

        // Write the profile row. Upsert handles both cases:
        //   - Row already exists (created by a handle_new_user trigger) → update it
        //   - Row doesn't exist → insert it
        const profileFields: Record<string, any> = {
          id: data.user.id,
          username: cleanUsername,
          display_name: cleanDisplayName,
        };
        if (avatarPublicUrl) profileFields.avatar_url = avatarPublicUrl;

        const { error: profileError } = await supabase
          .from('profiles')
          .upsert(profileFields, { onConflict: 'id' });

        if (profileError) {
          // Surface this — if the profile write fails, the user will end up in a half-broken state
          throw new Error(`Account created but profile setup failed: ${profileError.message}`);
        }

        if (!data.session) {
          showAlert("You are Locked In! 🔒", "Check your email for the confirmation link.");
        }
      }
    } catch (err: any) {
      showAlert(isLogin ? "Login Failed" : "Sign Up Failed", err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setIsLogin(!isLogin);
    if (isLogin) {
      setUsername('');
      setDisplayName('');
      setAvatarUri(null);
    }
  };

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
        
        <View style={styles.brandContainer}>
          <Image 
            source={require('./assets/icon.png')}
            style={styles.logoImage} 
          />
          <Text style={styles.brandTagline}>Sweat now, shine later.</Text>
        </View>

        <View style={styles.headerContainer}>
          <Text style={styles.title}>{isLogin ? "Welcome Back" : "Get Locked In"}</Text>
          <Text style={styles.subtitle}>
            {isLogin ? "Log in to check the leaderboards." : "Create an account to start tracking your workouts."}
          </Text>
        </View>

        {!isLogin && (
          <View style={styles.avatarSection}>
            <TouchableOpacity style={styles.avatarPlaceholder} onPress={pickAvatar}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
              ) : (
                <Ionicons name="camera" size={32} color={colors.textMuted} />
              )}
              <View style={styles.avatarEditIcon}>
                <Ionicons name="add" size={16} color={colors.background} />
              </View>
            </TouchableOpacity>
            <Text style={styles.avatarHint}>Add a profile picture</Text>
          </View>
        )}

        <View style={styles.formContainer}>
          {!isLogin && (
            <>
              <View style={styles.inputWrapper}>
                <Ionicons name="person-outline" size={20} color={colors.textMuted} style={styles.inputIcon} />
                <TextInput style={styles.input} placeholder="Full Name" placeholderTextColor={colors.textMuted} value={displayName} onChangeText={setDisplayName} />
              </View>

              <View style={styles.inputWrapper}>
                <Ionicons name="at-outline" size={20} color={colors.textMuted} style={styles.inputIcon} />
                <TextInput style={styles.input} placeholder="Username" placeholderTextColor={colors.textMuted} value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} />
              </View>
            </>
          )}

          <View style={styles.inputWrapper}>
            <Ionicons name="mail-outline" size={20} color={colors.textMuted} style={styles.inputIcon} />
            <TextInput style={styles.input} placeholder="Email Address" placeholderTextColor={colors.textMuted} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
          </View>

          <View style={styles.inputWrapper}>
            <Ionicons name="lock-closed-outline" size={20} color={colors.textMuted} style={styles.inputIcon} />
            <TextInput style={styles.input} placeholder="Password" placeholderTextColor={colors.textMuted} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" />
          </View>
        </View>

        <TouchableOpacity style={[styles.primaryButton, loading && { opacity: 0.7 }]} onPress={handleAuth} disabled={loading}>
          {loading ? (
            <ActivityIndicator color={colors.background} />
          ) : (
            <Text style={styles.primaryButtonText}>{isLogin ? "Sign In" : "Create Account"}</Text>
          )}
        </TouchableOpacity>

        <View style={styles.footerContainer}>
          <Text style={styles.footerText}>{isLogin ? "Don't have an account? " : "Already have an account? "}</Text>
          <TouchableOpacity onPress={toggleMode}>
            <Text style={styles.footerLink}>{isLogin ? "Sign Up" : "Log In"}</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const getStyles = (colors: any, theme: string) => StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: colors.background 
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  brandContainer: {
    alignItems: 'center',
    marginBottom: 40,
    marginTop: Platform.OS === 'ios' ? 40 : 20,
  },
  logoImage: {
    width: 140,
    height: 140,
    borderRadius: 24,
    marginBottom: 10,
  },
  brandTagline: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 4,
    fontWeight: '600',
  },
  headerContainer: {
    marginBottom: 30,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: colors.textMuted,
    lineHeight: 22,
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: 30,
  },
  avatarPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 50,
  },
  avatarEditIcon: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: colors.text,
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: colors.background,
  },
  avatarHint: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  formContainer: {
    marginBottom: 20,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    marginBottom: 16,
    height: 56,
    paddingHorizontal: 16,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: colors.text,
    height: '100%',
  },
  primaryButton: {
    backgroundColor: colors.primary,
    height: 56,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
  },
  footerContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 30,
    paddingBottom: 20,
  },
  footerText: {
    fontSize: 15,
    color: colors.textMuted,
  },
  footerLink: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.primary,
  },
});