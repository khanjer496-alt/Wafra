import { privateAlertFormatCopy } from '@/lib/private-alert-format-copy';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState as NativeAppState, Platform, Pressable, TextInput, View } from 'react-native';
import { Stack } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { BandScaffold } from '@/components/ui/band-scaffold';
import { EButton } from '@/components/ui/band/e-button';
import { ThemedText } from '@/components/themed-text';
import { useBand } from '@/hooks/use-band';
import { useRouter } from '@/hooks/use-app-router';
import { useStore, usePrivateMode } from '@/lib/store';
import {
  preparePrivateAlertFormatFromInput, validatePrivateAlertFormatFromSample,
} from '@/lib/private-alert-format-runtime';
import type { PrivateAlertFormat } from '@/lib/private-alert-formats';
import { learnFromConfirmation, type LearnedFields, type LearnInput } from '@/lib/learned-alert-formats';
import { SettingsSwitchRow } from '@/components/settings-rows';
import { getRelayConfig } from '@/lib/relay';
import { submitSharedAlertShape } from '@/lib/shared-alert-format-sync';
import { toSharedAlertShape, type SharedAlertShape } from '@/lib/shared-alert-formats';
import {
  buildPrivateTeachingInput, privateAlertSourceDateContext, privateTeachingChoices, teachingMoneyLabel,
} from '@/lib/private-alert-teaching';

