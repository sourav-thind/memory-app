import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { supabase } from '../lib/supabase';

export default function AuthScreen() {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!email || !password) {
      Alert.alert('Missing details', 'Please enter your email and password.');
      return;
    }

    setSubmitting(true);

    const { error } =
      mode === 'login'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });

    setSubmitting(false);

    if (error) {
      Alert.alert(mode === 'login' ? 'Sign in failed' : 'Sign up failed', error.message);
      return;
    }

    if (mode === 'signup') {
      // Supabase may require email confirmation; the parent App picks up the
      // session via onAuthStateChange when it becomes available.
      Alert.alert(
        'Account created',
        'Please check your email to confirm your account (if required), then sign in.'
      );
      setMode('login');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Snapchat Memories</Text>
      <Text style={styles.subtitle}>Your Stories, preserved forever.</Text>

      <View style={styles.toggle}>
        <TouchableOpacity
          style={[styles.toggleButton, mode === 'login' && styles.toggleActive]}
          onPress={() => setMode('login')}
        >
          <Text style={[styles.toggleText, mode === 'login' && styles.toggleTextActive]}>
            Login
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleButton, mode === 'signup' && styles.toggleActive]}
          onPress={() => setMode('signup')}
        >
          <Text style={[styles.toggleText, mode === 'signup' && styles.toggleTextActive]}>
            Sign Up
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.form}>
        <TextInput
          style={styles.input}
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          placeholderTextColor="#999"
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          placeholderTextColor="#999"
        />

        <TouchableOpacity style={styles.button} onPress={handleSubmit} disabled={submitting}>
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>{mode === 'login' ? 'Sign In' : 'Create Account'}</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 32,
  },
  toggle: {
    flexDirection: 'row',
    backgroundColor: '#f0f0f0',
    borderRadius: 12,
    padding: 4,
    marginBottom: 20,
    width: '100%',
    maxWidth: 380,
  },
  toggleButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 9,
    alignItems: 'center',
  },
  toggleActive: {
    backgroundColor: '#111',
  },
  toggleText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#555',
  },
  toggleTextActive: {
    color: '#fff',
  },
  form: {
    width: '100%',
    maxWidth: 380,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    marginBottom: 12,
    color: '#111',
  },
  button: {
    backgroundColor: '#111',
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
});
