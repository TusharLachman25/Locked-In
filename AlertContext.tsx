import React, { createContext, useState, useContext } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from './ThemeContext';

export const AlertContext = createContext<any>(null);

export const AlertProvider = ({ children }: { children: React.ReactNode }) => {
  const { colors, theme } = useTheme();
  const [visible, setVisible] = useState(false);
  const [config, setConfig] = useState({ title: '', message: '', buttons: [] as any[] });

  // Mirrors the exact signature of React Native's Alert.alert
  const showAlert = (title: string, message?: string, buttons?: any[]) => {
    setConfig({
      title,
      message: message || '',
      buttons: buttons && buttons.length > 0 ? buttons : [{ text: 'OK', onPress: () => {} }]
    });
    setVisible(true);
  };

  const handlePress = (onPress?: () => void) => {
    setVisible(false);
    // Add a tiny delay before executing the function to allow the modal to fade out cleanly
    setTimeout(() => {
        if (onPress) onPress();
    }, 100);
  };

  return (
    <AlertContext.Provider value={{ showAlert }}>
      {children}
      <Modal visible={visible} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={[styles.alertBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.title, { color: colors.text }]}>{config.title}</Text>
            {!!config.message && <Text style={[styles.message, { color: colors.textMuted }]}>{config.message}</Text>}

            <View style={[styles.buttonRow, { borderTopColor: colors.border }]}>
              {config.buttons.map((btn, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={[
                    styles.button,
                    idx > 0 && { borderLeftWidth: 1, borderLeftColor: colors.border },
                    config.buttons.length === 1 && { width: '100%' }
                  ]}
                  onPress={() => handlePress(btn.onPress)}
                >
                  <Text style={[
                    styles.buttonText,
                    { color: btn.style === 'destructive' ? '#ff3b30' : colors.primary },
                    btn.style === 'cancel' && { fontWeight: '600' }
                  ]}>
                    {btn.text}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>
    </AlertContext.Provider>
  );
};

export const useCustomAlert = () => useContext(AlertContext);

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  alertBox: { width: '80%', maxWidth: 320, borderRadius: 16, overflow: 'hidden', alignItems: 'center', borderWidth: 1 },
  title: { fontSize: 17, fontWeight: '700', marginTop: 20, marginBottom: 5, textAlign: 'center', paddingHorizontal: 15 },
  message: { fontSize: 13, textAlign: 'center', marginBottom: 20, paddingHorizontal: 15, lineHeight: 18 },
  buttonRow: { flexDirection: 'row', borderTopWidth: 1, width: '100%' },
  button: { flex: 1, paddingVertical: 15, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 17, fontWeight: '500' }
});