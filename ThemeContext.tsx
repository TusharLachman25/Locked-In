import React, { createContext, useState, useEffect, useContext } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// 1. THE COLOR DICTIONARY
export const themeColors = {
  light: {
    background: '#fff',
    surface: '#f9f9fb',    // Light grey for cards
    text: '#1c1c1e',       // Almost black
    textMuted: '#8e8e93',  // Grey text
    border: '#f2f2f7',
    primary: '#34C759',    // Your Squad Green!
  },
  dark: {
    background: '#000',
    surface: '#1c1c1e',    // Dark grey for cards
    text: '#fff',          // White
    textMuted: '#8e8e93',  // Grey text (stays the same)
    border: '#2c2c2e',
    primary: '#34C759',    // Green looks great on black
  }
};

type ThemeType = 'light' | 'dark';

// 2. CREATE THE CONTEXT
export const ThemeContext = createContext<any>(null);

// 3. THE PROVIDER WRAPPER
export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const [theme, setTheme] = useState<ThemeType>('light');

  // Load the saved preference when the app boots up
  useEffect(() => {
    const loadTheme = async () => {
      const savedTheme = await AsyncStorage.getItem('appTheme');
      if (savedTheme === 'dark' || savedTheme === 'light') {
        setTheme(savedTheme);
      }
    };
    loadTheme();
  }, []);

  // The function to flip the switch
  const toggleTheme = async () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    await AsyncStorage.setItem('appTheme', newTheme);
  };

  const colors = themeColors[theme];

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, colors }}>
      {children}
    </ThemeContext.Provider>
  );
};

// 4. A CUSTOM HOOK (So you can easily use this in any file)
export const useTheme = () => useContext(ThemeContext);