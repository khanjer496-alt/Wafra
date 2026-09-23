#!/usr/bin/env python3
"""Seed an iOS Simulator Messages store (sms.db) with received SMS rows.

Simulator use only. This writes straight into the SQLite store of a *simulator*
device, which never held a real person's messages; it must not be pointed at
anything else. The schema differs between iOS releases, so every table is
introspected with PRAGMA table_info and only columns that exist are written;
NOT NULL columns this script does not know are given a neutral default.

usage: seed-sms-db.py <sms.db> <rows.json> [--report out.json]

rows.json is the output of build-seed-messages.mjs:
  {"rows": [{"guid": "...", "sender": "ADCB", "body": "...", "date": "ISO-8601"}]}
"""
import json
import re
import sqlite3
import sys
import uuid
from datetime import datetime, timezone

APPLE_EPOCH = 978307200  # 2001-01-01T00:00:00Z as a Unix timestamp


def apple_ns(iso):
    dt = datetime.fromisoformat(iso.replace('Z', '+00:00'))
    return (int(dt.timestamp()) - APPLE_EPOCH) * 1_000_000_000


def ts_int(value):
    """typedstream integer: one byte below 0x80, else a tagged little-endian int."""
    if value < 0x80:
        return bytes([value])
    if value < 0x8000:
        return b'\x81' + value.to_bytes(2, 'little')
    return b'\x82' + value.to_bytes(4, 'little')


def attributed_body(text):
    """A minimal NSKeyedArchiver-free typedstream NSAttributedString.

    Modern Messages renders `attributedBody` and only falls back to `text`
    when it is absent, so both are written. The layout is the one Messages
    itself writes for a plain one-part message: the string, then a single
    __kIMMessagePartAttributeName = 0 run covering its whole length.
    """
    raw = text.encode('utf-8')
    n = len(raw)
    out = bytearray()
    out += b'\x04\x0bstreamtyped'            # version 4, "streamtyped"
    out += b'\x81\xe8\x03'                    # system version 1000
    out += b'\x84\x01@'                       # object of type '@'
    out += b'\x84\x84\x84\x12NSAttributedString\x00'
    out += b'\x84\x84\x08NSObject\x00\x85\x92'
    out += b'\x84\x84\x84\x08NSString\x01\x94\x84\x01+' + ts_int(n) + raw + b'\x86'
    out += b'\x84\x02iI' + ts_int(1) + ts_int(n) + b'\x92'
    out += b'\x84\x84\x84\x0cNSDictionary\x00\x94\x84\x01i' + ts_int(1) + b'\x92'
    out += b'\x84\x84\x84\x08NSString\x01\x94\x84\x01+\x1d__kIMMessagePartAttributeName\x86\x92'
    out += b'\x84\x84\x84\x08NSNumber\x00\x84\x84\x07NSValue\x00\x94\x84\x01*\x84\x99\x99\x00\x86'
    out += b'\x86\x86'
    return bytes(out)


# Messages' own triggers call functions that only exist inside imagent.
# Without stubs every INSERT fails with "no such function". The three with
# meaning mirror what the real ones return for a 1:1 SMS chat; the rest are
# clean-up hooks that do nothing for freshly inserted rows.
KNOWN_TRIGGER_FUNCTIONS = {
    'verify_chat': (1, lambda guid: guid),
    'guid_for_chat': (3, lambda identifier, service, _style: f'{service};-;{identifier}'),
    'is_mic_enabled': (0, lambda: 0),
}
SQLITE_BUILTINS = {
    'abs', 'changes', 'char', 'coalesce', 'count', 'date', 'datetime', 'glob', 'group_concat', 'hex', 'ifnull', 'iif',
    'instr', 'julianday', 'last_insert_rowid', 'length', 'like', 'lower', 'ltrim', 'max', 'min', 'new', 'not', 'nullif',
    'old', 'printf', 'quote', 'random', 'raise', 'replace', 'round', 'rtrim', 'strftime', 'substr', 'sum', 'total',
    'trim', 'typeof', 'unicode', 'upper', 'zeroblob', 'exists', 'in', 'select', 'values', 'when', 'where', 'and', 'or',
    'update', 'insert', 'delete', 'set', 'from', 'into', 'on', 'of', 'then', 'else', 'end', 'begin', 'case', 'is',
    'null', 'json', 'json_extract', 'json_object', 'json_array', 'cast', 'as', 'limit', 'order', 'by', 'trigger',
    'after', 'before', 'each', 'row', 'for', 'if', 'concat', 'format', 'unhex', 'octet_length', 'sign',
}


