import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, TouchableWithoutFeedback } from 'react-native';
import { useTheme } from './ThemeContext';

interface ActionOption {
  text: string;
  onPress: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

interface ActionSheetProps {
  visible: boolean;
  title?: string;
  options: ActionOption[];
  onClose: () => void;
}

export default function ActionSheet({ visible, title, options, onClose }: ActionSheetProps) {
  const { colors } = useTheme();

  return (
    <Modal visible={visible} transparent animationType="fade">
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View style={[styles.sheetContainer, { backgroundColor: colors.surface }]}>
              {title && <Text style={[styles.title, { color: colors.textMuted }]}>{title}</Text>}
              
              {options.map((option, index) => (
                <TouchableOpacity 
                  key={index} 
                  style={[styles.button, index < options.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}
                  onPress={() => {
                    // 1. Close the current action sheet first
                    onClose();
                    
                    // 2. Wait 350ms for the fade animation to finish, THEN run the function.
                    // This prevents the new Action Sheet from colliding with the old one closing!
                    setTimeout(() => {
                      if (option.onPress) option.onPress();
                    }, 350);
                  }}
                >
                  <Text style={[
                    styles.buttonText, 
                    { color: option.style === 'destructive' ? '#ff3b30' : colors.text },
                    option.style === 'cancel' && { fontWeight: '700' }
                  ]}>
                    {option.text}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end', padding: 20 },
  sheetContainer: { borderRadius: 16, overflow: 'hidden', paddingBottom: 10 },
  title: { textAlign: 'center', fontSize: 13, fontWeight: '600', paddingVertical: 15, paddingHorizontal: 20 },
  button: { paddingVertical: 18, alignItems: 'center' },
  buttonText: { fontSize: 18, fontWeight: '500' }
});