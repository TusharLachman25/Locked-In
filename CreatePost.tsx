import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { supabase, sendPushNotification } from './supabase'; 
import React, { useState, useRef, useMemo } from 'react';
import { 
  View, Text, TextInput, Image, StyleSheet, Alert, 
  TouchableOpacity, ScrollView, ActivityIndicator 
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { captureRef } from 'react-native-view-shot';
import { useTheme } from './ThemeContext'; // <-- THEME BRAIN
  // 1. Add this import at the top if not there
import { Platform } from 'react-native';
import { useCustomAlert } from './AlertContext';

const ACTIVITY_CONFIG: Record<string, { fields: string[], image: string }> = {
  'Gym': { fields: ['Duration', 'Calories', 'Focus'], image: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?q=80&w=1000&auto=format&fit=crop' },
  'Swim': { fields: ['Distance', 'Duration', 'Avg Pace', 'SWOLF', 'Calories'], image: 'https://images.unsplash.com/photo-1519315901367-f34f92240570?q=80&w=1000&auto=format&fit=crop' },
  'Padel': { fields: ['Duration', 'Calories', 'Match Score'], image: 'https://images.unsplash.com/photo-1628124978864-46ab9707db0a?q=80&w=1000&auto=format&fit=crop' },
  'Badminton': { fields: ['Duration', 'Calories'], image: 'https://images.unsplash.com/photo-1626224583764-f87db24ac4ea?q=80&w=1000&auto=format&fit=crop' },
  'Table Tennis': { fields: ['Duration', 'Calories', 'Match Score'], image: 'https://images.unsplash.com/photo-1609710228159-0fa9bd7c0827?q=80&w=1000&auto=format&fit=crop' },
  'Running': { fields: ['Distance', 'Duration', 'Avg Pace', 'Calories'], image: 'https://images.unsplash.com/photo-1502281286595-bb0e271500f4?q=80&w=1000&auto=format&fit=crop' },
  'Football (Competitive)': { fields: ['Duration', 'Calories', 'Goals'], image: 'https://images.unsplash.com/photo-1518605368461-1ee7e53f18ea?q=80&w=1000&auto=format&fit=crop' },
  'Football (Casual)': { fields: ['Duration', 'Calories', 'Goals'], image: 'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?q=80&w=1000&auto=format&fit=crop' },
  'Stretching': { fields: ['Duration'], image: 'https://images.unsplash.com/photo-1552604617-eea22a00c6d7?q=80&w=1000&auto=format&fit=crop' }
};



const ACTIVITIES = Object.keys(ACTIVITY_CONFIG);

export default function CreatePost({ navigation }: any) {
  const { showAlert } = useCustomAlert();
  const { colors, theme } = useTheme(); // <-- PULL IN COLORS
  const styles = useMemo(() => getStyles(colors, theme), [colors, theme]);

  const [mode, setMode] = useState<'custom' | 'existing'>('custom');
  const [activity, setActivity] = useState<string>('Gym');
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  
  const [isExtracting, setIsExtracting] = useState(false);
  const [proofImage, setProofImage] = useState<string | null>(null);
  const imageRef = useRef<View>(null);

  // --- NEW: DATE & TIME STATE (MUST BE INSIDE THE FUNCTION) ---
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');

  const [postDate, setPostDate] = useState(`${yyyy}-${mm}-${dd}`);
  const [postTime, setPostTime] = useState(`${hh}:${min}`);

  const handleInputChange = (field: string, value: string) => {
    setFormValues(prev => ({ ...prev, [field]: value }));
  };

  const pickImage = async (isScreenshot: boolean = false) => {
    let result = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!result.granted) return showAlert("Gallery permission required!");

    let imageResult = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, 
      allowsEditing: true, aspect: [1, 1], quality: 0.8, base64: true,
    });

    if (!imageResult.canceled) {
      setProofImage(imageResult.assets[0].uri);
      setFormValues({});
      
      if (isScreenshot && imageResult.assets[0].base64) {
          extractDataWithGemini(imageResult.assets[0].base64);
      }
    }
  };

  const extractDataWithGemini = async (base64Image: string) => {
      setIsExtracting(true);
      const GEMINI_API_KEY = 'REDACTED_API_KEY_USE_ENV_VAR'; 
      const prompt = `Analyze this workout summary screenshot. Extract the data and return ONLY a raw JSON object. Do not include any formatting, markdown, or conversational text. The JSON keys must be exactly: "activity", "Distance", "Duration", "Avg Pace", "Calories", "SWOLF". For "activity", guess the best match from this list based on the image: Gym, Swim, Padel, Badminton, Table Tennis, Running, Football (Competitive), Football (Casual), Stretching. If unsure, use "Gym". If a value is not visible, use an empty string "". CRITICAL INSTRUCTIONS: For "Duration", convert the time into TOTAL MINUTES as a plain number string (e.g., "2:00:28" becomes "120"). For "Calories", provide ONLY the raw number without commas or units (e.g., "1,364 kcal" becomes "1364"). Example output: {"activity": "Running", "Distance": "5.0 km", "Duration": "25", "Avg Pace": "5'00\"", "Calories": "300", "SWOLF": ""}`;

      try {
          const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: "image/jpeg", data: base64Image } }] }] })
          });

          const result = await response.json();
          if (!result.candidates) throw new Error(result.error?.message || "Invalid response");

          let rawText = result.candidates[0].content.parts[0].text;
          rawText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
          
          const parsedData = JSON.parse(rawText);

          if (parsedData.activity && ACTIVITIES.includes(parsedData.activity)) setActivity(parsedData.activity);
          
          const newFormValues: Record<string, string> = {};
          if (parsedData.Distance) newFormValues['Distance'] = parsedData.Distance;
          if (parsedData.Duration) newFormValues['Duration'] = parsedData.Duration;
          if (parsedData["Avg Pace"]) newFormValues['Avg Pace'] = parsedData["Avg Pace"];
          if (parsedData.Calories) newFormValues['Calories'] = parsedData.Calories;
          if (parsedData.SWOLF) newFormValues['SWOLF'] = parsedData.SWOLF;

          setFormValues(newFormValues);

      } catch (error: any) {
          showAlert("Extraction Failed", "Could not perfectly read the image, but you can still post it!");
      } finally { setIsExtracting(false); }
  };