def register_trigger_stubs(conn, report):
    for name, (arity, fn) in KNOWN_TRIGGER_FUNCTIONS.items():
        conn.create_function(name, arity, fn)
    seen = set(KNOWN_TRIGGER_FUNCTIONS)
    for (sql,) in conn.execute("SELECT sql FROM sqlite_master WHERE type='trigger' AND sql IS NOT NULL"):
        for name in re.findall(r'\b([A-Za-z_][A-Za-z0-9_]*)\s*\(', sql):
            lowered = name.lower()
            if lowered in seen or lowered in SQLITE_BUILTINS:
                continue
            seen.add(lowered)
            conn.create_function(name, -1, lambda *args: None)
            report.setdefault('stubbed_functions', []).append(name)


def columns(conn, table):
    rows = conn.execute(f'PRAGMA table_info("{table}")').fetchall()
    if not rows:
        raise SystemExit(f'FAIL: table {table} does not exist in this sms.db')
    # (name, type, notnull, default, pk)
    return {r[1]: {'type': r[2], 'notnull': bool(r[3]), 'default': r[4], 'pk': bool(r[5])} for r in rows}


def insert(conn, table, wanted, report):
    cols = columns(conn, table)
    values = {k: v for k, v in wanted.items() if k in cols}
    dropped = sorted(k for k in wanted if k not in cols)
    for name, meta in cols.items():
        if name in values or meta['pk'] or not meta['notnull'] or meta['default'] is not None:
            continue
        # Unknown NOT NULL column without a default: neutral value by type.
        t = (meta['type'] or '').upper()
        values[name] = '' if 'TEXT' in t or 'CHAR' in t else 0
        defaulted = report.setdefault('defaulted', {}).setdefault(table, [])
        if name not in defaulted:
            defaulted.append(name)
    if dropped:
        report.setdefault('dropped', {})[table] = dropped
    names = ', '.join(f'"{k}"' for k in values)
    marks = ', '.join('?' for _ in values)
    cur = conn.execute(f'INSERT INTO "{table}" ({names}) VALUES ({marks})', list(values.values()))
    return cur.lastrowid


