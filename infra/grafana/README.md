# Grafana Dashboards — Ghost Bot Metrics

Dashboard JSON + alert rules shipped with the **Metrics module** (roadmap item 16).
Import the JSON files through **Grafana → Dashboards → Import** (or provision them
via `grafana/provisioning/dashboards`). All panels query the Prometheus
datasource scraping the bot's guarded `GET /metrics` endpoint.

## Dashboards

| File                   | Title             | Covers                                                         |
| ---------------------- | ----------------- | -------------------------------------------------------------- |
| `process-runtime.json` | Process & Runtime | CPU, RSS, event-loop lag p99, GC, handles                      |
| `discord-gateway.json` | Discord Gateway   | shard state, latency p50/p95/p99, reconnects, rate-limit hits  |
| `api.json`             | API               | RPS by status, latency percentiles, error ratio                |
| `data-stores.json`     | Data Stores       | query duration percentiles, pool saturation, cache hit ratio   |
| `queues-jobs.json`     | Queues & Jobs     | queue depth, DLQ depth, job duration percentiles, failure rate |
| `feature-usage.json`   | Feature Usage     | top commands, per-module activity                              |

## Alerting

`alert-rules.yml` holds Prometheus recording + alert rules mirroring the module's
default thresholds (`ghost_event_loop_lag_seconds`, `ghost_queue_dlq_depth`).
Load it into Prometheus via `rule_files:` in `prometheus.yml`. Guild-scoped
threshold overrides are enforced in-app (they emit `metrics.threshold.breached`
on the event bus) and are complementary to these infra-level rules.

## Metric families

All metrics are prefixed `ghost_`. Names are defined once in
`src/modules/metrics/domain/metric-name.enum.ts` — keep PromQL here in sync with
that enum. Labels are intentionally low-cardinality (no user/guild-id-per-series,
no raw paths).

## Datasource variable

Every dashboard declares a `$DS_PROMETHEUS` datasource template variable so it
imports cleanly against any Prometheus datasource name.
