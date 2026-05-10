import React from 'react';
import {View, Text, TouchableOpacity, StyleSheet} from 'react-native';
import {T} from '../constants/tokens';

type QualityScore = {
  label: string;
  value: number; // 0-100
};

type Props = {
  scores: QualityScore[];
  overallScore: number;
  recaptureHint?: string;
  onRetake: () => void;
  onContinue: () => void;
};

const getBarColor = (value: number) => {
  if (value >= 80) return '#4CAF50';
  if (value >= 50) return T.amber;
  return T.red;
};

export const QualityCheck: React.FC<Props> = ({
  scores,
  overallScore,
  recaptureHint,
  onRetake,
  onContinue,
}) => {
  const hasWarning = overallScore < 70 || scores.some(s => s.value < 50);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>QUALITY CHECK</Text>

      {hasWarning && (
        <View style={styles.warningBox}>
          <Text style={styles.warningText}>
            {recaptureHint || 'Quality issues detected. Consider retaking the photo.'}
          </Text>
        </View>
      )}

      <View style={styles.scoreCard}>
        <View style={styles.overallRow}>
          <Text style={styles.overallLabel}>OVERALL</Text>
          <Text style={[styles.overallValue, {color: getBarColor(overallScore)}]}>
            {overallScore}/100
          </Text>
        </View>

        {scores.map((s, i) => (
          <View key={i} style={styles.scoreRow}>
            <Text style={styles.scoreLabel}>{s.label}</Text>
            <View style={styles.barTrack}>
              <View
                style={[
                  styles.barFill,
                  {width: `${Math.min(s.value, 100)}%`, backgroundColor: getBarColor(s.value)},
                ]}
              />
            </View>
            <Text style={[styles.scoreValue, {color: getBarColor(s.value)}]}>
              {s.value}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.retakeBtn} onPress={onRetake}>
          <Text style={styles.retakeBtnText}>RETAKE</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.continueBtn} onPress={onContinue}>
          <Text style={styles.continueBtnText}>
            {hasWarning ? 'CONTINUE ANYWAY' : 'CONTINUE'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: T.bgSurface,
    borderRadius: 12,
    padding: 16,
    marginVertical: 12,
    borderWidth: 1,
    borderColor: T.border,
  },
  title: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 3,
    marginBottom: 12,
  },
  warningBox: {
    backgroundColor: `${T.amber}22`,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: `${T.amber}44`,
  },
  warningText: {
    color: T.amber,
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 16,
  },
  scoreCard: {marginBottom: 12},
  overallRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.border,
  },
  overallLabel: {
    color: T.textSecondary,
    fontFamily: 'monospace',
    fontSize: 12,
    letterSpacing: 2,
    fontWeight: '700',
  },
  overallValue: {
    fontFamily: 'monospace',
    fontSize: 18,
    fontWeight: '700',
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  scoreLabel: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 1,
    width: 90,
  },
  barTrack: {
    flex: 1,
    height: 6,
    backgroundColor: '#333',
    borderRadius: 3,
    marginHorizontal: 8,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 3,
  },
  scoreValue: {
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '600',
    width: 28,
    textAlign: 'right',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  retakeBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: T.amber,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  retakeBtnText: {
    color: T.amber,
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: '600',
  },
  continueBtn: {
    flex: 1,
    backgroundColor: T.gold,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  continueBtnText: {
    color: T.bgApp,
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: '700',
  },
});