// 2. Updated handlePost function
const handlePost = async () => {
  try {
    if (!proofImage && mode === 'existing') return showAlert("Hold up", "Upload a screenshot first.");
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return showAlert("Error", "You must be logged in.");

    let finalImageUri = proofImage || ACTIVITY_CONFIG[activity].image;

    // --- WEB SAFETY CHECK ---
    if (mode === 'custom' && Platform.OS !== 'web') {
      finalImageUri = await captureRef(imageRef, { format: 'png', quality: 1 });
    }

    let base64: string = ''; // Initialize as an empty string with explicit type

    if (Platform.OS === 'web') {
      const response = await fetch(finalImageUri);
      const blob = await response.blob();
      base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result?.toString().split(',')[1] || '';
          resolve(result);
        };
        reader.readAsDataURL(blob);
      });
    } else {
      // For Android (APK), use FileSystem
      base64 = await FileSystem.readAsStringAsync(finalImageUri, { encoding: 'base64' });
    }

    if (!base64) throw new Error("Could not process image.");

    const filePath = `${user.id}/${Date.now()}.png`;
    
    // Now decode(base64) will be happy because base64 is guaranteed to be a string
    const { error: uploadError } = await supabase.storage
      .from('workout-images')
      .upload(filePath, decode(base64), { contentType: 'image/png' });
      
    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage.from('workout-images').getPublicUrl(filePath);

    let durationInt = 0, calInt = 0;
