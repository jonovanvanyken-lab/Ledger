# Kč Ledger

A private budgeting app that runs on your phone or computer. Your data is encrypted with your passcode (PBKDF2-SHA256, 600,000 rounds → AES-GCM-256) and stored only on your device. The app has no server: its security policy only lets it load its own files, check exchange rates, and talk to GitHub if you turn on sync.

Works in English and Czech, with any currency.

## Put it online once (GitHub Pages, free)

1. Sign in at github.com and create a new **public** repository, e.g. `ledger`. The code is public; your data never is.
2. On the repository page choose **Add file → Upload files**, drag in everything from this folder (including the `icons`, `ocr` and `vendor` folders), and commit.
3. Go to **Settings → Pages**, set **Source** to *Deploy from a branch*, choose `main` and `/ (root)`, and save.
4. After a minute the app is at `https://<your-username>.github.io/<repository-name>/` (the name is case-sensitive).

Never upload backups, CSV exports, setup files or bank statements to this repository.

## Install on your phone

- **iPhone:** open the link in Safari or Chrome → Share → **Add to Home Screen**.
- **Android:** open the link in Chrome → ⋮ menu → **Install app**.

Open it from the home-screen icon, pick a language and choose a passcode. There is no passcode reset: if you forget it, only a backup can bring your data back.

## The setup questions

The first time you open it, a short questionnaire tailors the app: language and name, main and second currency, pay (amount, payday and time, or no regular pay), other regular income, whether each budget month follows the calendar or runs payday to payday, spending categories with monthly budgets, regular bills with due days and reminders, saving and investing targets and goals, your main bank and how to export from it, Face ID, auto-lock and backup reminders, and the optional child-expenses tracker. Every answer can be changed later in **Settings**, or you can go through the questions again from **Settings → You**.

## Getting transactions in

- **Czech banks and any other bank:** export the transaction history as CSV and use **Import a bank file** on the Entries tab. Raiffeisenbank exports are recognised automatically. For other banks the app shows which columns it found the first time so you can check them; after that it remembers.
- **Revolut and Wise:** their CSV statements are recognised automatically. Top-ups, currency exchanges and pending payments are left out.
- **Screenshots and receipts:** **Read a screenshot** turns a banking-app screenshot or a receipt into entries for you to check. Text recognition runs on the device (the first use loads about 10 MB).
- **By hand:** **Add an entry**.

Import every account's file together so transfers between your own accounts are left out.

## Health

The **Health** tab opens first. The face is green when everyday spending is on track and turns orange when it isn't. It takes what's left of the budget after spending so far and the bills still to come, divides it by the days left (including today), and compares that with the usual daily allowance.

## Child expenses (optional)

Turn it on in the questionnaire or **Settings → Child expenses**, and give the tab a name (for example "Eli expenses"). The tab only appears when it's on.

- Tick **For [child]** on any expense, with a split per expense (50/50 by default).
- Record what the other parent paid, repayments in either direction, and a starting balance.
- The running balance shows who owes whom. Repayments go to this balance rather than your income, and marked expenses still count in your own budget.
- **Send a statement** makes a PDF for any calendar month, with receipts if you like, or a text summary to paste into a message.
- **Suggestions** point out expenses that are probably for the child. They're worked out on the device from your own yes/no answers, and nothing is sent anywhere.

## Sync between devices

**Settings → Sync** keeps your phone and computer in step through a **private** GitHub repository (for example `ledger-data`), using a fine-grained access token limited to that one repository with Contents: read and write. Everything is encrypted on the device before upload, so GitHub only stores scrambled data. The token stays encrypted on each device and is never synced or put in backups. The app refuses to sync with a public repository. On a second device, choose **Join a synced ledger or restore a backup instead** at the start of the questionnaire.

## Backups

**Settings → Backup** saves an encrypted backup file that opens with your passcode. Keep it somewhere safe, such as iCloud Drive. **Export CSV** is not encrypted; delete it when you're done.

## Updating the app

Upload the changed files to the repository. The app checks for a new version each time it opens online.

## Credits

Text recognition: tesseract.js (Apache 2.0). PDF statements: jsPDF (MIT) with a subset of DejaVu Sans (free licence). Licences are in `ocr/` and `vendor/`.
