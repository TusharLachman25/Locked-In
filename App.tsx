import React, { useState, useEffect } from 'react';
import { StyleSheet, Platform, Alert, View, ActivityIndicator } from 'react-native';
import { Session } from '@supabase/supabase-js';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import { Ionicons } from '@expo/vector-icons';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage'; 

import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import * as Font from 'expo-font';

import { ThemeProvider, useTheme } from './ThemeContext'; 
import { supabase } from './supabase';
import Auth from './Auth';
import Feed from './Feed';
import CreatePost from './CreatePost';
import Profile from './Profile';
import Search from './Search';
import Inbox from './Inbox';
import ChatRoom from './ChatRoom';
import NotificationsScreen from './Notifications';

const Stack = createNativeStackNavigator();
const Tab = createMaterialTopTabNavigator();
const navigationRef = createNavigationContainerRef<any>();

const MORNING_ROASTS = [
  "9:00 AM and zero points? The squad is laughing at you.",
  "Good morning! Your muscles are currently shrinking.",
  "Wake up! The leaderboard waits for no one.",
  "Did you sleep in your gym clothes just to pretend?",
  "Toronto is probably beating you right now.",
  "Time to work out. Couch potato mode is unacceptable today.",
  "You're going to lose the handshake bet at this rate.",
  "Even a sloth has moved more than you today."
];

// Notification handler — only set on native platforms
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true, 
      shouldShowList: true,   
    }),
  });
}

export async function registerForPushNotificationsAsync(userId: string) {
  // Push notifications don't work on web — bail early
  if (Platform.OS === 'web') return;

  try {
    let token;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', { 
        name: 'default', 
        importance: Notifications.AndroidImportance.MAX, 
        vibrationPattern: [0, 250, 250, 250], 
        lightColor: '#34C759' 
      });
    }
    if (Device.isDevice) {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
      if (finalStatus !== 'granted') return;
      
      const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
      token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      
      if (token && userId) {
          await supabase.from('profiles').update({ expo_push_token: token }).eq('id', userId);
      }
    }
    return token;
  } catch (e) {
    console.warn('Push registration failed (non-fatal):', e);
    return null;
  }
}

export async function scheduleMorningRoasts() {
  // Scheduled notifications don't work on web
  if (Platform.OS === 'web') return;

  await Notifications.cancelAllScheduledNotificationsAsync();

  const roastsEnabled = await AsyncStorage.getItem('dailyRoasts');
  if (roastsEnabled === 'false') return; 

  for (let i = 0; i < 7; i++) {
    const randomRoast = MORNING_ROASTS[Math.floor(Math.random() * MORNING_ROASTS.length)];
    const triggerDate = new Date();
    triggerDate.setDate(triggerDate.getDate() + i);
    triggerDate.setHours(9, 0, 0, 0); 

    if (i === 0 && triggerDate.getTime() < Date.now()) continue; 

    await Notifications.scheduleNotificationAsync({
      content: { title: "⏰ Squad Accountability", body: randomRoast, sound: true },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: triggerDate }, 
    });
  }
}

