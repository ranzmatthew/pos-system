import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { C } from '../components/ui';
import { useAuth } from '../auth/context';

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await signIn(email, password);
    } catch (e: any) {
      setError(e?.message ?? 'Could not sign in. Check your connection and credentials.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={s.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Text style={s.logo}>FREEREN POS</Text>
      <Text style={s.sub}>Sign in to your store account</Text>
      <View style={s.card}>
        <Text style={s.label}>Email</Text>
        <TextInput
          style={s.input}
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          editable={!busy}
        />
        <Text style={s.label}>Password</Text>
        <TextInput
          style={s.input}
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          secureTextEntry
          autoComplete="password"
          editable={!busy}
          onSubmitEditing={submit}
        />
        {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
        <Pressable style={[s.submit, busy && s.disabled]} onPress={submit} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.submitText}>Sign in</Text>}
        </Pressable>
        <Text style={s.hint}>Ask the store owner to create your account.</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg, padding: 20, justifyContent: 'center', gap: 6 },
  logo: { fontSize: 28, fontWeight: '900', textAlign: 'center', color: C.dark },
  sub: { textAlign: 'center', color: C.muted, marginBottom: 14 },
  card: { backgroundColor: C.card, borderRadius: 16, padding: 16, gap: 10, borderWidth: 1, borderColor: C.line },
  label: { fontWeight: '700' },
  input: { borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 12, fontSize: 16, backgroundColor: '#fff' },
  submit: { backgroundColor: C.dark, padding: 14, borderRadius: 12, minHeight: 48, justifyContent: 'center' },
  submitText: { color: '#fff', textAlign: 'center', fontWeight: '800' },
  disabled: { opacity: 0.65 },
  error: { color: C.red, fontSize: 13 },
  hint: { color: C.muted, fontSize: 12, textAlign: 'center', marginTop: 4 },
});
