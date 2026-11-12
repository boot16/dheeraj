# Dheeraj Wholesale on Firebase

Use a dedicated Firebase project for this shop. The app uses Firebase Hosting, email/password Authentication, Firestore and a Node.js 22 callable function in Mumbai (asia-south1). Firestore denies direct browser access. The callable checks the configured owner UID and posts stock and ledger changes in a Firestore transaction.

## Deploy

1. Create a dedicated Firebase project, upgrade it to Blaze, and create the default Firestore database. Choose a region close to the function where available.
2. In Authentication, enable Email/Password and add the owner's account. Copy that user's UID.
3. From the repository's firebase-app directory, run the commands below. Use your actual project ID. When asked for WHOLESALE_OWNER_UID, enter the UID from Authentication. Do not commit generated environment files.

```sh
npm install -g firebase-tools
firebase login
npm --prefix functions install
firebase deploy --project YOUR_PROJECT_ID --only firestore:rules,functions,hosting
```

Open the Hosting URL printed by Firebase CLI. Sign in using the same owner account on both devices. The app loads the latest data on sign-in or refresh and rejects writes from an outdated screen. If a save times out, retry the same form without reloading to reuse its request ID, or reload and check the ledger before re-entering it.

This is an empty, single-shop pilot. It currently loads the full product and transaction history and will need paginated reads as it grows. The existing HTML demo and SQLite records are separate. Confirm GST invoice requirements and test backup and recovery before entering live shop data.
