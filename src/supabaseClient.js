import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://mzzwzaexmpbfisvptaab.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16end6YWV4bXBiZmlzdnB0YWFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwMjIwNDcsImV4cCI6MjA5NjU5ODA0N30.ksus6Qri7zkPEqwjkYuq39DzL2v-gexP06IMSKDEWck'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)