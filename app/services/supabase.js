import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';

const publicConfig = Constants.expoConfig?.extra || {};
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || publicConfig.supabaseUrl;
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || publicConfig.supabasePublishableKey;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error('Missing Supabase public configuration. Copy app/.env.example to app/.env.');
}

// This client intentionally contains only the public, publishable key. All
// privileged SOS operations remain behind the Supabase Edge API; never add a
// service-role key to a mobile build.
export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

export const SUPABASE_FUNCTION_URL = `${supabaseUrl}/functions/v1/api`;
