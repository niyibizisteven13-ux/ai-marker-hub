"""Use an existing release key from Actions secrets; never generate a new key per update."""
import base64
import os
from pathlib import Path

key = os.environ.get('KEYSTORE', '')
if not key:
    print('No persistent Android signing key configured. Build available for testing; in-app updates will not be advertised.')
    raise SystemExit(0)
for name in ['STORE_PASSWORD', 'KEY_ALIAS', 'KEY_PASSWORD']:
    if not os.environ.get(name):
        raise SystemExit(f'Missing Android signing secret: {name}')
store = Path(os.environ['RUNNER_TEMP']) / 'myseb-release.jks'
store.write_bytes(base64.b64decode(key, validate=True))
store.chmod(0o600)
project = Path('android/app/build.gradle.kts')
if not project.exists():
    raise SystemExit('Expected Flutter Kotlin Gradle runner for persistent signing.')
s = project.read_text()
# Put declarations after plugins; use environment values only so credentials never enter source or logs.
s = s.replace('    buildTypes {', '''    signingConfigs {
        create("mysebRelease") {
            storeFile = file(System.getenv("RUNNER_TEMP") + "/myseb-release.jks")
            storePassword = System.getenv("STORE_PASSWORD")
            keyAlias = System.getenv("KEY_ALIAS")
            keyPassword = System.getenv("KEY_PASSWORD")
        }
    }
    buildTypes {''')
s = s.replace('signingConfigs.getByName("debug")', 'signingConfigs.getByName("mysebRelease")')
project.write_text(s)
