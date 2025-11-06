saved chat: immich-volsync

# Chat Session Summary: Immich VolSync Snapshot Configuration

This document summarizes the investigation and resolution of the VolSync snapshot configuration for the `immich` application.

## 1. Initial Investigation

The session began with an inquiry into the workings of `VolumeSnapshot` and `VolSync` for the `immich` application. Examination of the Kubernetes resources revealed:

*   **Daily Restic Backups:** `ReplicationSource` objects confirmed that `restic` backups for `immich-profile` and `immich-thumbs` were running successfully on a daily schedule.
*   **Stale VolumeSnapshots:** The most recent `VolumeSnapshot` was over a week old.

## 2. Problem Identification

Further investigation into the `ReplicationDestination` object for `immich-thumbs` revealed the root cause:

*   The `spec.trigger` was set to `manual: restore-once`.
*   This configuration meant that `VolumeSnapshot` creation was a one-time manual event and not on a recurring schedule, leading to stale snapshots.

## 3. Solution and Implementation

To resolve this and establish a robust data protection strategy with both off-site backups and on-cluster snapshots, the following actions were taken:

*   **Decision:** It was decided to enable automatic, daily `VolumeSnapshots` to allow for fast, operational recovery.
*   **File Modified:** The `helm-release.yaml` for `immich` located at `/Users/paul/Projects/talos-cluster/clusters/main/kubernetes/apps/immich/app/helm-release.yaml` was updated.
*   **Change Details:** A `trigger` with a `schedule` of `"0 1 * * *"` was added to the `volsync.dest` configuration for both the `profile` and `thumbs` persistence volumes.

## 4. Outcome

Following the modification, VolSync is now configured to automatically create a new `VolumeSnapshot` of the `restic` backup repositories for `immich` every day at 1:00 AM. This provides regular, on-cluster recovery points, complementing the existing off-site `restic` backups to S3.