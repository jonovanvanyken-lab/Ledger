# Kč Ledger

A private spending and savings tracker that runs on your phone. Your data is encrypted with your passcode (PBKDF2-SHA256, 600,000 rounds → AES-GCM-256) and stored only on the phone. The app has no server and can't send data anywhere: its security policy only lets it load its own files.

## Put it online once (GitHub Pages, free)

1. Sign in at github.com and create a new **public** repository, e.g. `kc-ledger`. The code is public; your data never is.
2. On the repository page choose **Add file → Upload files**, drag in everything from this folder (including the `icons` folder), and commit.
3. Go to **Settings → Pages**, set **Source** to *Deploy from a branch*, choose `main` and `/ (root)`, and save.
4. After a minute your app is at `https://<your-username>.github.io/kc-ledger/`.

## Install on your phone

- **iPhone:** open the link in **Safari** → Share → **Add to Home Screen**.
- **Android:** open the link in **Chrome** → ⋮ menu → **Install app** (or Add to Home screen).

Open it from the home-screen icon, choose a passcode, then go to **Settings → Import** and pick `kc-ledger-starter.json`. Delete the starter file afterwards.

## Each month

Export **Movements** as CSV from Raiffeisen for both accounts, then **Settings → Import** and select both files together. Save an encrypted backup afterwards (**Settings → Backup**).

## Updating the app

Upload the changed files to the repository and change `VERSION` in `sw.js` so phones pick up the new version.
