# 2.5.0 release

Changes: selected-date cleanup before 2026-10-01, recovery backups, date folders on
Desktop, durable SQLite booking storage, quota/save error handling, removal of the
legacy blanket booking reset, cheaper range counting, and booking API registration.
The backend change must also be deployed to the API server for remote booking backups
to work; shipping the desktop installer alone cannot update the server.

Windows Smart App Control on the current development laptop blocked electron-builder's
temporary uninstaller executable. The `.exe.incomplete` file is not a usable installer.
Do not publish it or the old `latest.yml` left by an earlier release. Do not disable
Windows security to build. The supplied Windows CI workflow builds the installer and
uploads assets without publishing a GitHub Release.

## Push the reviewed source (PowerShell, repository root)

```powershell
git status --short
git add .gitignore .github/workflows/windows-installer.yml package.json package-lock.json backend/server.js frontend/package.json frontend/package-lock.json frontend/electron frontend/src/components/BookingPanel.js frontend/src/index.js frontend/src/services/api.js frontend/src/utils/dateStorage.js frontend/src/utils/dateStorage.test.js frontend/src/utils/localDataPolicy.js frontend/src/utils/localDraftStorage.js docs/RELEASE_2.5.0.md
git diff --cached --stat
git commit -m "Release 2.5.0: date-wise local storage and booking reliability"
git push origin HEAD
git tag -a v2.5.0 -m "Release 2.5.0"
git push origin v2.5.0
```

Do not force-update an existing tag. Tag push starts **Build Windows Installer**.
In GitHub Actions open that run and download its `windows-installer` artifact after
it succeeds. It contains the setup EXE, its blockmap and a matching `latest.yml`.
Installer binaries belong in GitHub Release assets, not in the source-code commit.

## Download and prepare a draft release (GitHub CLI)

```powershell
gh run list --workflow windows-installer.yml --limit 5
```

Use the run ID for your newly pushed tag, then:

```powershell
gh run watch RUN_ID --exit-status
gh run download RUN_ID --name windows-installer --dir frontend/release-ci/2.5.0
gh release create v2.5.0 "frontend/release-ci/2.5.0/Lottery-Booking-Setup-2.5.0.exe" "frontend/release-ci/2.5.0/Lottery-Booking-Setup-2.5.0.exe.blockmap" frontend/release-ci/2.5.0/latest.yml --verify-tag --draft --title "Lottery Booking 2.5.0" --notes "Date-wise local storage, automatic selected-date cleanup and booking reliability fixes."
```

Inspect/install-test the release in an appropriate test environment, then publish
the draft in GitHub Releases. The installer is unsigned under the existing project
configuration; Windows may require a trusted signature on managed machines.
