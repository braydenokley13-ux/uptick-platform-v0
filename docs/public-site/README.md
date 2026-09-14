# Public-site pilot alignment archive

This directory preserves the public-site copy alignment made in the temporary `uptick-local` clone.

- Public base commit: `7b453a5f765bbb022f2e916dce0f4f0ea63e9717`
- Public alignment commit: `e6174b72a598c5949b3680ada23ac313574e8530`
- Branch name: `codex/pilot-service-alignment`
- Patch: `0001-Align-public-pilot-service-copy.patch`
- Bundle: `upticklocal-pilot-service-alignment.bundle`
- Bundle verification record: `BUNDLE_VERIFY.txt`
- Standalone policy-blocker copy: `PILOT_POLICY_BLOCKERS.md`

The bundle was verified with `git bundle verify`. It contains the alignment branch and records the public base commit as its prerequisite.

To reconstruct in a checkout that contains the base commit:

```sh
git fetch /path/to/upticklocal-pilot-service-alignment.bundle codex/pilot-service-alignment:codex/pilot-service-alignment
git switch codex/pilot-service-alignment
```

Alternatively, start at the base commit and apply the mail-formatted patch:

```sh
git switch --detach 7b453a5f765bbb022f2e916dce0f4f0ea63e9717
git am /path/to/0001-Align-public-pilot-service-copy.patch
```

## SHA-256

```text
78825dcbb6be8b0711fd270990a0b2781b0e39b781a731193c76c38b1086251e  0001-Align-public-pilot-service-copy.patch
74fafbe195d79f5228d5af6974c7d38683a2dd31955a79fe0795044980552101  upticklocal-pilot-service-alignment.bundle
6a227f50301d11b69a1807ee598494c939ef59489821f21f3b616490c4e35c77  PILOT_POLICY_BLOCKERS.md
```
