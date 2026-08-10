import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Global database instance for SovereignShield AI
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
