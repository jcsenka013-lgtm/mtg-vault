import { create } from "zustand";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

interface AuthStore {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
  setSession: (session: Session | null) => void;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthStore>((set) => ({
  session: null,
  user: null,
  isLoading: true,
  setSession: (session) =>
    set({
      session,
      user: session?.user ?? null,
      isLoading: false,
    }),
  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null, user: null });
  },
}));

// Initialize session listener
supabase.auth.onAuthStateChange((_event, session) => {
  useAuthStore.getState().setSession(session);
});
