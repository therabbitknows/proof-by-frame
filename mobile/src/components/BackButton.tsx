import React from 'react';
import {StyleSheet, Text, TouchableOpacity} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {T} from '../constants/tokens';

type Props = {
  onPress?: () => void;
  label?: string;
};

/**
 * Standard PROOF back button. Prior implementations were text-only at
 * fontSize 11 with no hitSlop — tap target ~60x15px, well below the
 * 44pt accessibility minimum and hard to hit near the screen edge.
 *
 * This component enforces:
 *   - 44pt minimum touch height + 88pt minimum width
 *   - 16pt hitSlop on every side (effective tap area ~120x76pt)
 *   - 20pt padding from the screen edge when placed inside a header
 *     with `paddingHorizontal: 20`
 *   - gold arrow + BACK label in mono, matching the brand tokens
 */
export const BackButton: React.FC<Props> = ({onPress, label = 'BACK'}) => {
  const navigation = useNavigation<any>();
  return (
    <TouchableOpacity
      onPress={onPress ?? (() => navigation.goBack())}
      style={styles.button}
      hitSlop={{top: 16, bottom: 16, left: 16, right: 16}}
      accessibilityRole="button"
      accessibilityLabel="Go back"
      activeOpacity={0.6}>
      <Text style={styles.arrow}>←</Text>
      <Text style={styles.label}>{label}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    minHeight: 44,
    minWidth: 88,
    gap: 8,
  },
  arrow: {
    color: T.gold,
    fontSize: 22,
    lineHeight: 22,
    fontWeight: '600',
  },
  label: {
    color: T.gold,
    fontFamily: 'monospace',
    fontSize: 13,
    letterSpacing: 2,
    fontWeight: '700',
  },
});
