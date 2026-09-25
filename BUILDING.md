# Building Tezkija

Everything here runs locally. No Expo/EAS account is needed for a release build
or a Play upload.

## Prerequisites

| Tool | Notes |
| --- | --- |
| Node | whatever `package.json` engines allow; `npm install` first |
| JDK 17 | `java -version` should say 17.x — newer JDKs break the Gradle plugin |
| Android SDK | `adb` and `emulator` on `PATH` |
| `credentials/` | the upload keystore — see [Signing](#signing) |

`android/` is **generated** and gitignored. Never edit it directly: the next
prebuild wipes it. Native config belongs in `app.json` or a plugin.

## Day-to-day development

```sh
npm install
npx expo start          # Metro; open in a dev client
```

Local notifications need a real device or emulator, not Expo Go on web.

## Release APK — for sideloading onto your own devices

```sh
./android/gradlew -p android assembleRelease
# -> android/app/build/outputs/apk/release/app-release.apk
```

`assembleRelease` re-bundles the JS every time, so that alone picks up any
JS/TS change. Prebuild first **only** when native config changed — `app.json`,
a plugin, or a new native dependency:

```sh
npx expo prebuild -p android --clean
```

`--clean` deletes and regenerates `android/`, turning a ~40s build into a ~5min
one. It also wipes `android/app/build/outputs/`, so any APK sitting there
disappears — including one a local web server is currently serving.

> Never run a prebuild and a Gradle build at the same time. They share
> `android/`, and whichever starts second pulls the directory out from under the
> first. The symptom is an unexplained `BUILD FAILED` or a vanished APK.

Install over USB:

```sh
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

Or hand it to a phone on the same network:

```sh
python3 -m http.server 8000 --directory android/app/build/outputs/apk/release
# then browse to http://<your-lan-ip>:8000/app-release.apk
```

`--directory` serves that folder without moving the shell, and the server reads
from disk per request — rebuild the APK and just reload on the phone, no
restart needed. Find the LAN address with `ipconfig getifaddr en0`.

Stop it with Ctrl-C. If the port is still held — a server left running in
another window, or one you have lost track of — "Address already in use" is
what you get, and this clears it:

```sh
lsof -ti:8000              # what is holding the port
lsof -ti:8000 | xargs kill # stop it
lsof -ti:8000 | xargs kill -9   # if it will not go
```

`lsof -ti` prints bare PIDs, which is what makes the pipe into `kill` work.
Serving on a different port (`8001`, `9000`) sidesteps the whole thing.

The phone needs "install unknown apps" allowed for whichever browser downloads
it. **Uninstall any older Tezkija first** — a build signed with a different
key cannot install over one that isn't.

## Release AAB — for Play

```sh
npx expo prebuild -p android --clean
./android/gradlew -p android bundleRelease
# -> android/app/build/outputs/bundle/release/app-release.aab
```

Upload that file in Play Console. Confirm it is signed with the upload key and
not the debug key:

```sh
keytool -printcert -jarfile android/app/build/outputs/bundle/release/app-release.aab
```

Expected owner: whatever the Tezkija upload key was generated with — record
it here once the key exists (this app must not reuse the Daily Qur’an key).

If the owner comes back as `CN=Android Debug`, the signing plugin didn't run —
see below.

## Signing

The Expo template signs release builds with the **debug** keystore, which Play
rejects. `plugins/with-release-signing.js` replaces that on every prebuild:
it writes the credentials into `android/gradle.properties` and points the
`release` buildType at a `release` signingConfig.

Credentials live in `credentials/` (gitignored):

```
credentials/upload-keystore.jks        PKCS12, RSA 2048, alias "upload"
credentials/android-upload-key.json    path, alias and passwords
```

If `credentials/android-upload-key.json` is absent the plugin prints a warning
and does nothing, so a fresh clone still builds for an emulator without the
secret — but the output is debug-signed and not uploadable.

> **Back `credentials/` up somewhere outside this repo.** It is gitignored, so
> cloning or deleting the project loses it. Recovery is possible once you are
> enrolled in Play App Signing — Google holds the real app signing key and can
> reset the upload key — but it is a support round-trip.

## Before every Play upload

**Bump `android.versionCode` in `app.json`.** Play rejects a versionCode it has
already seen, and nothing increments it automatically for local builds. Bump
`version` too when the user-facing release changes.

**Then prebuild.** `versionCode`/`version` are baked into
`android/app/build.gradle` at prebuild time — Gradle never reads `app.json`.
A plain `npx expo prebuild -p android` (no `--clean`) is enough and keeps the
build cache; check with `grep versionCode android/app/build.gradle` before
`bundleRelease`.

(`eas.json` still declares `appVersionSource: "remote"`. That only applies to
EAS builds, which no longer produce the artifacts you ship. If you ever go back
to EAS, reconcile the two.)

## No EAS

`app.json` carries no `extra.eas.projectId`. Run `eas init` only if cloud
builds are ever wanted; local builds and Play uploads don't need it.
