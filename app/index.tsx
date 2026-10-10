import { Redirect } from 'expo-router';
import { useAuth } from '../auth/context';

export default function IndexRoute() {
  const { profile, ready } = useAuth();
  if (!ready) return null;
  return <Redirect href={profile?.role === 'owner' ? '/dashboard' : profile ? '/pos' : '/login'} />;
}
