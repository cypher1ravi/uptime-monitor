# Deploy to Google Cloud (free tier)

Runs every minute on Cloud Run jobs, triggered by Cloud Scheduler. Replace `PROJECT_ID`. **Set a budget alert first.**

```bash
gcloud config set project PROJECT_ID
gcloud services enable run.googleapis.com cloudscheduler.googleapis.com pubsub.googleapis.com \
  bigquery.googleapis.com firestore.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com
```

## 1. Storage: BigQuery for history, Firestore for "last known state"

```bash
bq --location=asia-south1 mk --dataset PROJECT_ID:uptime
bq mk --table --time_partitioning_field ts --time_partitioning_type DAY \
  PROJECT_ID:uptime.checks infra/bigquery-schema.json

gcloud firestore databases create --location=asia-south1
```

## 2. Pub/Sub topic with a BigQuery subscription

```bash
gcloud pubsub topics create uptime-checks
gcloud pubsub topics create uptime-checks-deadletter
gcloud pubsub subscriptions create uptime-checks-deadletter-sub --topic uptime-checks-deadletter

PROJECT_NUMBER=$(gcloud projects describe PROJECT_ID --format='value(projectNumber)')
bq add-iam-policy-binding --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com" \
  --role=roles/bigquery.dataEditor PROJECT_ID:uptime.checks

gcloud pubsub subscriptions create uptime-checks-to-bq --topic uptime-checks \
  --bigquery-table=PROJECT_ID:uptime.checks --use-table-schema \
  --dead-letter-topic=uptime-checks-deadletter --max-delivery-attempts=5
```

## 3. Service account for the job

```bash
gcloud iam service-accounts create uptime-runner
SA=uptime-runner@PROJECT_ID.iam.gserviceaccount.com
gcloud pubsub topics add-iam-policy-binding uptime-checks --member="serviceAccount:$SA" --role=roles/pubsub.publisher
gcloud projects add-iam-policy-binding PROJECT_ID --member="serviceAccount:$SA" --role=roles/datastore.user
gcloud projects add-iam-policy-binding PROJECT_ID --member="serviceAccount:$SA" --role=roles/run.invoker
```

## 4. Telegram bot (free alerts)

1. In Telegram, message **@BotFather** → `/newbot` → copy the token.
2. Send any message to your new bot, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `chat.id`.
3. Store the token as a secret:

```bash
printf "%s" "<TOKEN>" | gcloud secrets create telegram-token --data-file=-
gcloud secrets add-iam-policy-binding telegram-token --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor
```

## 5. Deploy the Cloud Run job

```bash
gcloud run jobs deploy uptime-check --source . --region asia-south1 \
  --service-account $SA --max-retries 0 --task-timeout 60s --memory 256Mi \
  --set-env-vars SINK=pubsub,PUBSUB_TOPIC=uptime-checks,STATE_STORE=firestore,TELEGRAM_CHAT_ID=<CHAT_ID> \
  --set-secrets TELEGRAM_BOT_TOKEN=telegram-token:latest

gcloud run jobs execute uptime-check --region asia-south1 --wait   # test one run
```

## 6. Run it every minute with Cloud Scheduler

```bash
gcloud scheduler jobs create http uptime-every-minute --location asia-south1 \
  --schedule "* * * * *" --http-method POST \
  --uri "https://run.googleapis.com/v2/projects/PROJECT_ID/locations/asia-south1/jobs/uptime-check:run" \
  --oauth-service-account-email $SA
```

## 7. Example queries

```sql
-- Uptime % and average response time per site (last 30 days)
SELECT site,
  ROUND(100 * COUNTIF(up) / COUNT(*), 3) AS uptime_pct,
  ROUND(AVG(IF(up, response_ms, NULL))) AS avg_ms
FROM `PROJECT_ID.uptime.checks`
WHERE ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
GROUP BY site;

-- Incidents (failed checks) this week
SELECT ts, site, error FROM `PROJECT_ID.uptime.checks`
WHERE ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY) AND NOT up
ORDER BY ts DESC;
```
