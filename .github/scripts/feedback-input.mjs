/** Load the exact committed relay validator without installing or executing dependencies.
 * Only call from the untouched baseline checkout, never from a candidate tree.
 */
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';

const toModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const trustedModule = relative => stripTypeScriptTypes(readFileSync(new URL(relative, import.meta.url), 'utf8'));
let validator;
async function loadValidator() {
  if (!validator) {
    let source = trustedModule('../../server/src/feedback.ts');
    for (const name of ['feedback-wire', 'parser-research-contract']) {
      const url = toModule(trustedModule(`../../src/lib/${name}.ts`));
      source = source.replaceAll(`'@/lib/${name}'`, `'${url}'`);
    }
    validator = import(toModule(source));
  }
  return validator;
}

export async function validateFeedbackItem(item, expectedId) {
  const { validateFeedback, isFeedbackReject } = await loadValidator();
  if (!item || typeof item !== 'object' || Array.isArray(item) ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(expectedId ?? '') ||
      item.id !== expectedId || item.aiReviewConsent !== true ||
      item.diagnostic?.delivery?.thirdPartyAi !== true) {
    throw new Error('Invalid feedback identity or AI consent.');
  }
  const result = validateFeedback({ ...item, schema: 1 });
  if (isFeedbackReject(result) || !result.aiReviewConsent || result.text !== item.text ||
      result.appVersion !== item.appVersion || result.locale !== item.locale) {
    throw new Error('Invalid feedback schema or AI consent.');
  }
  return item;
}

export async function fetchFeedbackItem({ relayUrl, token, feedbackId, fetchImpl = fetch }) {
  const url = new URL(relayUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !token ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(feedbackId ?? '')) {
    throw new Error('Invalid feedback connection configuration.');
  }
  url.pathname = `${url.pathname.replace(/\/$/, '')}/v1/feedback/${feedbackId}`;
  const response = await fetchImpl(url, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    redirect: 'error', signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Feedback fetch failed (${response.status}).`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 32_768) throw new Error('Invalid feedback size.');
    chunks.push(chunk);
  }
  let item;
  try { item = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Invalid feedback JSON.'); }
  return validateFeedbackItem(item, feedbackId);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { writeFileSync } = await import('node:fs');
    const item = await fetchFeedbackItem({ relayUrl: process.env.RELAY_URL,
      token: process.env.FEEDBACK_READ_TOKEN, feedbackId: process.env.FEEDBACK_ID });
    writeFileSync(process.argv[2], JSON.stringify(item), { mode: 0o600 });
    console.log('Feedback identity, redaction schema, and AI consent verified.');
  } catch {
    console.error('::error::Feedback could not be fetched or did not pass the exact AI consent and redaction contract.');
    process.exitCode = 1;
  }
}