def main(argv):
    if len(argv) < 3:
        print(__doc__, file=sys.stderr)
        return 2
    db_path, rows_path = argv[1], argv[2]
    report_path = argv[argv.index('--report') + 1] if '--report' in argv else None
    with open(rows_path, encoding='utf-8') as fh:
        rows = json.load(fh)['rows']
    if not rows:
        raise SystemExit('FAIL: no rows to seed')

    conn = sqlite3.connect(db_path)
    conn.isolation_level = None
    report = {'db': db_path, 'requested': len(rows), 'handles': 0, 'chats': 0, 'messages': 0}
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    for needed in ('handle', 'chat', 'chat_handle_join', 'message', 'chat_message_join'):
        if needed not in tables:
            raise SystemExit(f'FAIL: {db_path} has no {needed} table; is this a Messages store?')

    register_trigger_stubs(conn, report)
    before = conn.execute('SELECT COUNT(*) FROM message').fetchone()[0]
    conn.execute('BEGIN')
    handle_ids, chat_ids = {}, {}
    for row in rows:
        sender = row['sender']
        if sender not in handle_ids:
            existing = conn.execute('SELECT ROWID FROM handle WHERE id = ? AND service = ?', (sender, 'SMS')).fetchone()
            if existing:
                handle_ids[sender] = existing[0]
            else:
                handle_ids[sender] = insert(conn, 'handle', {
                    'id': sender, 'country': 'ae', 'service': 'SMS', 'uncanonicalized_id': None, 'person_centric_id': None,
                }, report)
                report['handles'] += 1
            chat_guid = f'SMS;-;{sender}'
            existing_chat = conn.execute('SELECT ROWID FROM chat WHERE guid = ?', (chat_guid,)).fetchone()
            if existing_chat:
                chat_ids[sender] = existing_chat[0]
            else:
                chat_ids[sender] = insert(conn, 'chat', {
                    'guid': chat_guid, 'style': 45, 'state': 3, 'account_id': None, 'chat_identifier': sender,
                    'service_name': 'SMS', 'room_name': None, 'account_login': None, 'is_archived': 0,
                    'last_addressed_handle': '', 'display_name': None, 'group_id': str(uuid.uuid4()).upper(),
                    'is_filtered': 0, 'successful_query': 1, 'original_group_id': str(uuid.uuid4()).upper(),
                    'last_read_message_timestamp': 0, 'is_blackholed': 0, 'is_recovered': 0,
                }, report)
                report['chats'] += 1
                insert(conn, 'chat_handle_join', {'chat_id': chat_ids[sender], 'handle_id': handle_ids[sender]}, report)

        if conn.execute('SELECT 1 FROM message WHERE guid = ?', (row['guid'],)).fetchone():
            report['skipped_existing'] = report.get('skipped_existing', 0) + 1
            continue
        when = apple_ns(row['date'])
        message_id = insert(conn, 'message', {
            'guid': row['guid'], 'text': row['body'], 'attributedBody': attributed_body(row['body']),
            'replace': 0, 'service_center': None, 'handle_id': handle_ids[sender], 'subject': None, 'country': 'ae',
            'version': 10, 'type': 0, 'service': 'SMS', 'account': None, 'account_guid': None, 'error': 0,
            'date': when, 'date_read': when, 'date_delivered': 0, 'is_delivered': 1, 'is_finished': 1, 'is_emote': 0,
            'is_from_me': 0, 'is_empty': 0, 'is_delayed': 0, 'is_auto_reply': 0, 'is_prepared': 0, 'is_read': 1,
            'is_system_message': 0, 'is_sent': 0, 'has_dd_results': 0, 'is_service_message': 0, 'is_forward': 0,
            'was_downgraded': 0, 'is_archive': 0, 'cache_has_attachments': 0, 'cache_roomnames': None,
            'was_data_detected': 1, 'was_deduplicated': 0, 'is_audio_message': 0, 'is_played': 0, 'date_played': 0,
            'item_type': 0, 'other_handle': 0, 'group_title': None, 'group_action_type': 0, 'share_status': 0,
            'share_direction': 0, 'is_expirable': 0, 'expire_state': 0, 'message_action_type': 0, 'message_source': 0,
            'associated_message_guid': None, 'associated_message_type': 0, 'balloon_bundle_id': None,
            'payload_data': None, 'expressive_send_style_id': None, 'associated_message_range_location': 0,
            'associated_message_range_length': 0, 'time_expressive_send_played': 0, 'message_summary_info': None,
            'ck_sync_state': 0, 'ck_record_id': None, 'ck_record_change_tag': None, 'destination_caller_id': None,
            'is_corrupt': 0, 'reply_to_guid': None, 'sort_id': 0, 'is_spam': 0, 'has_unseen_mention': 0,
            'thread_originator_guid': None, 'thread_originator_part': None, 'syndication_ranges': None,
            'synced_syndication_ranges': None, 'was_delivered_quietly': 0, 'did_notify_recipient': 0,
            'date_retracted': 0, 'date_edited': 0, 'was_detonated': 0, 'part_count': 1, 'is_stewie': 0,
            'is_kt_verified': 0, 'is_sos': 0, 'is_critical': 0, 'bia_reference_id': None, 'fallback_hash': None,
            'schedule_type': 0, 'schedule_state': 0, 'sent_or_received_off_grid': 0, 'is_pending_satellite_send': 0,
            'needs_relay': 0,
        }, report)
        insert(conn, 'chat_message_join', {'chat_id': chat_ids[sender], 'message_id': message_id, 'message_date': when}, report)
        report['messages'] += 1
    conn.execute('COMMIT')
    after = conn.execute('SELECT COUNT(*) FROM message').fetchone()[0]
    report['message_rows_before'] = before
    report['message_rows_after'] = after
    conn.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    conn.close()
    if after - before != report['messages']:
        raise SystemExit(f"FAIL: expected {report['messages']} new message rows, store grew by {after - before}")
    summary = json.dumps(report, indent=2)
    if report_path:
        with open(report_path, 'w', encoding='utf-8') as fh:
            fh.write(summary + '\n')
    print(summary)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
