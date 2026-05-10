import React, {useState} from 'react';
import {
  View,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import {useNavigation, useRoute, RouteProp} from '@react-navigation/native';
import type {RootStackParamList} from '../navigation/RootNavigator';
import {T} from '../constants/tokens';
import {BackButton} from '../components/BackButton';

type Nav = any;

export const ReviewScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<RootStackParamList, 'Review'>>();
  const {frontUri, backUri, condition, baselines} = route.params;
  const [cardLabel, setCardLabel] = useState('');

  const rows: {label: string; value: string}[] = [
    {label: 'Corners', value: condition.corners},
    ...(condition.edges ? [{label: 'Edges', value: condition.edges}] : []),
    ...(condition.surface ? [{label: 'Surface', value: condition.surface}] : []),
    ...(condition.centering ? [{label: 'Centering', value: condition.centering}] : []),
    ...(condition.other ? [{label: 'Other', value: condition.other}] : []),
  ];

  const baselineRows: {label: string; value: string}[] = baselines
    ? [
        ...(baselines.company ? [{label: 'Company', value: baselines.company}] : []),
        ...(baselines.grade ? [{label: 'Grade', value: baselines.grade}] : []),
        ...(baselines.certNumber ? [{label: 'Cert #', value: baselines.certNumber}] : []),
      ]
    : [];

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <BackButton />

        <Text style={styles.title}>REVIEW SUBMISSION</Text>
        <Text style={styles.subtitle}>Confirm everything looks correct.</Text>

        {/* Side-by-side images */}
        <View style={styles.imageRow}>
          <View style={styles.imageCol}>
            <Text style={styles.imageLabel}>FRONT</Text>
            <Image source={{uri: frontUri}} style={styles.thumb} resizeMode="cover" />
          </View>
          <View style={styles.imageCol}>
            <Text style={styles.imageLabel}>BACK</Text>
            <Image source={{uri: backUri}} style={styles.thumb} resizeMode="cover" />
          </View>
        </View>

        {/* Condition summary */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>CONDITION NOTES</Text>
          {rows.map((r, i) => (
            <View key={i} style={styles.row}>
              <Text style={styles.rowKey}>{r.label}</Text>
              <Text style={styles.rowValue}>{r.value}</Text>
            </View>
          ))}
        </View>

        {/* Baseline grades */}
        {baselineRows.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>BASELINE GRADES</Text>
            {baselineRows.map((r, i) => (
              <View key={i} style={styles.row}>
                <Text style={styles.rowKey}>{r.label}</Text>
                <Text style={styles.rowValue}>{r.value}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardLabel}>CARD NAME (OPTIONAL)</Text>
          <TextInput
            style={styles.labelInput}
            value={cardLabel}
            onChangeText={setCardLabel}
            placeholder="e.g. 2018 Topps Allen & Ginter Mike Trout"
            placeholderTextColor={T.textMuted}
            autoCapitalize="words"
            autoCorrect={false}
            maxLength={120}
            returnKeyType="done"
          />
          <Text style={styles.labelHint}>
            Leave blank to let OCR detect it from the image. Used as a fallback
            on the slab if OCR can&apos;t read the card.
          </Text>
        </View>

        <TouchableOpacity
          style={styles.continueBtn}
          onPress={() =>
            navigation.navigate('Submission', {
              frontUri,
              backUri,
              condition,
              baselines,
              cardLabel: cardLabel.trim() || undefined,
            })
          }>
          <Text style={styles.continueBtnText}>CONTINUE TO FINAL REVIEW</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.editBtn}
          onPress={() => navigation.goBack()}>
          <Text style={styles.editBtnText}>EDIT CONDITION</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: T.bgApp},
  scroll: {padding: 20, paddingTop: 52, paddingBottom: 40},
  title: {
    color: T.gold,
    fontFamily: 'monospace',
    fontSize: 14,
    letterSpacing: 3,
    marginBottom: 8,
  },
  subtitle: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 1,
    marginBottom: 24,
  },
  imageRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  imageCol: {flex: 1},
  imageLabel: {
    color: T.textSecondary,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 2,
    marginBottom: 8,
  },
  thumb: {
    width: '100%',
    aspectRatio: 252 / 360,
    borderRadius: 8,
    backgroundColor: '#222',
    borderWidth: 1,
    borderColor: T.border,
  },
  card: {
    backgroundColor: T.bgSurface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: T.border,
  },
  cardLabel: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 3,
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.border,
  },
  rowKey: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 1,
    flex: 1,
  },
  rowValue: {
    color: T.textPrimary,
    fontFamily: 'monospace',
    fontSize: 11,
    flex: 2,
    textAlign: 'right',
  },
  labelInput: {
    backgroundColor: T.bgApp,
    color: T.textPrimary,
    fontFamily: 'monospace',
    fontSize: 13,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: T.border,
    marginBottom: 8,
  },
  labelHint: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 9,
    letterSpacing: 1,
    lineHeight: 14,
  },
  continueBtn: {
    backgroundColor: T.gold,
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 12,
  },
  continueBtnText: {
    color: T.bgApp,
    fontFamily: 'monospace',
    fontSize: 13,
    letterSpacing: 3,
    fontWeight: '700',
  },
  editBtn: {
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  editBtnText: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 2,
  },
});
