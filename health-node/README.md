---
title: Health Node US-East
emoji: 🖥️
colorFrom: green
colorTo: blue
sdk: docker
pinned: false
---

# Health Node — Server Telemetry Monitor

A tiny Express.js service that monitors its own CPU/memory and pushes metrics to MongoDB Atlas every 5 seconds.

## Endpoints
- `GET /` — alive check
- `GET /api/health` — current health snapshot
- `POST /api/load-balance` — send fix commands (restart, scale_down, spike)
- `POST /api/flush-cache` — cache flush mitigation
