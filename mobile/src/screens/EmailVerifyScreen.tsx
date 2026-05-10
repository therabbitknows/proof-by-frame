import React from 'react';
import {View, Text, StyleSheet} from 'react-native';
import {T} from '../constants/tokens';

export const EmailVerifyScreen: React.FC = () => (
  <View style={styles.container}>
    <Text style={styles.text}>EMAIL VERIFY</Text>
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: T.bgApp,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: T.textMuted,
    fontFamily: 'monospace',
    letterSpacing: 3,
    fontSize: 12,
  },
});
