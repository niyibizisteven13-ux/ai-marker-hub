import json
import os
import subprocess
import time
import urllib.request
from pathlib import Path

import uiautomator2 as u2

BASE = 'http://127.0.0.1:4897'
OUT = Path('phone-proof')
OUT.mkdir(exist_ok=True)
def api(path, body=None, key=''):
    req = urllib.request.Request(BASE+'/room/api/'+path, data=None if body is None else json.dumps(body).encode(), headers={'Content-Type':'application/json','Authorization':'Bearer '+key})
    with urllib.request.urlopen(req, timeout=15) as res:
        return json.load(res)

def until(check, timeout=80):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        value = check()
        if value: return value
        time.sleep(1)
    raise AssertionError('Phone did not reach expected state')

d=u2.connect()
app='space.bwenge.myseb'
def label(text):
    for item in (d(text=text),d(description=text)):
        if item.exists:return item
def shot(name):
    d.screenshot(str(OUT / (name+'.png')))
def main():
    r=api('',{'title':'Phone assessment','mode':'single','url':'https://example.org/','minutes':30})
    code,key=r['code'],r['host']
    def people():return api(code,key=key)['members']
    d.app_start(app,stop=True)
    until(lambda:label('MySEB')).long_click(duration=1)
    field=d(className='android.widget.EditText')
    field.set_text(BASE)
    until(lambda:label('Save')).click()
    until(lambda:label('Room')).click()
    until(lambda:d(className='android.widget.EditText').count>=2)
    fields=d(className='android.widget.EditText')
    fields[0].set_text(code)
    fields[1].set_text('Android phone')
    if d.info.get('currentPackageName')!=app:raise AssertionError('Wrong foreground app')
    d.press('back') if 'mInputShown=true' in d.shell('dumpsys input_method').output else None
    until(lambda:label('Join room')).click()
    until(lambda:any(m['applied']==1 and m['current_site']=='https://example.org' for m in people()))
    shot('android-approved-site')
    assert d.app_current()['package']==app
    d.press('back')
    until(lambda:label('Request exit')).click()
    member=until(lambda:next((m for m in people() if m['request']=='exit'),None))
    shot('android-exit-request')
    api(code+'/review',{'id':member['id'],'request':'exit','action':'release'},key)
    until(lambda:label('Join room'))
    shot('android-after-release')
    print('Installed APK passed on Android: join, HTTPS activity, native acknowledgement, system Back, exit request and individual release.')
try:
    main()
finally:
    shot('android-last-screen')
    (OUT/'accessibility.xml').write_text(d.dump_hierarchy())
