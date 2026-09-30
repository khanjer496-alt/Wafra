# Repeated page navigation

Observed mechanism: ordinary page controls called Expo Router `push` without a
singular identity. The installed SDK 55 stack reducer reproduces multiple copies
of Settings from consecutive identical pushes. This matches the reported need
to press Back twice; it is not physical-device proof of the original lag.

The shared app router now uses the SDK singular destination identity, including
sorted query parameters, for page pushes. Different records and filters remain
separate. An existing matching destination is reused, including its component
state, rather than creating another instance. Ordinary tab links dismiss to the
existing tab shell. The two Create account links explicitly preserve history so
an unfinished transaction survives the Wallet detour.

Verification:
- Six tests execute the installed SDK stack reducer and the real app-router hook.
- 52 focused tests pass across navigation, transaction keypad, tab clarity,
  detail screens, and everyday screens.
- Fresh web export succeeds.
- Browser regression: two Settings clicks in one event turn, one Back returns
  Home, then immediate reopening and Back succeeds.
- Independent read-only review identified the nested tab and draft-history
  cases; both were addressed for ordinary links and the form detour.

Native transition behavior, physical-device latency, and the complete native
create-account return flow remain unverified. History-preserving Wallet detours
can still mount a second tab shell intentionally. The broad repair-suite attempt
was stopped due to host resource pressure; it is not recorded as passing.
Verification was performed before the navigation fix was committed. No push or
publication was performed.
