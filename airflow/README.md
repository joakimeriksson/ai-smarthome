# Airflow & Colonies
Some airflow and Colony-OS config files and python files for some of my "home automation"

# Colonies
For scheduling cronjobs in Colonies you will need the cronfiles "uploaded" into Colony OS file system.
```bash
>colonies fs sync -l cronfiles -d ./cronfiles --yes

[...]

>colonies fs ls --label /cronfiles
╭─────────────┬───────┬──────────────────────────────────────────────────────────────────┬─────────────────────┬───────────╮
│ FILENAME    │ SIZE  │ LATEST ID                                                        │ ADDED               │ REVISIONS │
├─────────────┼───────┼──────────────────────────────────────────────────────────────────┼─────────────────────┼───────────┤
│ spotmqtt.py │ 0 KiB │ 4ef56d7db2b0d4fa5e2ce5b73fde7dcb03f77fb92dcfb0a21591125f902497ee │ 2025-03-23 10:10:45 │ 1         │
╰─────────────┴───────┴──────────────────────────────────────────────────────────────────┴─────────────────────┴───────────╯
```


# Spotpris - update
For Colonies this spotprice update can be added as a cron-job by (once per hour):

```bash
>colonies cron add --name spotprisupdate --cron "0 0 * * * *" --spec ./cronspot.json

[ ... ]

>colonies cron ls
╭──────────────────────────────────────────────────────────────────┬────────────────┬───────────╮
│ CRONID                                                           │ NAME           │ INITIATOR │
├──────────────────────────────────────────────────────────────────┼────────────────┼───────────┤
│ 25689d269219ff19c58f7c1271d892a3fb43884cb3fc6799e35da04455df0eb3 │ spotprisupdate │ myuser    │
╰──────────────────────────────────────────────────────────────────┴────────────────┴───────────╯
```