function RootNavigation() {
  const { colors } = useTheme();

  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="MainTabs">
          {() => (
            <Tab.Navigator 
              tabBarPosition="bottom" 
              screenOptions={({ route }) => ({
                headerShown: false,
                tabBarShowLabel: false,
                tabBarActiveTintColor: colors.text,         
                tabBarInactiveTintColor: colors.textMuted,  
                tabBarIndicatorStyle: { height: 0 }, 
                tabBarStyle: { 
                  backgroundColor: colors.background,       
                  paddingBottom: Platform.OS === 'ios' ? 55 : 45, 
                  height: Platform.OS === 'ios' ? 110 : 90,
                  borderTopWidth: 1,
                  borderTopColor: colors.border             
                },
                tabBarIcon: ({ focused, color }) => {
                  let iconName;
                  if (route.name === 'Feed') iconName = focused ? 'home' : 'home-outline';
                  else if (route.name === 'Search') iconName = focused ? 'search' : 'search-outline';
                  else if (route.name === 'Create') iconName = focused ? 'add-circle' : 'add-circle-outline';
                  else if (route.name === 'Chat') iconName = focused ? 'chatbubble' : 'chatbubble-outline';
                  else if (route.name === 'Profile') iconName = focused ? 'person' : 'person-outline';
                  return <Ionicons name={iconName as any} size={28} color={color} />;
                },
            })}>
              <Tab.Screen name="Feed" component={Feed} />
              <Tab.Screen name="Search" component={Search} />
              <Tab.Screen name="Create" component={CreatePost} />
              <Tab.Screen name="Chat" component={Inbox} />
              <Tab.Screen name="Profile" component={Profile} />
            </Tab.Navigator>
          )}
        </Stack.Screen>
        <Stack.Screen name="ChatRoom" component={ChatRoom} />
        <Stack.Screen name="UserProfile" component={Profile} /> 
        <Stack.Screen name="Notifications" component={NotificationsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

function MainApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [isReady, setIsReady] = useState(false);
  const { colors } = useTheme();

  // Inject Ionicons font CSS for web — runs only after mount, never at module load
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      try {
        const iconFont = require('@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf');
        const iconFontStyles = `@font-face {
          src: url(${iconFont});
          font-family: Ionicons;
        }`;
        const style = document.createElement('style');
        style.appendChild(document.createTextNode(iconFontStyles));
        document.head.appendChild(style);
      } catch (e) {
        console.warn('Failed to inject Ionicons font:', e);
      }
    }
  }, []);

  useEffect(() => {
    async function loadAssetsAndSession() {
      try {
        await Font.loadAsync(Ionicons.font);

        const { data: { session } } = await supabase.auth.getSession();
        setSession(session);
        if (session?.user) {
          registerForPushNotificationsAsync(session.user.id);
          scheduleMorningRoasts();
        }
      } catch (e) {
        console.warn(e);
      } finally {
        setIsReady(true);
      }
    }

    loadAssetsAndSession();
    
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session?.user) {
        registerForPushNotificationsAsync(session.user.id);
        scheduleMorningRoasts();
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  // Deep-link when the user taps a push notification.
  // Handles both: (a) cold start where the app launches because of a tap,
  // and (b) live taps while the app is open.
  useEffect(() => {
    if (Platform.OS === 'web') return;

    let sub: Notifications.Subscription | null = null;

    try {
      const handleResponse = (response: Notifications.NotificationResponse) => {
        try {
          const data = response.notification.request.content.data as any;
          if (!data?.type || !navigationRef.current?.isReady()) return;

          switch (data.type) {
            case 'like':
            case 'comment':
            case 'new_post':
              if (data.actor_id) {
                navigationRef.current.navigate('UserProfile', { userId: data.actor_id });
              }
              break;
            case 'follow':
              if (data.actor_id) {
                navigationRef.current.navigate('UserProfile', { userId: data.actor_id });
              }
              break;
            case 'chat':
              if (data.room_id) {
                navigationRef.current.navigate('ChatRoom', { roomId: data.room_id });
              }
              break;
          }
        } catch (e) {
          console.warn('Notification deep-link failed:', e);
        }
      };

      sub = Notifications.addNotificationResponseReceivedListener(handleResponse);

      Notifications.getLastNotificationResponseAsync().then((response) => {
        if (response) handleResponse(response);
      }).catch(() => {});
    } catch (e) {
      console.warn('Notification listener setup failed:', e);
    }

    return () => { sub?.remove(); };
  }, []);

  if (!isReady) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!session) return <Auth />;
  return <RootNavigation />;
}

import { AlertProvider } from './AlertContext';

export default function App() {
  return (
    <ThemeProvider>
      <AlertProvider>
        <MainApp />
      </AlertProvider>
    </ThemeProvider>
  );
}