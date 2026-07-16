import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

// 環境変数が未設定でもアプリ自体はクラッシュさせず、呼び出し側で
// エラーメッセージを出せるように null を返すだけにしておく。
export const supabase = isSupabaseConfigured ? createClient(supabaseUrl, supabaseKey) : null;
