import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import {useNavigation, useRoute, RouteProp} from '@react-navigation/native';
import type {RootStackParamList, ConditionData, BaselineData} from '../navigation/RootNavigator';
import {T} from '../constants/tokens';
import {BackButton} from '../components/BackButton';
import {verifyPsaCert, type PsaStatus} from '../services/psa';

type Nav = any;

const COMPANIES = ['PSA', 'BGS', 'CGC', 'TAG', 'Other'] as const;
const PSA_TIERS = ['8', '9', '10'] as const;

type PsaLookupState =
  | {phase: 'idle'}
  | {phase: 'loading'}
  | {phase: 'done'; status: PsaStatus; grade: string | null; gradeValue: number | null; cardName: string | null; message: string | null};

export const ConditionScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<RootStackParamList, 'Condition'>>();
  const {frontUri, backUri} = route.params;

  // Condition fields
  const [corners, setCorners] = useState('');
  const [edges, setEdges] = useState('');
  const [surface, setSurface] = useState('');
  const [centering, setCentering] = useState('');
  const [other, setOther] = useState('');

  // Baseline fields
  const [company, setCompany] = useState<string>('');
  const [grade, setGrade] = useState<string>('');
  const [certNumber, setCertNumber] = useState<string>('');

  // PSA verification state
  const [psa, setPsa] = useState<PsaLookupState>({phase: 'idle'});
  const [override, setOverride] = useState<boolean>(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isPsa = company === 'PSA';
  const verifiedMatch = psa.phase === 'done' && psa.status === 'psa_verified_match';
  const verifiedMismatch = psa.phase === 'done' && psa.status === 'psa_verified_mismatch';
  const psaFieldsLocked = verifiedMatch || (verifiedMismatch && !override);

  // Fire PSA lookup on cert+company settle, debounced. Only when company=PSA.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!isPsa || !certNumber.trim()) {
      setPsa({phase: 'idle'});
      setOverride(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setPsa({phase: 'loading'});
      setOverride(false);
      const expected = PSA_TIERS.includes(grade.trim() as any)
        ? parseInt(grade.trim(), 10)
        : undefined;
      const res = await verifyPsaCert(certNumber.trim(), expected);
      setPsa({
        phase: 'done',
        status: res.status,
        grade: res.grade,
        gradeValue: res.grade_value,
        cardName: res.card_name,
        message: res.message,
      });
      // Auto-fill grade from server-authoritative record on ANY successful
      // lookup (match or mismatch). The UI surfaces the mismatch warning
      // separately; the PSA record remains preserved regardless.
      if (res.grade_value != null) {
        setGrade(String(res.grade_value));
      }
    }, 600);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [certNumber, company, grade, isPsa]);

  const canContinue =
    corners.trim().length > 0 && (!verifiedMismatch || override);

  const handleContinue = () => {
    const condition: ConditionData = {
      corners: corners.trim(),
      edges: edges.trim() || undefined,
      surface: surface.trim() || undefined,
      centering: centering.trim() || undefined,
      other: other.trim() || undefined,
    };
    // Record the verification status alongside the baseline so the submission
    // flow + backend can surface "PSA-verified" vs "self-declared" vs
    // "mismatch-overridden" downstream.
    const verificationStatus: BaselineData['verificationStatus'] =
      psa.phase === 'done'
        ? verifiedMatch
          ? 'psa_verified_match'
          : verifiedMismatch
            ? 'psa_verified_mismatch_override'
            : psa.status === 'psa_lookup_timeout'
              ? 'psa_lookup_timeout'
              : 'psa_lookup_failed'
        : 'unverified_self_declared';

    const baselines: BaselineData | undefined =
      company || grade || certNumber
        ? {
            company: company || undefined,
            grade: grade.trim() || undefined,
            certNumber: certNumber.trim() || undefined,
            verificationStatus,
            psaGradeValue: psa.phase === 'done' ? psa.gradeValue ?? undefined : undefined,
            psaCardName: psa.phase === 'done' ? psa.cardName ?? undefined : undefined,
          }
        : undefined;

    navigation.navigate('Review', {frontUri, backUri, condition, baselines});
  };

  const onSelectCompany = useCallback(
    (c: string) => {
      setCompany(prev => (prev === c ? '' : c));
      // Clearing the company drops any prior PSA state.
      if (company === c) {
        setGrade('');
        setCertNumber('');
        setPsa({phase: 'idle'});
        setOverride(false);
      }
    },
    [company],
  );

  const handleGradeSelect = (tier: string) => {
    setGrade(prev => (prev === tier ? '' : tier));
  };

  const psaStatusLine = (() => {
    if (!isPsa) return null;
    if (psa.phase === 'loading') return {color: T.textMuted, text: 'Checking PSA records…'};
    if (psa.phase !== 'done') return null;
    switch (psa.status) {
      case 'psa_verified_match':
        return {color: T.gradeGreen ?? '#4CAF50', text: '✓ Verified with PSA records'};
      case 'psa_verified_mismatch':
        return {
          color: '#F2B84B',
          text: psa.message ?? 'PSA record differs from selected tier. Override required.',
        };
      case 'psa_lookup_no_data':
        return {color: T.textMuted, text: 'No PSA record found for this cert.'};
      case 'psa_lookup_bad_cert':
        return {color: '#F2B84B', text: psa.message ?? 'Cert format looks off.'};
      case 'psa_lookup_timeout':
        return {
          color: T.textMuted,
          text: 'PSA lookup unavailable right now. You can continue with a self-declared baseline.',
        };
      case 'psa_lookup_disabled':
      case 'psa_lookup_unauthorized':
      case 'psa_lookup_error':
        return {
          color: T.textMuted,
          text: 'PSA lookup unavailable right now. You can continue with a self-declared baseline.',
        };
    }
  })();

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <BackButton />

        <Text style={styles.title}>CARD CONDITION</Text>
        <Text style={styles.subtitle}>
          Describe the physical condition of the card.
        </Text>

        {/* Physical Condition */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>PHYSICAL CONDITION</Text>

          <Text style={styles.fieldLabel}>CORNERS *</Text>
          <TextInput
            style={styles.input}
            value={corners}
            onChangeText={setCorners}
            placeholder="e.g., Sharp, light wear on bottom-left"
            placeholderTextColor={T.textDisabled}
          />

          <Text style={styles.fieldLabel}>EDGES</Text>
          <TextInput
            style={styles.input}
            value={edges}
            onChangeText={setEdges}
            placeholder="e.g., Clean, no chipping"
            placeholderTextColor={T.textDisabled}
          />

          <Text style={styles.fieldLabel}>SURFACE</Text>
          <TextInput
            style={styles.input}
            value={surface}
            onChangeText={setSurface}
            placeholder="e.g., No scratches, good gloss"
            placeholderTextColor={T.textDisabled}
          />

          <Text style={styles.fieldLabel}>CENTERING</Text>
          <TextInput
            style={styles.input}
            value={centering}
            onChangeText={setCentering}
            placeholder="e.g., 55/45 left-right"
            placeholderTextColor={T.textDisabled}
          />

          <Text style={styles.fieldLabel}>OTHER NOTES</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={other}
            onChangeText={setOther}
            placeholder="Any additional observations..."
            placeholderTextColor={T.textDisabled}
            multiline
            numberOfLines={3}
          />
        </View>

        {/* Baseline Grades */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>BASELINE GRADES (OPTIONAL)</Text>
          <Text style={styles.sectionHint}>
            If this card has been previously graded, enter the details below.
          </Text>

          <Text style={styles.fieldLabel}>COMPANY</Text>
          <View style={styles.chipRow}>
            {COMPANIES.map(c => (
              <TouchableOpacity
                key={c}
                style={[styles.chip, company === c && styles.chipActive]}
                onPress={() => onSelectCompany(c)}>
                <Text style={[styles.chipText, company === c && styles.chipTextActive]}>
                  {c}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Grade: chip picker for PSA (8/9/10), free-text otherwise */}
          <Text style={styles.fieldLabel}>GRADE</Text>
          {isPsa ? (
            <View style={styles.chipRow}>
              {PSA_TIERS.map(tier => (
                <TouchableOpacity
                  key={tier}
                  style={[
                    styles.chip,
                    grade === tier && styles.chipActive,
                    psaFieldsLocked && styles.chipLocked,
                  ]}
                  disabled={psaFieldsLocked}
                  onPress={() => handleGradeSelect(tier)}>
                  <Text
                    style={[
                      styles.chipText,
                      grade === tier && styles.chipTextActive,
                    ]}>
                    PSA {tier}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <TextInput
              style={styles.input}
              value={grade}
              onChangeText={setGrade}
              placeholder="e.g., 9, Mint 9"
              placeholderTextColor={T.textDisabled}
            />
          )}

          <Text style={styles.fieldLabel}>CERT #</Text>
          <View style={styles.certRow}>
            <TextInput
              style={[styles.input, styles.certInput, psaFieldsLocked && styles.inputLocked]}
              value={certNumber}
              onChangeText={setCertNumber}
              placeholder="Certificate number (PSA lookup will run automatically)"
              placeholderTextColor={T.textDisabled}
              keyboardType={isPsa ? 'number-pad' : 'default'}
              editable={!psaFieldsLocked}
            />
            {psa.phase === 'loading' && (
              <ActivityIndicator color={T.gold} style={styles.certSpinner} />
            )}
          </View>

          {/* PSA verification status line */}
          {psaStatusLine && (
            <Text style={[styles.statusLine, {color: psaStatusLine.color}]}>
              {psaStatusLine.text}
            </Text>
          )}

          {/* Server-authoritative card name surfaces on successful verify */}
          {psa.phase === 'done' &&
            (verifiedMatch || verifiedMismatch) &&
            psa.cardName && (
              <View style={styles.psaRecord}>
                <Text style={styles.psaRecordLabel}>PSA RECORD</Text>
                <Text style={styles.psaRecordValue}>{psa.cardName}</Text>
                {psa.grade && (
                  <Text style={styles.psaRecordGrade}>Grade: {psa.grade}</Text>
                )}
              </View>
            )}

          {/* Mismatch override prompt */}
          {verifiedMismatch && (
            <TouchableOpacity
              style={[styles.overrideBtn, override && styles.overrideBtnActive]}
              onPress={() => setOverride(o => !o)}>
              <Text
                style={[
                  styles.overrideText,
                  override && styles.overrideTextActive,
                ]}>
                {override
                  ? '✓ Override acknowledged — you will submit despite the PSA mismatch'
                  : 'Tap to override and continue anyway'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          style={[styles.continueBtn, !canContinue && styles.btnDisabled]}
          disabled={!canContinue}
          onPress={handleContinue}>
          <Text style={styles.continueBtnText}>CONTINUE TO REVIEW</Text>
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
    fontSize: 18,
    letterSpacing: 3,
    marginBottom: 4,
    fontWeight: '700',
  },
  subtitle: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 1,
    marginBottom: 24,
  },
  section: {marginBottom: 24},
  sectionLabel: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 3,
    marginBottom: 8,
  },
  sectionHint: {
    color: T.textDisabled,
    fontFamily: 'monospace',
    fontSize: 10,
    lineHeight: 14,
    marginBottom: 12,
  },
  fieldLabel: {
    color: T.textSecondary,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 2,
    marginTop: 12,
    marginBottom: 6,
  },
  input: {
    backgroundColor: T.bgSurface,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: T.textPrimary,
    fontFamily: 'monospace',
    fontSize: 13,
  },
  inputLocked: {
    opacity: 0.55,
    borderColor: T.borderStrong,
  },
  multiline: {minHeight: 72, textAlignVertical: 'top'},
  chipRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4},
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: T.border,
    backgroundColor: T.bgSurface,
  },
  chipActive: {
    borderColor: T.gold,
    backgroundColor: `${T.gold}22`,
  },
  chipLocked: {
    opacity: 0.55,
  },
  chipText: {
    color: T.textSecondary,
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 1,
  },
  chipTextActive: {
    color: T.gold,
    fontWeight: '700',
  },
  certRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  certInput: {flex: 1},
  certSpinner: {
    marginLeft: 4,
  },
  statusLine: {
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 10,
  },
  psaRecord: {
    marginTop: 10,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: T.borderStrong,
    backgroundColor: T.bgSurface,
  },
  psaRecordLabel: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 9,
    letterSpacing: 3,
    marginBottom: 4,
  },
  psaRecordValue: {
    color: T.textPrimary,
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 18,
  },
  psaRecordGrade: {
    color: T.textSecondary,
    fontFamily: 'monospace',
    fontSize: 11,
    marginTop: 4,
  },
  overrideBtn: {
    marginTop: 12,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#F2B84B',
    backgroundColor: 'transparent',
  },
  overrideBtnActive: {
    backgroundColor: '#F2B84B22',
  },
  overrideText: {
    color: '#F2B84B',
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 15,
    textAlign: 'center',
  },
  overrideTextActive: {
    color: '#F2B84B',
    fontWeight: '700',
  },
  continueBtn: {
    backgroundColor: T.gold,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  btnDisabled: {opacity: 0.4},
  continueBtnText: {
    color: T.bgApp,
    fontFamily: 'monospace',
    fontSize: 13,
    letterSpacing: 3,
    fontWeight: '700',
  },
});