/** Source and draft capsules live only in this screen's temporary state. */
export default function TeachBankFormatScreen() {
  const { state, addPrivateAlertFormat, removePrivateAlertFormat, setShareAlertFormats } = useStore();
  const router = useRouter();
  const band = useBand('flow');
  const focused = useIsFocused();
  const privateMode = usePrivateMode();
  const ar = state.language === 'ar';
  const words = privateAlertFormatCopy(state.language);
  const [source, setSource] = useState('');
  const [sender, setSender] = useState('');
  const [choiceId, setChoiceId] = useState('');
  const [direction, setDirection] = useState<'debit' | 'credit' | ''>('');
  const [merchant, setMerchant] = useState('');
  const [date, setDate] = useState('');
  const [draft, setDraft] = useState<PrivateAlertFormat | null>(null);
  const [verified, setVerified] = useState<{ template: PrivateAlertFormat; fields: LearnedFields } | null>(null);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const operation = useRef(0);
  const mounted = useRef(true);
  const saving = useRef(false);
  const pendingInput = useRef<LearnInput | null>(null);
  const pendingSample = useRef<{ source: string; sender: string | null } | null>(null);
  // Only the value-free SHAPE of the taught format (typed slots, boilerplate words).
  // It holds no message text, amount, name or date, and is released with the form.
  const pendingShape = useRef<SharedAlertShape | null>(null);
  const readPendingInput = useCallback(() => pendingInput.current, []);
  const readPendingSample = useCallback(() => pendingSample.current, []);
  const choices = useMemo(() => privateTeachingChoices(source, state.country ?? null, sender), [source, state.country, sender]);
  const formats = state.privateAlertFormats?.templates ?? [];
  const roleLabel = (role: string) => ({
    transaction: words.transaction, unknown: words.amount,
    balance: words.balance, 'credit-limit': words.creditLimit,
    fee: words.fee, 'bill-due': words.billDue,
    'statement-total': words.statementTotal, 'minimum-due': words.minimumDue,
  } as Record<string, string>)[role] ?? words.otherAmount;
  const clear = useCallback(() => {
    operation.current++;
    if (pendingInput.current) {
      pendingInput.current.source = ''; pendingInput.current.sender = null;
      pendingInput.current.confirmed.merchant = null; pendingInput.current.confirmed.date = null;
      pendingInput.current.confirmed.amountMinor = 0;
    }
    if (pendingSample.current) { pendingSample.current.source = ''; pendingSample.current.sender = null; }
    pendingInput.current = null; pendingSample.current = null; pendingShape.current = null;
    setSource(''); setSender(''); setChoiceId(''); setDirection('');
    setMerchant(''); setDate(''); setDraft(null); setVerified(null);
    setSelection({ start: 0, end: 0 }); setError(''); setBusy(false);
  }, []);
  useEffect(() => {
    mounted.current = true;
    const sub = NativeAppState.addEventListener('change', next => {
      if (next !== 'active') clear();
    });
    return () => { mounted.current = false; clear(); sub.remove(); };
  }, [clear]);
  useEffect(() => { if (!focused) clear(); }, [focused, clear]);
  useEffect(() => { if (privateMode) clear(); }, [privateMode, clear]);
  const fail = (reason: string) => {
    const explanations: Record<string, string> = {
      'choose-amount': words.chooseTheTransactionAmountNotThe,
      'choose-direction': words.chooseWhetherMoneyLeftOrEntered,
      'too-long': words.thisAlertIsTooLongPaste,
      'merchant-not-grounded': words.useTheExactPayeeTextFrom,
      'date-not-grounded': words.useATransactionDateStatedIn,
      'device-key-unavailable': words.secureStorageIsUnavailableTryAgain,
      'launch-market': words.thisAlertAlreadyBelongsToThe,
      'distinct-source-required': words.useADifferentReceivedAlertWith,
    };
    setError(explanations[reason] ?? words.thisAlertCouldNotBeSafely);
  };
  /** The shareable shape for the learned layout, or null when it cannot be shared. */
  const shapeOf = (input: LearnInput): SharedAlertShape | null => {
    try {
      const scoped = privateAlertSourceDateContext(input.source, input.sender, input.context);
      const learned = learnFromConfirmation({ ...input,
        context: { ...input.context, country: scoped.country, dateOrder: scoped.dateOrder } });
      if (!learned.ok) return null;
      const shape = toSharedAlertShape(learned.template);
      return shape.ok ? shape.shape : null;
    } catch { return null; }
  };
  const prepare = async () => {
    const input = buildPrivateTeachingInput({ source, sender, choiceId, direction, merchant, date,
      country: state.country ?? null, now: Date.now() });
    if (!input.ok) { fail(input.reason); return; }
    const run = ++operation.current; setBusy(true); setError(''); setSaved(false);
    pendingInput.current = input.input;
    try {
      const result = await preparePrivateAlertFormatFromInput(readPendingInput,
        () => !mounted.current || run !== operation.current);
      if (!mounted.current || run !== operation.current) return;
      if (!result.ok) { fail(result.reason); return; }
      pendingShape.current = shapeOf(input.input);
      setDraft(result.template); setSource(''); setChoiceId(''); setMerchant(''); setDate('');
      setSelection({ start: 0, end: 0 });
    } catch { if (mounted.current && run === operation.current) fail('device-key-unavailable'); }
    finally {
      input.input.source = ''; input.input.sender = null;
      input.input.confirmed.merchant = null; input.input.confirmed.date = null;
      if (pendingInput.current === input.input) pendingInput.current = null;
      if (mounted.current && run === operation.current) setBusy(false);
    }
  };
  const check = async () => {
    if (!draft || !source.trim()) return;
    const run = ++operation.current; setBusy(true); setError('');
    const sample = { source, sender: sender.trim() || null };
    pendingSample.current = sample;
    try {
      const result = await validatePrivateAlertFormatFromSample(draft, readPendingSample,
        { country: state.country, now: Date.now() },
        () => !mounted.current || run !== operation.current);
      if (!mounted.current || run !== operation.current) return;
      if (!result.ok) { fail(result.reason); return; }
      setVerified({ template: result.template, fields: result.fields });
      setSource(''); setSender(''); setDraft(null);
    } catch { if (mounted.current && run === operation.current) fail('device-key-unavailable'); }
    finally {
      sample.source = ''; sample.sender = null;
      if (pendingSample.current === sample) pendingSample.current = null;
      if (mounted.current && run === operation.current) setBusy(false);
    }
  };
  const save = async () => {
    if (!verified || busy) return;
    const run = ++operation.current; saving.current = true; setBusy(true); setError('');
    try {
      await addPrivateAlertFormat(verified.template);
      // Opt-in only, never in Private Mode, and never allowed to affect teaching.
      const shape = state.shareAlertFormats === true && !privateMode ? pendingShape.current : null;
      if (shape) {
        void (async () => {
          try {
            const cfg = await getRelayConfig();
            if (cfg) await submitSharedAlertShape(cfg, shape);
          } catch { /* silent by design */ }
        })();
      }
      if (!mounted.current || run !== operation.current) return;
      clear(); setSaved(true);
    } catch { if (mounted.current && run === operation.current) setError(words.theFormatWasNotSavedYour); }
    finally { saving.current = false; if (mounted.current && run === operation.current) setBusy(false); }
  };
  const forget = async (id: string) => {
    if (busy) return;
    const run = ++operation.current; setBusy(true); setError('');
    try { await removePrivateAlertFormat(id); }
    catch { if (mounted.current && run === operation.current) setError(words.theFormatCouldNotBeForgotten); }
    finally { if (mounted.current && run === operation.current) setBusy(false); }
  };
  const fieldStyle = { borderWidth: 1, borderColor: band.rule, borderRadius: 14, padding: 14,
    backgroundColor: band.card, color: band.text, fontSize: 16, minHeight: 52,
    textAlign: ar ? 'right' as const : 'left' as const };
  const input = (label: string, value: string, change: (text: string) => void, testID: string, placeholder = '') =>
    <View style={{ gap: 8 }}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <TextInput testID={testID} accessibilityLabel={label} value={value} onChangeText={change}
        editable={!busy} autoCorrect={false} autoCapitalize="none" placeholder={placeholder}
        placeholderTextColor={band.textSecondary} style={fieldStyle} />
    </View>;
  const stageTitle = verified ? words.confirmTheSecondAlert
    : draft ? words.checkAnotherAlert : words.teachABankFormat;
  return <BandScaffold band="flow" testID="teach-bank-format" keyboardAware
    nav={{ back: () => { if (!saving.current) { clear(); router.back(); } }, backDisabled: busy && saving.current,
      title: words.bankFormats }}
    bandContent={<View style={{ gap: 8 }}>
      <ThemedText type="title" style={{ color: band.onBand }}>{stageTitle}</ThemedText>
      <ThemedText type="small" style={{ color: band.onBandSecondary }}>{words.learnANewLayoutOnYour}</ThemedText>
    </View>} scrollProps={{ keyboardShouldPersistTaps: 'handled' }}>
    <Stack.Screen options={{ gestureEnabled: !(busy && saving.current) }} />
    <View style={{ gap: 20, padding: 20 }}>
      {saved && <ThemedText testID="format-saved" accessibilityLiveRegion="polite">{words.formatSavedFutureMatchesWillBe}</ThemedText>}
      {privateMode && <ThemedText type="small">{words.privateModeStaysOnTeachingRuns}</ThemedText>}
      {Platform.OS === 'web' && <ThemedText type="small" themeColor="textSecondary">{words.savingBankFormatsRequiresTheIOS}</ThemedText>}
      {!verified && <>
        <ThemedText type="small">{draft ? words.pasteADifferentReceivedAlertWith : words.pasteOneCompleteBankAlertInclude}</ThemedText>
        {input(words.senderExactlyAsShownIfAvailable, sender, setSender, 'format-sender', words.leaveBlankForSenderlessPastedText)}
        <TextInput testID="format-source" accessibilityLabel={words.completeBankAlert}
          value={source} onChangeText={value => { setSource(value); setChoiceId(''); setSelection({ start: 0, end: 0 }); setError(''); }}
          onSelectionChange={event => setSelection(event.nativeEvent.selection)} multiline
          autoCorrect={false} autoCapitalize="none" editable={!busy} textAlignVertical="top"
          placeholder={words.pasteTheAlertHere} placeholderTextColor={band.textSecondary}
          style={{ ...fieldStyle, minHeight: 150 }} />
        {choices.reason === 'too-long' && <ThemedText type="small" themeColor="warning">{words.maximum1000CharactersTheAlert}</ThemedText>}
      </>}
      {!draft && !verified && <>
        <ThemedText type="smallBold">{words.chooseTheTransactionAmount}</ThemedText>
        {choices.money.map(row => <Pressable key={row.id} testID={`format-${row.id}`} accessibilityRole="radio"
          accessibilityState={{ checked: choiceId === row.id, disabled: !row.selectable || busy }}
          aria-checked={choiceId === row.id} aria-disabled={!row.selectable || busy}
          accessibilityLabel={`${row.money ? teachingMoneyLabel(row.money) : words.ambiguousAmount} · ${roleLabel(row.role)}`}
          onPress={() => setChoiceId(row.id)} disabled={!row.selectable || busy}
          style={{ padding: 16, minHeight: 52, borderRadius: 14, borderWidth: choiceId === row.id ? 2 : 1,
            borderColor: choiceId === row.id ? band.tint : band.rule, backgroundColor: band.card }}>
          <ThemedText type="smallBold">{row.money ? teachingMoneyLabel(row.money) : words.currencyOrNumberIsAmbiguous}</ThemedText>
          {!row.selectable && <ThemedText type="meta" themeColor="textSecondary">{words.notSelectable}{roleLabel(row.role)}</ThemedText>}
        </Pressable>)}
        {source.trim() && !choices.money.length && choices.reason !== 'too-long' && <ThemedText type="small" themeColor="textSecondary">{words.noExactCurrencyAndAmountWere}</ThemedText>}
        <ThemedText type="smallBold">{words.whatHappenedToYourAccount}</ThemedText>
        <View style={{ gap: 10 }}>
          <EButton palette={band} variant={direction === 'debit' ? 'primary' : 'secondary'} testID="format-debit"
            disabled={busy} label={words.moneyLeftMyAccount} onPress={() => setDirection('debit')} />
          <EButton palette={band} variant={direction === 'credit' ? 'primary' : 'secondary'} testID="format-credit"
            disabled={busy} label={words.moneyEnteredMyAccount} onPress={() => setDirection('credit')} />
        </View>
        {input(words.payeeOrMerchantExactTextOptional, merchant, setMerchant, 'format-merchant')}
        {selection.end > selection.start && selection.end - selection.start <= 96 && <EButton palette={band} variant="quiet"
          testID="format-use-selection" disabled={busy} label={words.useHighlightedTextAsPayee}
          onPress={() => setMerchant(source.slice(selection.start, selection.end).trim())} />}
        {input(words.transactionDateOptionalYYYYMMDD, date, setDate, 'format-date', '2026-10-10')}
        <ThemedText type="meta" themeColor="textSecondary">{words.leaveUnstatedFieldsBlankDoNot}</ThemedText>
        <EButton palette={band} testID="format-next" label={words.checkASecondAlert}
          busy={busy} disabled={!state.hydrated || Platform.OS === 'web' || !source.trim() || choices.reason === 'too-long'} onPress={() => void prepare()} />
      </>}
      {draft && <EButton palette={band} testID="format-check" label={words.readTheSecondAlert}
        disabled={!source.trim() || source.length > 1000} busy={busy} onPress={() => void check()} />}
      {verified && <>
        <ThemedText type="small">{words.confirmThatTheseValuesDescribeThe}</ThemedText>
        <View testID="format-preview" style={{ gap: 10, padding: 20, borderRadius: 16, backgroundColor: band.card }}>
          <ThemedText type="subtitle">{teachingMoneyLabel({ currency: verified.fields.currency, exponent: verified.fields.exponent, minorUnits: String(verified.fields.amountMinor) })}</ThemedText>
          <ThemedText>{verified.fields.direction === 'debit' ? words.moneyLeftTheAccount : words.moneyEnteredTheAccount}</ThemedText>
          {verified.fields.merchant && <ThemedText>{verified.fields.merchant}</ThemedText>}
          {verified.fields.date && <ThemedText>{verified.fields.date}</ThemedText>}
        </View>
        <EButton palette={band} testID="format-save" label={words.valuesAreCorrectSaveFormat}
          busy={busy} disabled={!state.hydrated} haptic="commit" onPress={() => void save()} />
      </>}
      {(draft || verified) && <EButton palette={band} variant="quiet" testID="format-start-over" disabled={busy}
        label={words.startOver} onPress={clear} />}
      {error && <ThemedText testID="format-error" type="small" themeColor="warning" accessibilityLiveRegion="polite">{error}</ThemedText>}
      <ThemedText type="meta" themeColor="textSecondary">{words.onlyThePrivateLayoutIsRemembered}</ThemedText>
      <View style={{ borderRadius: 14, paddingHorizontal: 16, backgroundColor: band.card }}>
        <SettingsSwitchRow testID="format-share-switch" title={words.shareWithOthersTitle}
          subtitle={words.shareWithOthersBody} value={state.shareAlertFormats === true} last palette={band}
          onChange={next => { setShareAlertFormats(next).catch(() => { if (mounted.current) setError(words.theFormatWasNotSavedYour); }); }} />
      </View>
      {formats.length > 0 && <View style={{ gap: 12 }}>
        <ThemedText type="subtitle">{words.savedFormats}</ThemedText>
        {formats.map((format, index) => <View key={format.id} style={{ gap: 8, padding: 16, borderRadius: 14, backgroundColor: band.card }}>
          <ThemedText type="smallBold">{words.format} {index + 1} · {format.currency} · {format.direction === 'debit' ? words.moneyOut : words.moneyIn}</ThemedText>
          <EButton palette={band} variant="quiet" testID={`format-forget-${index}`} disabled={busy}
            label={words.forgetThisFormat} onPress={() => void forget(format.id)} />
        </View>)}
      </View>}
    </View>
  </BandScaffold>;
}
