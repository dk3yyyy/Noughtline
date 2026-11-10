# Render persistent storage

Noughtline uses SQLite. On Render's free plan the filesystem is ephemeral, so
`/tmp/noughtline.db` is replaced on every deploy, restart, or idle spin-down.
Accounts, match history, quests and tournament state disappear with it.

The app now refuses to enable payments when `DATABASE_PATH` starts with
`/tmp`, so a paid reference cannot be accepted against a database that will
vanish.

## Recommended setup

Use a Starter web service plus a 1 GB persistent disk. This keeps the existing
SQLite code and costs about **$7/month for the service + $0.25/month for the
disk**.

`render.yaml` in this branch contains the exact configuration:

```yaml
    plan: starter
    disk:
      name: noughtline-data
      mountPath: /var/data
      sizeGB: 1
    envVars:
      - key: DATABASE_PATH
        value: /var/data/noughtline.db
```

## Dashboard steps

1. Open the Noughtline web service in Render.
2. Change the instance type from **Free** to **Starter**.
3. Add a disk named `noughtline-data`, mounted at `/var/data`, size **1 GB**.
4. Set `DATABASE_PATH=/var/data/noughtline.db`.
5. Save and wait for the blue-green deploy to finish.
6. Check `/api/health` and confirm the service starts without the
   `DATABASE_PATH is under /tmp` warning.
7. Only then set `PAYSTACK_SECRET_KEY` if payments should be live.

Render restarts a service while attaching a disk. Expect one deploy with a
short interruption.

## Why not free Postgres

Render's free Postgres expires **30 days after creation** and is deleted after a
short grace period. That is not durable storage for accounts or payments.

A paid Postgres instance starts around **$6/month**, but moving from
`better-sqlite3` to Postgres is a code migration. It is the better long-term
choice if the app needs multiple instances, backups, or meaningful traffic.
The disk is the smallest change that stops data loss today.

## Limits

- A disk is attached to one service instance. Do not scale Noughtline to
  multiple instances while SQLite is the database.
- Disk snapshots are daily, but test a restore before treating them as a backup.
- Increasing disk size later is supported; shrinking it is not.
