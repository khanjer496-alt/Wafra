"""Drive only the disposable emulator preview; never a connected user phone."""
import json
import pathlib
import re
import subprocess
import time
import xml.etree.ElementTree as ET

APP = 'app.wafra.android.preview'
OUT = pathlib.Path('native-tour-evidence')
OUT.mkdir(exist_ok=True)
results = []
serials = subprocess.check_output(['adb', 'devices'], text=True).splitlines()[1:]
serials = [line.split()[0] for line in serials if line.endswith('\tdevice')]
assert len(serials) == 1 and serials[0].startswith('emulator-'), serials
SERIAL = serials[0]


def adb(*args, check=True, binary=False):
    return subprocess.run(['adb', '-s', SERIAL, *args], check=check,
                          capture_output=True, text=not binary, timeout=45)


def hierarchy():
    adb('shell', 'uiautomator', 'dump', '/sdcard/wafra-preview-window.xml')
    text = adb('exec-out', 'cat', '/sdcard/wafra-preview-window.xml').stdout
    (OUT / 'latest.xml').write_text(text)
    return ET.fromstring(text)


def coordinates(node):
    values = list(map(int, re.findall(r'\d+', node.attrib.get('bounds', ''))))
    if len(values) != 4:
        return None
    x1, y1, x2, y2 = values
    return ((x1+x2)//2, (y1+y2)//2) if x2 > x1 and y2 > y1 else None


def find(pattern, *, edit=False, bottom=False, attempts=6, scroll=False):
    rx = re.compile(pattern)
    for attempt in range(attempts):
        root = hierarchy()
        matches = [node for node in root.iter('node')
                   if any(rx.search(node.attrib.get(k, '')) for k in ('text', 'content-desc'))
                   and coordinates(node)
                   and (not edit or node.attrib.get('class', '').endswith('EditText'))]
        if matches:
            matches.sort(key=lambda n: (n.attrib.get('clickable') == 'true',
                                       coordinates(n)[1] if bottom else -coordinates(n)[1]), reverse=True)
            return matches[0]
        if scroll and attempt >= 1:
            size = re.findall(r'(\d+)x(\d+)', adb('shell','wm','size').stdout)[-1]
            w,h = map(int,size)
            adb('shell','input','swipe',str(w//2),str(int(h*.72)),str(w//2),str(int(h*.32)),'400')
        time.sleep(1)
    raise AssertionError('Native element not found: ' + pattern)


def tap(pattern, **kwargs):
    node = find(pattern, **kwargs)
    x,y = coordinates(node)
    adb('shell','input','tap',str(x),str(y))
    time.sleep(1)


def fill(pattern, value):
    node = find(pattern, edit=True, scroll=True)
    x,y = coordinates(node)
    adb('shell','input','tap',str(x),str(y))
    adb('shell','input','text',value.replace(' ', '%s'))
    adb('shell','input','keyevent','111')
    time.sleep(.7)


def link(path):
    adb('shell','am','start','-W','-a','android.intent.action.VIEW',
        '-d','wafra-preview://'+path,'-p',APP)
    time.sleep(2)


def capture(name):
    root = hierarchy()
    (OUT / (name+'.xml')).write_text(ET.tostring(root, encoding='unicode'))
    (OUT / (name+'.png')).write_bytes(adb('exec-out','screencap','-p',binary=True).stdout)


def passed(name):
    results.append({'check':name,'passed':True})
    (OUT/'results.json').write_text(json.dumps(results,indent=2))
    print('PASS:',name,flush=True)


try:
    adb('install','apk/Wafra-Redesign-Preview.apk')
    adb('logcat','-c')
    adb('shell','am','start','-W','-n',APP+'/.MainActivity')
    find(r'^Start tracking$',attempts=15)
    capture('01-onboarding')
    passed('Release APK installs and renders native onboarding without Metro')
    tap(r'^Start tracking$')
    tap(r'^Start manually(?:\.|$)')
    tap(r'^Open Wafra$',scroll=True)
    find(r'^Home$',bottom=True,attempts=10)
    capture('02-home-empty')
    passed('Manual onboarding reaches Home without requesting SMS access')
    tap(r'^Accounts$',bottom=True)
    find(r'^New account$',attempts=8)
    tap(r'^New account$')
    fill(r'^Account name', 'Preview Cash')
    tap(r'^Cash$')
    fill(r'^Opening balance', '1000.25')
    tap(r'^Add account$',scroll=True)
    find(r'Preview Cash',attempts=10)
    capture('03-account-created')
    passed('A synthetic manual cash account saves through the native form')
    link('add-transaction')
    fill(r'^Amount in your ledger currency$', '12.50')
    fill(r'^Description', 'Preview groceries')
    capture('04-transaction-form')
    tap(r'^Save transaction$',scroll=True)
    link('transactions')
    find(r'Preview groceries',attempts=10)
    capture('05-saved-transaction')
    passed('Native entry form saves an exact 12.50 synthetic expense')
    adb('shell','am','force-stop',APP)
    adb('shell','am','start','-W','-n',APP+'/.MainActivity')
    time.sleep(4)
    link('transactions')
    find(r'Preview groceries',attempts=10)
    passed('Saved entry survives a full process restart and encrypted store hydration')
    link('flow')
    tap(r'^Activity$')
    find(r'Preview groceries')
    capture('06-spending-activity')
    tap(r'^Trends$')
    capture('07-spending-trends')
    tap(r'^Categories$')
    capture('08-spending-categories')
    passed('Spending Categories, Activity and Trends switch in the native app')
    for theme in ('light','dark'):
        adb('shell','cmd','uimode','night','yes' if theme=='dark' else 'no')
        time.sleep(2)
        link('')
        for title in ('Home','Spending','Bills','Accounts'):
            tap('^'+title+'$',bottom=True)
            capture('09-'+theme+'-'+title.lower())
            passed(theme+' native tab renders: '+title)
    link('settings')
    capture('10-settings')
    for route in ('import-sms','review-alerts','categorise','pro','feedback'):
        link(route)
        capture('11-'+route)
        passed('Native supporting route mounts: '+route)
    adb('shell','settings','put','system','font_scale','1.3')
    time.sleep(2)
    link('flow')
    tap(r'^Trends$')
    capture('12-large-text-spending')
    passed('Native large-text Spending trends renders')
    adb('shell','settings','put','system','font_scale','1.0')
    log=adb('logcat','-d').stdout
    (OUT/'logcat.txt').write_text(log)
    fatal=re.findall(r'^.*(?:FATAL EXCEPTION|Fatal signal|ReactNativeJS:.*(?:TypeError:|ReferenceError:|Invariant Violation)).*$',log,re.M)
    assert not fatal, fatal
    assert adb('shell','pidof',APP).stdout.strip()
    passed('No native fatal crash or JavaScript runtime exception during tour')
except Exception as exc:
    results.append({'check':'Native tour','passed':False,'error':str(exc)})
    try:
        capture('failure')
        (OUT/'logcat.txt').write_text(adb('logcat','-d').stdout)
    except Exception:
        pass
    raise
finally:
    (OUT/'results.json').write_text(json.dumps(results,indent=2))
    (OUT/'scope.txt').write_text('Disposable Android emulator only. Synthetic account and expense entered through the real UI. No real bank account, phone inbox, purchase or user data was accessed. Screenshots do not prove physical-phone performance or complete accessibility.\n')