// We remove commas first, so "1,364" becomes "1364" before we extract the digits
    if (formValues['Duration']) durationInt = parseInt(formValues['Duration'].replace(/,/g, '').match(/\d+/)?.[0] || '0', 10);
    if (formValues['Calories']) calInt = parseInt(formValues['Calories'].replace(/,/g, '').match(/\d+/)?.[0] || '0', 10);

    // Safely parse the manual date/time. Fall back to current time if the user types an invalid format.
    let isoToSave = new Date().toISOString();
    try {
      const parsedDate = new Date(`${postDate}T${postTime}:00`);
      if (!isNaN(parsedDate.getTime())) isoToSave = parsedDate.toISOString();
    } catch (e) { console.warn("Invalid date format, using now()"); }

    const { error: dbError } = await supabase.from('workouts').insert({
        user_id: user.id, 
        activity_type: activity, 
        duration_minutes: durationInt, 
        distance: formValues['Distance'] || '', 
        calories: calInt, 
        notes: notes, 
        image_url: publicUrl,
        created_at: isoToSave // <-- Overrides the default database timestamp
    });

    if (dbError) throw dbError;

    showAlert("Success! 🎉", "Your workout is live on the feed!");
    setFormValues({}); setNotes(''); setProofImage(null);

  } catch (error: any) {
    console.error("Post Error:", error);
    showAlert("Upload Failed", "Something went wrong saving your post.");
  }
};

  const activeFields = ACTIVITY_CONFIG[activity].fields;
  const currentBgImage = proofImage || ACTIVITY_CONFIG[activity].image;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
      
      <View style={styles.toggleContainer}>
        <TouchableOpacity style={[styles.toggleBtn, mode === 'custom' && styles.toggleActive]} onPress={() => setMode('custom')}>
            <Text style={[styles.toggleText, mode === 'custom' && styles.toggleTextActive]}>Create Custom</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.toggleBtn, mode === 'existing' && styles.toggleActive]} onPress={() => setMode('existing')}>
            <Text style={[styles.toggleText, mode === 'existing' && styles.toggleTextActive]}>Upload App Screenshot</Text>
        </TouchableOpacity>
      </View>

      {mode === 'custom' ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>1. Select Activity</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                {ACTIVITIES.map(act => (
                    <TouchableOpacity 
                        key={act} 
                        style={[styles.chip, activity === act && styles.chipActive]}
                        onPress={() => { setActivity(act); setFormValues({}); }}
                    >
                        <Text style={[styles.chipText, activity === act && styles.chipTextActive]}>{act}</Text>
                    </TouchableOpacity>
                ))}
            </ScrollView>

            <Text style={styles.sectionTitle}>2. Enter Details</Text>
            <View style={styles.dynamicGrid}>
                {activeFields.map(field => (
                    <View key={field} style={styles.inputWrapper}>
                        <Text style={styles.inputLabel}>{field}</Text>
                        <TextInput 
                            style={styles.input} 
                            placeholder={`0`} 
                            placeholderTextColor={colors.textMuted}
                            value={formValues[field] || ''}
                            onChangeText={(val) => handleInputChange(field, val)}
                        />
                    </View>
                ))}
            </View>

            <View style={{marginTop: 10}}>
                <Text style={styles.inputLabel}>Notes (Optional)</Text>
                <TextInput style={styles.input} placeholderTextColor={colors.textMuted} placeholder="How did it feel?" value={notes} onChangeText={setNotes} />
            </View>

            <TouchableOpacity style={styles.outlineButton} onPress={() => pickImage(false)}>
                <Text style={styles.outlineButtonText}>📷 Add Background Photo</Text>
            </TouchableOpacity>

            <Text style={[styles.sectionTitle, {marginTop: 30}]}>Preview</Text>
            <View ref={imageRef} style={styles.previewContainer} collapsable={false}>
                <Image source={{ uri: currentBgImage }} style={styles.previewImage} />
                
                <View style={styles.overlay}>
                    <View style={styles.overlayHeader}>
                        <Text style={styles.overlayActivity}>{activity.toUpperCase()}</Text>
                        <Text style={styles.overlayBrand}>SQUAD</Text>
                    </View>
                    
                    <View style={styles.statsWrapper}>
                        <View style={styles.statsGrid}>
                            {activeFields.map(field => (
                                <View key={field} style={styles.gridItem}>
                                    <Text style={styles.statTitle}>{field}</Text>
                                    <Text style={styles.statValue}>{formValues[field] || '--'}</Text>
                                </View>
                            ))}
                        </View>
                        {notes ? <Text style={styles.overlayNotes}>"{notes}"</Text> : null}
                    </View>
                </View>
            </View>
          </View>
      ) : (
          <View style={styles.section}>
              <Text style={styles.instructionText}>
                  Upload a screenshot from Strava, Apple Fitness, or Samsung Health. We'll post the image exactly as it is, and secretly pull your stats for the database!
              </Text>
              
              <TouchableOpacity style={styles.primaryButton} onPress={() => pickImage(true)}>
                  <Text style={styles.primaryButtonText}>{proofImage ? "Replace Screenshot" : "Upload Screenshot"}</Text>
              </TouchableOpacity>

              {proofImage && (
                  <Image source={{ uri: proofImage }} style={styles.uploadPreview} />
              )}

              {isExtracting && (
                  <View style={styles.extractionCard}>
                      <ActivityIndicator size="small" color={colors.primary} />
                      <Text style={styles.extractingText}>Reading stats for database...</Text>
                  </View>
              )}

              {!isExtracting && Object.keys(formValues).length > 0 && proofImage && (
                  <View style={styles.extractionCard}>
                      <Text style={styles.extractionCardTitle}>✅ Stats Extracted Successfully</Text>
                      <View style={styles.extractedGrid}>
                          <Text style={styles.extractedStat}>Activity: <Text style={{fontWeight: 'bold'}}>{activity}</Text></Text>
                          {Object.entries(formValues).map(([key, value]) => (
                              <Text key={key} style={styles.extractedStat}>{key}: <Text style={{fontWeight: 'bold'}}>{value}</Text></Text>
                          ))}
                      </View>
                  </View>
              )}
          </View>
      )}

      {/* NEW: Date & Time Overrides */}
      <Text style={[styles.sectionTitle, {marginTop: 10}]}>Date & Time</Text>
      <View style={styles.dynamicGrid}>
          <View style={styles.inputWrapper}>
              <Text style={styles.inputLabel}>Date (YYYY-MM-DD)</Text>
              <TextInput style={styles.input} value={postDate} onChangeText={setPostDate} placeholderTextColor={colors.textMuted} />
          </View>
          <View style={styles.inputWrapper}>
              <Text style={styles.inputLabel}>Time (HH:MM)</Text>
              <TextInput style={styles.input} value={postTime} onChangeText={setPostTime} placeholderTextColor={colors.textMuted} />
          </View>
      </View>

      <TouchableOpacity style={styles.postButton} onPress={handlePost}>
          <Text style={styles.postButtonText}>🚀 Post to Feed</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// --- DYNAMIC STYLES ---
