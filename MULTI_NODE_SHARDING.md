# Multi-Node Sharding and Aggregation

## Goal

Scale batch processing from single node to multi-node without duplicate processing and without losing records.

## Sharding Model

- Shard key: `shardId = hash(phone) % shardTotal`
- Task key: `taskKey = batchId:shardId`
- Each worker node receives one or more `taskKey` partitions.
- A phone can only be consumed by the node that owns its shard.

## Data Flow

1. Control plane creates a `batchId` and publishes `shardTotal`.
2. Scheduler assigns shard ownership to runner nodes.
3. Runner node pulls numbers for owned shards only.
4. Runner executes direct-first fallback query pipeline.
5. Runner reports result to aggregator with idempotent key: `batchId:phone`.
6. Aggregator stores unique result and updates metrics.

## Required Stores

- Queue: Redis Streams or RabbitMQ (recommended)
- Dedup/Idempotency: Redis SET with key `batch:{batchId}:done`
- Aggregated result: Postgres/ClickHouse/JSONL sink

## Fault Tolerance

- Heartbeat every 3-5 seconds per runner.
- If no heartbeat > 15 seconds, shard ownership is revoked.
- Unfinished shard tasks are re-assigned to healthy nodes.
- Aggregator idempotency prevents duplicate records on replay.

## Rebalancing Strategy

- Start static: fixed shard-to-node assignment.
- Rebalance only slow shards:
  - trigger when shard lag > 2x median lag for 60 seconds.
  - migrate one shard at a time to avoid thundering herd.

## Verification Checklist

1. Single batch on 2 nodes, `shardTotal=8`: verify no duplicate `phone`.
2. Kill one node mid-run: verify shard takeover within 30 seconds.
3. Replay completion payload: verify aggregator keeps one final record per `phone`.
4. Compare merged metrics with sum(node metrics): processed/hit/failed must match.

## Metrics to Track

- Throughput per node and global throughput
- Direct/Fallback ratio per shard
- Retry and error distribution per shard
- Shard lag, reassignment count, heartbeat loss events
