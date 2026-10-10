import { Tabs } from 'expo-router';
import AgentationToolbar from '../../components/AgentationToolbar';
import { useAuth } from '../../auth/context';

export default function TabsLayout() {
  const { profile } = useAuth();
  const owner = profile?.role === 'owner';
  return (
    <>
      <Tabs
        screenOptions={{
          headerTitleAlign: 'center',
          headerStyle: { backgroundColor: '#F6F4EF' },
          tabBarStyle: { height: 62, paddingBottom: 8, paddingTop: 6 },
          tabBarActiveTintColor: '#141414',
        }}
      >
        <Tabs.Screen name="pos" options={{ title: 'POS' }} />
        <Tabs.Screen name="inventory" options={{ title: 'Stock', href: owner ? undefined : null }} />
        <Tabs.Screen name="dashboard" options={{ title: 'Sales', href: owner ? undefined : null }} />
        <Tabs.Screen name="settings" options={{ title: 'More', href: owner ? undefined : null }} />
      </Tabs>
      <AgentationToolbar />
    </>
  );
}
