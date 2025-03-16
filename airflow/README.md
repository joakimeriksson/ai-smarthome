# Airflow & Colonies
Some airflow and Colony-OS config files and python files for some of my "home automation"

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
