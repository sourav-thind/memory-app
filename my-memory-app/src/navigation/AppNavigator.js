import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import MemoriesScreen from '../screens/MemoriesScreen';
import StoryViewer from '../components/StoryViewer';

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  return (
    <NavigationContainer
      fallback={
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color="#111" />
        </View>
      }
    >
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen
          name="Memories"
          component={MemoriesScreen}
          options={{
            headerShown: true,
            title: 'Memories',
            headerStyle: { backgroundColor: '#fff' },
            headerTitleStyle: { color: '#111', fontWeight: '700' },
          }}
        />
        <Stack.Screen
          name="StoryViewer"
          component={StoryViewer}
          options={{
            presentation: 'fullScreenModal',
            animation: 'fade',
            headerShown: false,
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}