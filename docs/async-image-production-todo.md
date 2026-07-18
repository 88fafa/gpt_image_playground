# Async Image Production TODO

The active release checklist is maintained in `docs/async-image-next-steps.md`.

Remaining scale and deployment work:

- Measure memory usage for large multipart image edits.
- Use a shared database, object storage, and a distributed queue before running multiple replicas.
- Add metrics and alerts for queue depth, worker failures, upstream latency, timeout count, and free disk space.
- Add application authentication or signed file URLs when users must not be able to retrieve each other's task results.
