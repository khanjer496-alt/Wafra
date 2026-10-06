/**
 * Backward-compatible destination for saved Review transfers links. Transfers
 * is the one page for transfers now: groups, the question, selecting several
 * and answering them together all live there. A link to one entry
 * (`?transactionId=…`) opens that entry's "What is this?" on Transfers.
 */
import { Redirect, useLocalSearchParams } from 'expo-router';

export default function ReviewTransfersRedirect() {
  const params = useLocalSearchParams<{ transactionId?: string | string[] }>();
  const transactionId = Array.isArray(params.transactionId) ? params.transactionId[0] : params.transactionId;
  return <Redirect href={transactionId ? { pathname: '/transfers', params: { transactionId } } : '/transfers'} />;
}
