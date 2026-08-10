import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { supabase, sendPushNotification } from './supabase'; 
import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { 
  View, Text, TextInput, Image, StyleSheet, Alert, 
  TouchableOpacity, ScrollView, ActivityIndicator 
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { captureRef } from 'react-native-view-shot';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from './ThemeContext'; // <-- THEME BRAIN
import { useFocusEffect } from '@react-navigation/native';
  // 1. Add this import at the top if not there
import { Platform } from 'react-native';
import { useCustomAlert } from './AlertContext';

// Default background images live in Supabase Storage at:
//   /default-backgrounds/{slug}-{n}.jpeg   (n = 1..8)
// Each activity has 8 portrait variants. Building the array from a slug keeps the
// config tiny and makes adding more variants a one-line change.
// Built off the same env var the client uses, rather than a second hardcoded
// copy of the project URL — one place to change, and nothing to leak.
const SUPABASE_BG_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/public/default-backgrounds`;
const IMAGES_PER_ACTIVITY = 8;

const ACTIVITY_SLUG: Record<string, string> = {
  'Gym': 'gym',
  'Swim': 'swim',
  'Padel': 'padel',
  'Badminton': 'badminton',
  'Table Tennis': 'tt',
  'Running': 'running',
  'Football (Competitive)': 'football-comp',
  'Football (Casual)': 'football-casual',
  'Stretching': 'stretch',
  'Cricket': 'cricket',
  'Volleyball': 'volley',
  'Beach Volleyball': 'beach-volley',
};

const buildImageList = (slug: string): string[] =>
  Array.from({ length: IMAGES_PER_ACTIVITY }, (_, i) =>
    `${SUPABASE_BG_URL}/${slug}-${i + 1}.jpeg`
  );

const ACTIVITY_IMAGES: Record<string, string[]> = Object.fromEntries(
  Object.entries(ACTIVITY_SLUG).map(([activity, slug]) => [activity, buildImageList(slug)])
);

const ACTIVITY_EMOJI: Record<string, string> = {
  'Gym': '🏋️',
  'Running': '🏃',
  'Swim': '🏊',
  'Padel': '🎾',
  'Badminton': '🏸',
  'Table Tennis': '🏓',
  'Football (Competitive)': '⚽',
  'Football (Casual)': '⚽',
  'Stretching': '🧘',
  'Cricket': '🏏',
  'Volleyball': '🏐',
  'Beach Volleyball': '🏖️',
};

const ACTIVITY_CONFIG: Record<string, { fields: string[] }> = {
  'Gym': { fields: ['Duration', 'Calories', 'Focus'] },
  'Swim': { fields: ['Distance', 'Duration', 'Avg Pace', 'SWOLF', 'Calories'] },
  'Padel': { fields: ['Duration', 'Calories', 'Match Score'] },
  'Badminton': { fields: ['Duration', 'Calories'] },
  'Table Tennis': { fields: ['Duration', 'Calories', 'Match Score'] },
  'Running': { fields: ['Distance', 'Duration', 'Avg Pace', 'Calories'] },
  'Football (Competitive)': { fields: ['Duration', 'Calories', 'Goals'] },
  'Football (Casual)': { fields: ['Duration', 'Calories', 'Goals'] },
  'Stretching': { fields: ['Duration'] },
  'Cricket': { fields: ['Duration', 'Calories', 'Runs', 'Wickets'] },
  'Volleyball': { fields: ['Duration', 'Calories', 'Match Score'] },
  'Beach Volleyball': { fields: ['Duration', 'Calories', 'Match Score'] },
};

// Which field is required per activity to compute points.
// Must match calculatePoints in Feed.tsx — Swim/Running use distance, everything else uses duration.
const REQUIRED_FIELD: Record<string, 'Distance' | 'Duration'> = {
  'Swim': 'Distance',
  'Running': 'Distance',
  'Gym': 'Duration',
  'Padel': 'Duration',
  'Badminton': 'Duration',
  'Table Tennis': 'Duration',
  'Football (Competitive)': 'Duration',
  'Football (Casual)': 'Duration',
  'Stretching': 'Duration',
  'Cricket': 'Duration',
  'Volleyball': 'Duration',
  'Beach Volleyball': 'Duration',
};

// Units shown next to each field. Distance unit varies by activity (m for swim, km for run).
// Duration is always in minutes (we use "min" everywhere to avoid confusion with meters).
const UNITS: Record<string, Record<string, string>> = {
  'Gym':                   { Duration: 'min', Calories: 'kcal' },
  'Swim':                  { Distance: 'm',   Duration: 'min', 'Avg Pace': '/100m', Calories: 'kcal' },
  'Padel':                 { Duration: 'min', Calories: 'kcal' },
  'Badminton':             { Duration: 'min', Calories: 'kcal' },
  'Table Tennis':          { Duration: 'min', Calories: 'kcal' },
  'Running':               { Distance: 'km',  Duration: 'min', 'Avg Pace': '/km', Calories: 'kcal' },
  'Football (Competitive)':{ Duration: 'min', Calories: 'kcal' },
  'Football (Casual)':     { Duration: 'min', Calories: 'kcal' },
  'Stretching':            { Duration: 'min' },
  'Cricket':               { Duration: 'min', Calories: 'kcal' },
  'Volleyball':            { Duration: 'min', Calories: 'kcal' },
  'Beach Volleyball':      { Duration: 'min', Calories: 'kcal' },
};

// Helper: get unit for a field in the current activity, or empty string if none.
const unitFor = (activity: string, field: string) => UNITS[activity]?.[field] || '';

// Helper: convert a string of any length to a base64 string in the browser.
// Equivalent of decode(base64) on native — produces an ArrayBuffer ready for upload.
const dataUrlToBase64 = (dataUrl: string) => {
  // dataUrl looks like "data:image/png;base64,iVBORw0..."
  return dataUrl.split(',')[1] || '';
};

// Web-only compositor. Loads the background, draws the overlay (header, stats grid,
// notes) onto an off-screen <canvas>, returns a base64 PNG. Replaces what
// captureRef does on native.
async function composeOnWeb(opts: {
  bgUrl: string;
  activity: string;
  fields: string[];
  values: Record<string, string>;
  notes: string;
  unitFor: (activity: string, field: string) => string;
  primaryColor: string;
}): Promise<string> {
  const { bgUrl, activity, fields, values, notes, unitFor: getUnit, primaryColor } = opts;

  // Load the background image with CORS enabled (Unsplash supports it).
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new window.Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Failed to load background image'));
    i.src = bgUrl;
  });

  // Render at 1080x1920 — story aspect ratio, high resolution for crisp display.
  const W = 1080;
  const H = 1920;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D context');

  // Draw the background image with object-fit: cover behavior
  const ratio = Math.max(W / img.width, H / img.height);
  const drawW = img.width * ratio;
  const drawH = img.height * ratio;
  const dx = (W - drawW) / 2;
  const dy = (H - drawH) / 2;
  ctx.drawImage(img, dx, dy, drawW, drawH);

  // Dark overlay tint (matches the rgba(0,0,0,0.4) in the on-screen preview)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  ctx.fillRect(0, 0, W, H);

  // Header: activity name (top-left) + SQUAD brand (top-right)
  const PADDING = 70;
  ctx.fillStyle = '#fff';
  ctx.font = '800 56px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(activity.toUpperCase(), PADDING, PADDING);

  ctx.fillStyle = primaryColor;
  ctx.font = '800 48px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('SQUAD', W - PADDING, PADDING);

  // Stats grid in the lower portion. Only fields with values, just like the live overlay.
  const filledFields = fields.filter(f => (values[f] || '').trim() !== '');

  // 2-column grid laid out from the bottom up.
  const COL_W = (W - PADDING * 2) / 2;
  const ROW_H = 170;
  const gridStartY = H - PADDING - (notes ? 220 : 80) - Math.ceil(filledFields.length / 2) * ROW_H;

  ctx.textAlign = 'left';
  filledFields.forEach((field, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const x = PADDING + col * COL_W;
    const y = gridStartY + row * ROW_H;

    const value = values[field].trim();
    const unit = getUnit(activity, field);
    const displayValue = unit && !value.toLowerCase().includes(unit.toLowerCase())
      ? `${value} ${unit}`
      : value;

    // Title (small, semi-transparent white, uppercase)
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '600 32px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(field.toUpperCase(), x, y);

    // Value (large, white, bold)
    ctx.fillStyle = '#fff';
    ctx.font = '800 76px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(displayValue, x, y + 48);
  });

  // Notes block (italic, with a colored left border)
  if (notes) {
    const notesY = H - PADDING - 100;
    const borderX = PADDING;
    const textX = PADDING + 24;
    ctx.fillStyle = primaryColor;
    ctx.fillRect(borderX, notesY, 8, 70);

    ctx.fillStyle = '#fff';
    ctx.font = 'italic 36px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    // Truncate notes if absurdly long; canvas doesn't word-wrap.
    const maxChars = 60;
    const displayNotes = notes.length > maxChars ? notes.slice(0, maxChars - 1) + '…' : notes;
    ctx.fillText(`"${displayNotes}"`, textX, notesY + 18);
  }

  return canvas.toDataURL('image/png');
}



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
  const [isImageReady, setIsImageReady] = useState(false);
  const [activitySearch, setActivitySearch] = useState('');
  const imageRef = useRef<View>(null);

  // Random background per activity. Re-picked every time the screen comes into focus,
  // so the user gets a fresh visual every time they open the create-post tab.
  const pickRandomImages = (): Record<string, string> => {
    const result: Record<string, string> = {};
    for (const act of Object.keys(ACTIVITY_IMAGES)) {
      const pool = ACTIVITY_IMAGES[act];
      result[act] = pool[Math.floor(Math.random() * pool.length)];
    }
    return result;
  };
  const [randomImages, setRandomImages] = useState<Record<string, string>>(pickRandomImages);

  useFocusEffect(
    useCallback(() => {
      setRandomImages(pickRandomImages());
      setIsImageReady(false);
    }, [])
  );

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
      mediaTypes: ['images'],
      allowsEditing: true, aspect: [1, 1], quality: 0.8, base64: true,
    });

    if (!imageResult.canceled) {
      setIsImageReady(false);
      setProofImage(imageResult.assets[0].uri);
      setFormValues({});
      
      if (isScreenshot && imageResult.assets[0].base64) {
          extractDataWithGemini(imageResult.assets[0].base64);
      }
    }
  };

  const extractDataWithGemini = async (base64Image: string) => {
      setIsExtracting(true);
      const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
      if (!GEMINI_API_KEY) {
          showAlert("Configuration Error", "Gemini API key is not set. Add EXPO_PUBLIC_GEMINI_API_KEY to your env.");
          setIsExtracting(false);
          return;
      }
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

    // For manual posts, enforce that the field needed to calculate points is filled in.
    // The screenshot-upload mode is exempt — Gemini extracts those values from the image.
    if (mode === 'custom') {
      const requiredField = REQUIRED_FIELD[activity];
      const rawValue = (formValues[requiredField] || '').trim();
      const numericValue = parseFloat(rawValue.replace(/[^0-9.]/g, ''));
      if (!rawValue || isNaN(numericValue) || numericValue <= 0) {
        return showAlert(
          "Missing info",
          `${activity} posts need a valid ${requiredField.toLowerCase()} so we can calculate points.`
        );
      }
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return showAlert("Error", "You must be logged in.");

    let finalImageUri = proofImage || randomImages[activity];
    // On web, the canvas compositor produces base64 directly — skips fetch+FileReader.
    let webComposedBase64: string | null = null;

    // For custom (non-screenshot) posts, bake the overlay into the image.
    if (mode === 'custom') {
      if (Platform.OS === 'web') {
        // Web path: use HTML5 canvas to composite background + overlay text.
        // captureRef doesn't work on web (findNodeHandle isn't supported), so we
        // do the drawing manually with the same look as the on-screen preview.
        try {
          const dataUrl = await composeOnWeb({
            bgUrl: finalImageUri,
            activity,
            fields: activeFields,
            values: formValues,
            notes,
            unitFor,
            primaryColor: colors.primary,
          });
          webComposedBase64 = dataUrlToBase64(dataUrl);
          if (!webComposedBase64) throw new Error('Canvas produced empty output');
        } catch (composeErr: any) {
          console.error('Web compose failed:', composeErr);
          return showAlert(
            "Couldn't compose post",
            composeErr?.message || "The overlay couldn't be rendered. Try again."
          );
        }
      } else {
        // Native path: capture the rendered preview view to a PNG.
        if (!imageRef.current) {
          return showAlert("Render error", "Preview isn't ready yet. Try again in a moment.");
        }
        if (!isImageReady) {
          return showAlert("Hold on", "The background image is still loading. Try again in a second.");
        }
        try {
          await new Promise(resolve => setTimeout(resolve, 100));
          const captured = await captureRef(imageRef, {
            format: 'png',
            quality: 1,
            result: 'tmpfile',
          });
          if (!captured) throw new Error('captureRef returned empty');
          finalImageUri = captured;
        } catch (captureErr: any) {
          console.error('captureRef failed:', captureErr);
          return showAlert(
            "Couldn't capture preview",
            captureErr?.message || "The overlay couldn't be rendered. Try again."
          );
        }
      }
    }

    let base64: string = '';

    if (webComposedBase64) {
      // We already have it from the canvas compositor — no need to fetch.
      base64 = webComposedBase64;
    } else if (Platform.OS === 'web') {
      // Screenshot-upload mode on web — fetch the image (which is a blob: URL from ImagePicker)
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
      // Native: read the captured/picked image file directly
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

    // Persist distance with its unit (e.g. "5 km", "1500 m") so the leaderboard / chat /
    // profile pages display it consistently. calculatePoints strips non-digits so this
    // does not affect points scoring.
    const rawDistance = (formValues['Distance'] || '').trim();
    const distanceUnit = unitFor(activity, 'Distance');
    const distanceToSave = rawDistance && distanceUnit && !rawDistance.toLowerCase().includes(distanceUnit)
      ? `${rawDistance} ${distanceUnit}`
      : rawDistance;

    const { error: dbError } = await supabase.from('workouts').insert({
        user_id: user.id, 
        activity_type: activity, 
        duration_minutes: durationInt, 
        distance: distanceToSave, 
        calories: calInt, 
        notes: notes, 
        image_url: publicUrl,
        created_at: isoToSave
    });

    if (dbError) throw dbError;

    showAlert("Success! 🎉", "Your workout is live on the feed!");
    setFormValues({}); setNotes(''); setProofImage(null);

  } catch (error: any) {
    console.error("Post Error:", error);
    const detail = error?.message || error?.error_description || JSON.stringify(error)?.slice(0, 200) || 'unknown error';
    showAlert("Upload Failed", detail);
  }
};

  const activeFields = ACTIVITY_CONFIG[activity].fields;
  const currentBgImage = proofImage || randomImages[activity];

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

            {/* Search filter — only filters when typed in */}
            <View style={styles.activitySearchWrapper}>
              <Ionicons name="search" size={18} color={colors.textMuted} style={{ marginRight: 8 }} />
              <TextInput
                style={styles.activitySearchInput}
                placeholder="Search activities..."
                placeholderTextColor={colors.textMuted}
                value={activitySearch}
                onChangeText={setActivitySearch}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {activitySearch.length > 0 && (
                <TouchableOpacity onPress={() => setActivitySearch('')}>
                  <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.activityGrid}>
              {ACTIVITIES
                .filter(act => activitySearch.trim() === '' || act.toLowerCase().includes(activitySearch.trim().toLowerCase()))
                .map(act => {
                  const isActive = activity === act;
                  return (
                    <TouchableOpacity
                      key={act}
                      style={[styles.activityTile, isActive && styles.activityTileActive]}
                      onPress={() => { setActivity(act); setFormValues({}); setIsImageReady(false); setActivitySearch(''); }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.activityEmoji}>{ACTIVITY_EMOJI[act] || '🏃'}</Text>
                      <Text style={[styles.activityTileLabel, isActive && styles.activityTileLabelActive]} numberOfLines={2}>
                        {act}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              {ACTIVITIES.filter(act => act.toLowerCase().includes(activitySearch.trim().toLowerCase())).length === 0 && (
                <Text style={styles.activityNoResults}>No activities match "{activitySearch}"</Text>
              )}
            </View>

            <Text style={styles.sectionTitle}>2. Enter Details</Text>
            <View style={styles.dynamicGrid}>
                {activeFields.map(field => {
                    const isRequired = field === REQUIRED_FIELD[activity];
                    const unit = unitFor(activity, field);
                    return (
                        <View key={field} style={styles.inputWrapper}>
                            <Text style={styles.inputLabel}>
                                {field}{unit ? ` (${unit})` : ''}{isRequired ? <Text style={{ color: colors.primary }}> *</Text> : null}
                            </Text>
                            <TextInput
                                style={styles.input}
                                placeholder={isRequired ? 'Required' : 'Optional'}
                                placeholderTextColor={colors.textMuted}
                                value={formValues[field] || ''}
                                onChangeText={(val) => handleInputChange(field, val)}
                            />
                        </View>
                    );
                })}
            </View>

            <View style={{marginTop: 10}}>
                <Text style={styles.inputLabel}>Notes (Optional)</Text>
                <TextInput style={styles.input} placeholderTextColor={colors.textMuted} placeholder="How did it feel?" value={notes} onChangeText={setNotes} />
            </View>

            <TouchableOpacity style={styles.outlineButton} onPress={() => pickImage(false)}>
                <Text style={styles.outlineButtonText}>📷 Add Background Photo</Text>
            </TouchableOpacity>

            <Text style={[styles.sectionTitle, {marginTop: 30}]}>Preview</Text>
            <View style={styles.previewOuter}>
              <View ref={imageRef} style={styles.previewContainer} collapsable={false}>
                <Image
                  source={{ uri: currentBgImage }}
                  style={styles.previewImage}
                  onLoad={() => setIsImageReady(true)}
                  onError={() => setIsImageReady(false)}
                />
                
                <View style={styles.overlay}>
                    <View style={styles.overlayHeader}>
                        <Text style={styles.overlayActivity}>{activity.toUpperCase()}</Text>
                        <Text style={styles.overlayBrand}>SQUAD</Text>
                    </View>
                    
                    <View style={styles.statsWrapper}>
                        <View style={styles.statsGrid}>
                            {activeFields
                              .filter(field => (formValues[field] || '').trim() !== '')
                              .map(field => {
                                const value = formValues[field].trim();
                                const unit = unitFor(activity, field);
                                // If the user typed the unit themselves (e.g. "5 km"), don't double it up.
                                const displayValue = unit && !value.toLowerCase().includes(unit.toLowerCase())
                                  ? `${value} ${unit}`
                                  : value;
                                return (
                                  <View key={field} style={styles.gridItem}>
                                      <Text style={styles.statTitle}>{field}</Text>
                                      <Text style={styles.statValue}>{displayValue}</Text>
                                  </View>
                                );
                            })}
                        </View>
                        {notes ? <Text style={styles.overlayNotes}>"{notes}"</Text> : null}
                    </View>
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

  // Activity picker (search + grid)
  activitySearchWrapper: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12, paddingHorizontal: 14, height: 44,
    marginBottom: 12,
  },
  activitySearchInput: { flex: 1, fontSize: 15, color: colors.text },
  activityGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start', marginBottom: 15, marginHorizontal: -4 },
  activityTile: {
    width: '31.333%',
    aspectRatio: 1,
    margin: '1%',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  activityTileActive: {
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  activityEmoji: { fontSize: 30, marginBottom: 6 },
  activityTileLabel: { fontSize: 11, fontWeight: '600', color: colors.text, textAlign: 'center', lineHeight: 14 },
  activityTileLabelActive: { color: colors.primary, fontWeight: '800' },
  activityNoResults: { width: '100%', textAlign: 'center', color: colors.textMuted, paddingVertical: 30, fontSize: 14 },

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

  previewOuter: { width: '100%', aspectRatio: 9 / 16, borderRadius: 16, overflow: 'hidden', backgroundColor: '#000' },
  previewContainer: { width: '100%', height: '100%', position: 'relative', backgroundColor: '#000' },
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