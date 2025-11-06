# Immich Backup and Snapshot Summary

This document summarizes the discussion regarding the backup and snapshot strategy for the `immich` application within the Kubernetes cluster.

## Current State

*   **Application:** Immich (photo management application)
*   **Data Volumes:** `immich-profile` and `immich-thumbs` PersistentVolumeClaims (PVCs).
*   **Backup Mechanism:** VolSync is configured to perform `restic` backups of `immich-profile` and `immich-thumbs` data.
    *   **Restic Backups:** These are performed daily and are synchronized to an S3-compatible object store. The last `immich-thumbs` restic backup was successful on November 6, 2025, at 00:20:30 UTC.
    *   **Volume Snapshots:** A `VolumeSnapshot` named `volsync-immich-thumbs-thn-dest-dest-20251028133324` exists for the `immich-thumbs` backup destination. However, this snapshot was created on October 28, 2025, and is not being updated periodically.

## Analysis of Volume Snapshots

*   The `VolumeSnapshot` for `immich-thumbs` is currently configured with a `Manual: restore-once` trigger in its `ReplicationDestination` object. This means it was a one-time snapshot and is not being taken on a recurring schedule.
*   The `restic` backups (managed by `ReplicationSource`) are running daily, ensuring off-site disaster recovery.
*   The existing `VolumeSnapshot` is stale and does not provide recent point-in-time recovery on the cluster.

## Recommendation

It is generally recommended to implement **periodic Volume Snapshots** in addition to the existing `restic` backups.

*   **Benefits of Periodic Snapshots:**
    *   **Faster Recovery Time Objective (RTO):** Snapshots allow for near-instantaneous recovery from common operational issues (e.g., accidental deletion, data corruption) directly on the cluster.
    *   **Layered Data Protection:** Provides both quick on-cluster recovery options and robust off-site disaster recovery.
*   **Considerations:**
    *   Periodic snapshots will consume additional storage space on the Ceph cluster.

The current setup is robust for disaster recovery but lacks the agility for quick operational recovery from recent data loss. Enabling periodic snapshots would significantly enhance the overall data protection strategy for `immich` by providing faster recovery options.
