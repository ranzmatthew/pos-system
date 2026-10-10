import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack, usePathname, useRouter } from 'expo-router';
import { AuthProvider, useAuth } from '../auth/context';
import { canAccessRoute } from '../auth/roles';
import { C } from '../components/ui';

function SessionRoutes() {
  const { profile, ready } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    const login = pathname === '/login';
    if (!profile && !login) router.replace('/login');
    else if (profile && (login || pathname === '/')) {
      router.replace(profile.role === 'owner' ? '/dashboard' : '/pos');
    } else if (profile && !canAccessRoute(profile.role, pathname)) {
      router.replace('/pos');
    }
  }, [profile, pathname, ready, router]);

  if (!ready) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg }}>
      <ActivityIndicator color={C.dark} />
    </View>;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="login" />
      <Stack.Screen name="index" />
    </Stack>
  );
}

export default function RootLayout() {
  return <AuthProvider><SessionRoutes /></AuthProvider>;
}
