# Dheeraj Wholesale on Firebase Spark

The app uses Firebase Hosting, Email/Password Authentication, and Firestore. Cloud Functions are not deployed. Keep the project on Spark and use the same owner account on both devices.

## One-time setup

1. In Firebase Authentication, enable Email/Password, create the owner user and copy its UID.
2. In Cloud Firestore → Data, create collection `wholesaleAccess`, document `owner`, and a string field `uid` containing that UID. Use the default database. Only a Firebase Console administrator can provision this record.
3. From this `firebase-app` directory, deploy:

```powershell
firebase deploy --project dheeraj-b855a --only "firestore:rules,hosting"
```

Open the Hosting URL and sign in. The app starts with an empty shop. Test purchases, sales and collections with sample records first.

## Scope

A save writes the affected products, journal entry (when applicable), revision and retry receipt in one online transaction. The app rejects stale saves. Refresh to see changes from the other device. If a save times out, retry the same form before refreshing or check the journal before re-entering it.

Rules authorize only the configured owner, block deletions and journal edits, and validate basic fields and transaction sequencing. The trusted owner's browser calculates totals and inventory movements. Rules do not independently recalculate every line or prove every stock delta matches the bill. Bills are limited to twelve lines, and the app reads the full workspace on refresh and after saves. The invoice is still a demo format. The old Cloud Functions sources remain for reference and are excluded from deployment.
