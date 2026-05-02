import React, { useState, useEffect } from 'react';
import { StyleSheet, Platform, Alert, View, ActivityIndicator } from 'react-native';
import { Session } from '@supabase/supabase-js';
import { NavigationContainer } from '@react-navigation/native';
import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import { Ionicons } from '@expo/vector-icons';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage'; 

import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import * as Font from 'expo-font'; // <-- ADDED FONT IMPORT

import { ThemeProvider, useTheme } from './ThemeContext'; 
import { supabase } from './supabase';
import Auth from './Auth';
import Feed from './Feed';
import CreatePost from './CreatePost';
import Profile from './Profile';
import Search from './Search';
import Inbox from './Inbox';
import ChatRoom from './ChatRoom';

// --- WEB FONT OVERRIDE ---
if (Platform.OS === 'web') {
  const iconFont = require('@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf');
  const iconFontStyles = `@font-face {
    src: url(${iconFont});
    font-family: Ionicons;
  }`;
  const style = document.createElement('style');
  style.type = 'text/css';
  style.appendChild(document.createTextNode(iconFontStyles));
  document.head.appendChild(style);
}
// ------------------------

const Stack = createNativeStackNavigator();
const Tab = createMaterialTopTabNavigator();

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

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true, 
    shouldShowList: true,   
  }),
});

export async function registerForPushNotificationsAsync(userId: string) {
  let token;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'default', importance: Notifications.AndroidImportance.MAX, vibrationPattern: [0, 250, 250, 250], lightColor: '#34C759' });
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
}

export async function scheduleMorningRoasts() {
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
    <NavigationContainer>
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
        {/* NEW: Reusing the Profile component for public viewing */}
        <Stack.Screen name="UserProfile" component={Profile} /> 
      </Stack.Navigator>
    </NavigationContainer>
  );
}

function MainApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [isReady, setIsReady] = useState(false); // <-- ADDED READINESS STATE
  const { colors } = useTheme();

  useEffect(() => {
    async function loadAssetsAndSession() {
      try {
        // <-- THIS IS THE MAGIC FIX: Force the web to download the font
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
    
    supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session?.user) {
        registerForPushNotificationsAsync(session.user.id);
        scheduleMorningRoasts();
      }
    });
  }, []);

  // Show a loader while the font is downloading
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

import { AlertProvider } from './AlertContext'; // <-- Add this import

export default function App() {
  return (
    <ThemeProvider>
      <AlertProvider>
        <MainApp />
      </AlertProvider>
    </ThemeProvider>
  );
}