const getStyles = (colors: any, theme: string) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: 15 },
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 15 },
  
  toggleContainer: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 12, padding: 4, marginBottom: 25 },
  toggleBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  toggleActive: { backgroundColor: colors.text, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 },
  toggleText: { fontSize: 14, fontWeight: '600', color: colors.textMuted },
  toggleTextActive: { color: colors.background },

  chipScroll: { paddingBottom: 10, marginBottom: 15 },
  chip: { paddingHorizontal: 20, paddingVertical: 10, backgroundColor: colors.surface, borderRadius: 20, marginRight: 10 },
  chipActive: { backgroundColor: colors.text },
  chipText: { fontSize: 14, fontWeight: '600', color: colors.text },
  chipTextActive: { color: colors.background },

  dynamicGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  inputWrapper: { width: '48%', marginBottom: 15 },
  inputLabel: { fontSize: 13, fontWeight: '600', color: colors.textMuted, marginBottom: 6, textTransform: 'uppercase' },
  input: { backgroundColor: colors.surface, color: colors.text, height: 48, borderRadius: 10, paddingHorizontal: 15, fontSize: 16, borderWidth: 1, borderColor: colors.border },

  outlineButton: { marginTop: 10, paddingVertical: 14, borderRadius: 10, borderWidth: 1.5, borderColor: colors.text, alignItems: 'center' },
  outlineButtonText: { fontSize: 15, fontWeight: '700', color: colors.text },
  primaryButton: { backgroundColor: colors.text, paddingVertical: 15, borderRadius: 10, alignItems: 'center', marginBottom: 20 },
  primaryButtonText: { color: colors.background, fontSize: 16, fontWeight: '700' },
  postButton: { backgroundColor: colors.primary, paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 20 },
  postButtonText: { color: '#fff', fontSize: 18, fontWeight: '800' },

  previewContainer: { width: '100%', aspectRatio: 1, borderRadius: 16, overflow: 'hidden', position: 'relative', backgroundColor: '#000' },
  previewImage: { width: '100%', height: '100%', resizeMode: 'cover' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', padding: 20, justifyContent: 'space-between' },
  overlayHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  overlayActivity: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: 2 },
  overlayBrand: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  statsWrapper: { width: '100%' },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  gridItem: { width: '48%', marginBottom: 15 },
  statTitle: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '600', textTransform: 'uppercase', marginBottom: 4 },
  statValue: { color: '#fff', fontSize: 28, fontWeight: '800' },
  overlayNotes: { color: '#fff', fontStyle: 'italic', marginTop: 10, fontSize: 15, borderLeftWidth: 3, borderColor: colors.primary, paddingLeft: 10 },

  instructionText: { fontSize: 15, color: colors.text, marginBottom: 20, lineHeight: 22 },
  uploadPreview: { width: '100%', aspectRatio: 1, borderRadius: 16, resizeMode: 'contain', backgroundColor: colors.surface, marginBottom: 20 },
  extractionCard: { backgroundColor: colors.surface, padding: 20, borderRadius: 12, borderWidth: 1, borderColor: colors.border, marginBottom: 20 },
  extractingText: { marginTop: 10, fontSize: 15, fontWeight: '600', color: colors.text, textAlign: 'center' },
  extractionCardTitle: { fontSize: 15, fontWeight: '700', color: colors.primary, marginBottom: 10 },
  extractedGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  extractedStat: { width: '50%', fontSize: 14, color: colors.text, marginBottom: 6 },
});