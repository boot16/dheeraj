import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { createHash } from 'node:crypto';
import { applyCommand } from './domain.mjs';

initializeApp();
const db = getFirestore();
const ownerUid = defineString('WHOLESALE_OWNER_UID');
const workspace = db.doc('wholesale/main');
const products = workspace.collection('products');
const entries = workspace.collection('entries');

export const wholesale = onCall({ region: 'asia-south1', maxInstances: 3 }, async request => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to open the shop.');
  if (uid !== ownerUid.value()) throw new HttpsError('permission-denied', 'This account has no access to the shop.');
  const command = request.data;
  if (!command || typeof command !== 'object') throw new HttpsError('invalid-argument', 'Invalid request.');
  const readOnly = command.action === 'read';
  const body = JSON.stringify(command);
  if (!readOnly && (body.length > 100000 || typeof command.id !== 'string' ||
    !/^[0-9a-f-]{36}$/.test(command.id) || !Number.isSafeInteger(command.revision) || command.revision < 0)) {
    throw new HttpsError('invalid-argument', 'Invalid transaction request.');
  }
  const receipt = readOnly ? null : workspace.collection('commands').doc(command.id);
  const hash = createHash('sha256').update(JSON.stringify({
    action: command.action, page: command.page, fields: command.fields, lines: command.lines
  })).digest('hex');
  return db.runTransaction(async tx => {
    const [meta, items, journal, previous] = await Promise.all([
      tx.get(workspace), tx.get(products), tx.get(entries.orderBy('id')), receipt && tx.get(receipt)
    ]);
    const revision = meta.get('revision') ?? 0;
    const data = {
      products: items.docs.map(doc => doc.data()),
      entries: journal.docs.map(doc => doc.data()),
      shop: meta.get('shop') ?? { name: 'Dheeraj Wholesale', gstin: '', address: '' },
      next: meta.get('next') ?? 1
    };
    if (readOnly) return { data, revision };
    if (previous.exists) {
      if (previous.get('hash') !== hash) throw new HttpsError('invalid-argument', 'Transaction ID was already used.');
      return { data, revision, entryId: previous.get('entryId') };
    }
    if (command.revision !== revision) throw new HttpsError('failed-precondition', 'Another device changed the shop. Review and retry.');
    const next = structuredClone(data);
    try {
      applyCommand(next, uid, command);
    } catch (error) {
      throw new HttpsError('invalid-argument', error.message);
    }
    const originals = new Map(data.products.map(item => [item.id, JSON.stringify(item)]));
    for (const item of next.products) {
      if (originals.get(item.id) !== JSON.stringify(item)) tx.set(products.doc(item.id), item);
    }
    const added = next.entries.slice(data.entries.length);
    for (const record of added) tx.create(entries.doc(String(record.id)), record);
    const entryId = added[0]?.id ?? null;
    tx.set(workspace, { revision: revision + 1, shop: next.shop, next: next.next });
    tx.create(receipt, { hash, entryId, actor: uid, action: command.action, createdAt: FieldValue.serverTimestamp() });
    return { data: next, revision: revision + 1, entryId };
  }, readOnly ? { readOnly: true } : undefined);
});
