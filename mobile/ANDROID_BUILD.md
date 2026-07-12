# Android Build Contract

`mobile/android` is the canonical native Android project for PROOF by FRAME.
The package identity is `com.proofbyframe` and must not be renamed.

## Local debug build

Install dependencies, set `sdk.dir` in the ignored
`android/local.properties`, then run:

```bash
npm ci
cd android
./gradlew assembleDebug
```

## Release signing

Release builds fail closed unless all four local environment variables are
set:

```text
PROOF_ANDROID_KEYSTORE
PROOF_ANDROID_KEYSTORE_PASSWORD
PROOF_ANDROID_KEY_ALIAS
PROOF_ANDROID_KEY_PASSWORD
```

Optional version overrides are `PROOF_ANDROID_VERSION_CODE` and
`PROOF_ANDROID_VERSION_NAME`. The release keystore and its passwords must
remain outside the repository. Every Solana dApp Store update must use the
same release key and a monotonically increasing version code.

## World ID package access

The official Android SDK is published through World's GitHub Packages
repository. Local and CI builds need `GITHUB_ACTOR` plus a `GITHUB_TOKEN`
with read-only `read:packages` scope. These values are build credentials and
must not be added to `.env`, Gradle files, or the APK.

IDKit 4.0.5 requires Android 8.0 / API 26 or newer. The canonical Android build
therefore uses `minSdkVersion = 26`; do not force the library onto API 24-25.

## Source and artifact rules

- Do not commit `.env`, `local.properties`, keystores, APKs, AABs, Gradle
  caches, native build output, or generated Metro bundles.
- Do not copy Finder duplicate files with names ending in `(1)`.
- Validate the package, version, certificate fingerprint, and APK signature
  before installing on a physical device or submitting to a store.
