# Noto Release Updates

Noto uses Sparkle 2 and GitHub Releases for app updates.

## Required GitHub Secrets

Configure these repository secrets before pushing a version tag:

- `SPARKLE_PUBLIC_ED_KEY`: the public EdDSA key embedded in `Noto.app/Contents/Info.plist`.
- `SPARKLE_PRIVATE_KEY`: the matching private EdDSA key used by `generate_appcast`.

Generate the key pair with Sparkle's `generate_keys` tool from a resolved Sparkle package:

```sh
.build/artifacts/sparkle/Sparkle/bin/generate_keys
```

Do not commit the private key.

## Create A Release

Push a semantic version tag:

```sh
git tag v0.2.0
git push origin v0.2.0
```

The release workflow builds `Noto.app`, packages `Noto-<version>.dmg`, signs the appcast entry with Sparkle, uploads the DMG to the GitHub Release, and commits `appcast.xml` back to `main`.
