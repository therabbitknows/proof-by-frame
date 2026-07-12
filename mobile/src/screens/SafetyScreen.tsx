import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import {ApiService} from '../services/api';
import {useDiscordAuth} from '../hooks/useDiscordAuth';
import {
  COMMUNITY_TERMS_URL,
  PRIVACY_POLICY_URL,
  UGC_TERMS_VERSION,
  hasAcceptedSafetyTerms,
  markSafetyTermsAccepted,
} from '../services/safety';
import {T} from '../constants/tokens';

const REPORT_CATEGORIES = [
  ['restricted_content', 'Restricted content'],
  ['harassment', 'Harassment'],
  ['fraud_or_misleading', 'Fraud or misleading'],
  ['intellectual_property', 'Intellectual property'],
  ['other', 'Other'],
] as const;

export const SafetyScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const {isLinked} = useDiscordAuth();
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submissionId, setSubmissionId] = useState(
    route.params?.submissionId ?? '',
  );
  const [category, setCategory] = useState('other');
  const [details, setDetails] = useState('');

  useEffect(() => {
    hasAcceptedSafetyTerms().then(setAccepted);
  }, []);

  const acceptTerms = async () => {
    setBusy(true);
    try {
      if (isLinked) await ApiService.acceptSafetyTerms(UGC_TERMS_VERSION);
      await markSafetyTermsAccepted();
      setAccepted(true);
      if (route.params?.returnToSubmission) {
        navigation.replace('Camera', {captureMode: 'front'});
      }
    } catch {
      Alert.alert('Could not record acceptance', 'Please try again when the connection is available.');
    } finally {
      setBusy(false);
    }
  };

  const submitReport = async () => {
    if (!submissionId.trim()) {
      Alert.alert('Submission required', 'Enter the submission ID shown in PROOF.');
      return;
    }
    setBusy(true);
    try {
      await ApiService.reportContent({
        submissionId: submissionId.trim(),
        category,
        details: details.trim() || undefined,
      });
      setDetails('');
      Alert.alert('Report received', 'The content is queued for private operator review.');
    } catch {
      Alert.alert('Report not sent', 'Check the submission ID and try again.');
    } finally {
      setBusy(false);
    }
  };

  const blockOwner = async () => {
    if (!submissionId.trim()) {
      Alert.alert('Submission required', 'Enter the submission ID whose owner you want to block.');
      return;
    }
    setBusy(true);
    try {
      await ApiService.blockContentOwner(submissionId.trim());
      Alert.alert('User blocked', 'The block is recorded for in-app community surfaces.');
    } catch {
      Alert.alert('Could not block user', 'Check the submission ID and try again.');
    } finally {
      setBusy(false);
    }
  };

  const requestDeletion = () => {
    Alert.alert(
      'Request account deletion?',
      'Your request will be reviewed and associated off-chain account data will be deleted, except records retained for fraud prevention, legal obligations, or immutable on-chain history.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Request deletion',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await ApiService.requestAccountDeletion();
              Alert.alert('Request received', 'Your account deletion request is now pending review.');
            } catch {
              Alert.alert('Request not sent', 'Please try again when the connection is available.');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity accessibilityLabel="Back" onPress={() => navigation.goBack()}>
          <Text style={styles.back}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.title}>PRIVACY &amp; SAFETY</Text>
        <View style={styles.headerSpacer} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>COMMUNITY TERMS</Text>
        <Text style={styles.body}>
          Card images and descriptions must be lawful, accurate, and free of restricted, abusive, or infringing content.
        </Text>
        <View style={styles.linkRow}>
          <TouchableOpacity onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}>
            <Text style={styles.link}>PRIVACY POLICY</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => Linking.openURL(COMMUNITY_TERMS_URL)}>
            <Text style={styles.link}>FULL TERMS</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          disabled={accepted || busy}
          style={[styles.primaryButton, accepted && styles.acceptedButton]}
          onPress={acceptTerms}>
          {busy ? (
            <ActivityIndicator color={T.bgApp} />
          ) : (
            <Text style={styles.primaryButtonText}>
              {accepted ? 'TERMS ACCEPTED' : 'I AGREE TO THE COMMUNITY TERMS'}
            </Text>
          )}
        </TouchableOpacity>

        <View style={styles.divider} />
        <Text style={styles.sectionTitle}>REPORT OR BLOCK</Text>
        <Text style={styles.body}>
          Use the submission ID shown in PROOF. Reports are private and do not expose your identity to the reported user.
        </Text>
        <TextInput
          style={styles.input}
          value={submissionId}
          onChangeText={setSubmissionId}
          placeholder="Submission ID"
          placeholderTextColor={T.textDisabled}
          autoCapitalize="none"
        />
        <View style={styles.categoryGrid}>
          {REPORT_CATEGORIES.map(([value, label]) => (
            <TouchableOpacity
              key={value}
              style={[styles.category, category === value && styles.categorySelected]}
              onPress={() => setCategory(value)}>
              <Text style={[styles.categoryText, category === value && styles.categoryTextSelected]}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <TextInput
          style={[styles.input, styles.detailsInput]}
          value={details}
          onChangeText={setDetails}
          placeholder="Optional note (500 characters max)"
          placeholderTextColor={T.textDisabled}
          multiline
          maxLength={500}
        />
        {isLinked ? (
          <View style={styles.actionRow}>
            <TouchableOpacity disabled={busy} style={styles.secondaryButton} onPress={submitReport}>
              <Text style={styles.secondaryButtonText}>REPORT</Text>
            </TouchableOpacity>
            <TouchableOpacity disabled={busy} style={styles.secondaryButton} onPress={blockOwner}>
              <Text style={styles.secondaryButtonText}>BLOCK USER</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Text style={styles.notice}>Sign in with Discord to report or block community content.</Text>
        )}

        <View style={styles.divider} />
        <Text style={styles.sectionTitle}>ACCOUNT DATA</Text>
        <Text style={styles.body}>
          Request deletion of your PROOF account and associated off-chain user data. Immutable on-chain records and limited fraud or legal records may remain.
        </Text>
        <TouchableOpacity
          disabled={!isLinked || busy}
          style={[styles.dangerButton, !isLinked && styles.disabledButton]}
          onPress={requestDeletion}>
          <Text style={styles.dangerButtonText}>REQUEST ACCOUNT DELETION</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: T.bgApp},
  header: {
    paddingTop: 52,
    paddingHorizontal: 20,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: T.border,
  },
  back: {color: T.gold, fontSize: 36, lineHeight: 36},
  title: {color: T.textPrimary, fontFamily: 'monospace', fontSize: 13, letterSpacing: 3},
  headerSpacer: {width: 24},
  content: {padding: 20, paddingBottom: 48},
  sectionTitle: {color: T.gold, fontFamily: 'monospace', fontSize: 11, letterSpacing: 3, marginBottom: 10},
  body: {color: T.textSecondary, fontFamily: 'monospace', fontSize: 12, lineHeight: 19, marginBottom: 14},
  linkRow: {flexDirection: 'row', gap: 24, marginBottom: 18},
  link: {color: T.amber, fontFamily: 'monospace', fontSize: 10, letterSpacing: 1},
  primaryButton: {backgroundColor: T.gold, borderRadius: 8, padding: 15, alignItems: 'center'},
  acceptedButton: {backgroundColor: T.gradeGreen},
  primaryButtonText: {color: T.bgApp, fontFamily: 'monospace', fontSize: 10, fontWeight: '700', letterSpacing: 1},
  divider: {height: 1, backgroundColor: T.border, marginVertical: 28},
  input: {borderWidth: 1, borderColor: T.borderStrong, borderRadius: 8, color: T.textPrimary, padding: 12, fontFamily: 'monospace', fontSize: 12, marginBottom: 12},
  detailsInput: {minHeight: 88, textAlignVertical: 'top'},
  categoryGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12},
  category: {borderWidth: 1, borderColor: T.border, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8},
  categorySelected: {borderColor: T.gold, backgroundColor: `${T.gold}18`},
  categoryText: {color: T.textMuted, fontFamily: 'monospace', fontSize: 9},
  categoryTextSelected: {color: T.gold},
  actionRow: {flexDirection: 'row', gap: 10},
  secondaryButton: {flex: 1, borderWidth: 1, borderColor: T.amber, borderRadius: 8, padding: 13, alignItems: 'center'},
  secondaryButtonText: {color: T.amber, fontFamily: 'monospace', fontSize: 10, letterSpacing: 1},
  notice: {color: T.textMuted, fontFamily: 'monospace', fontSize: 10, lineHeight: 16},
  dangerButton: {borderWidth: 1, borderColor: T.red, borderRadius: 8, padding: 14, alignItems: 'center'},
  dangerButtonText: {color: T.red, fontFamily: 'monospace', fontSize: 10, letterSpacing: 1},
  disabledButton: {opacity: 0.4},
});
