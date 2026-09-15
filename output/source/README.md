# Public-policy source handoff

`upticklocal-policy.bundle` preserves the two reviewed local commits for `braydenokley13-ux/upticklocal`:

- `788293e558b24a7d500278755c56323933c69ef0` — policy alignment.
- `d8098df7cd163ae02c7dd16574643aafe63f0585` — exact SMS templates and verified phone correction.

This is an incremental Git bundle. The receiving public repository must contain base commit `6e6f135a44c0ab63b89abecfd6f1d82272bfa253`. It contains no dependency folders, build output or environment files. `git bundle verify` passed in the originating repository.

## Restore for review

1. Open Terminal in an existing local checkout of the public `upticklocal` repository, with the base above present. These commands belong in that repository, not the platform repository.
2. Verify the bundle:

   ```sh
   git bundle verify /Users/braydenwhite/Desktop/uptick-platform-v0/output/source/upticklocal-policy.bundle
   ```

3. Import it as a local review branch:

   ```sh
   git fetch /Users/braydenwhite/Desktop/uptick-platform-v0/output/source/upticklocal-policy.bundle refs/heads/codex/real-enrollment-policy:refs/heads/codex/real-enrollment-policy
   ```

4. Review the two commits before merging or publishing. The original temporary checkout already has this branch; it does not need an import.

No push, merge or public deployment was performed. A full-history bundle was abandoned because of local disk space; this verified incremental bundle preserves all of the policy changes without copying unrelated history.
