# Benchmark

How fast the backend answers and how much memory it uses, measured from outside over HTTP only.
So the same `bench.mjs` measures the NestJS backend now and the Rust backend as it replaces it, and
the two can be compared on the same machine.

## Run it

You need what the e2e tests need: PostgreSQL with the `taskboard_test` database, and `backend/.env`.
It never touches your real tasks. Linux or WSL only (memory is read from `/proc`).

```bash
bash bench/nest.sh    # NestJS: builds it, starts it on port 3100, measures, stops it
```

It takes about a minute and saves its report in `results/` (one file per backend and day).

## What it measures

- **Start-up**: from starting the program until it answers its first request.
- **Memory**: the backend process's resident memory (what the system counts as in use): idle, after
  the one-at-a-time rounds, and the highest it reached under load.
- **One request at a time**: 300 of each common operation (after 30 to warm up), as one user would
  send them. p50 is the typical time (half were faster), p95 and p99 the slow ones.
- **Many at once**: the board query (a 50-task board with labels and checklists, like the frontend
  loads it) with 1, 10 and 50 requests in flight for 5 seconds each: how many requests per second
  it handles, and how long each one waits.

Before measuring, it makes a `bench@test.com` user with two boards (one to read, one to write to),
and it deletes the boards at the end.

## Reading the results

- Compare runs from the same machine only, and run each backend twice: on 2026-10-28 two NestJS runs
  differed by up to 20% on single-request times, but by 1% on memory and 6% on requests per second.
- The benchmark and the backend share the CPU, and the database is on the Windows side of WSL, so
  every request also pays for that trip. Both backends pay the same.
- A person browsing the board won't feel 3 ms against 8 ms. The bigger differences show in memory, and
  in requests per second when many arrive at once: NestJS levels off at about 250 per second whether
  10 or 50 are in flight, which looks like its one JavaScript thread being busy (not yet measured).
