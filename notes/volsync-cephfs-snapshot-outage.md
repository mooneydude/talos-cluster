# CephFS snapshots wedged, 18 volsync backups dead for 70 days

**Detected:** 2026-11-14
**Duration of outage:** 2026-09-04/05 to 2026-11-14 (70-71 days)
**Impact:** 18 of 25 volsync restic backups produced no backups at all. `navidrome` had never backed up once.

## Symptom

`ReplicationSource` objects for every PVC on the `ceph-filesystem` storage class
were stuck permanently at:

```
Synchronizing=True (SyncInProgress)
```

No mover Jobs existed anywhere in the cluster, so nothing was running and nothing
was retrying. Every source on `ceph-nvme` synced normally, every day.

Correlation was total:

| Storage class | Access mode | Sources | Status |
|---|---|---|---|
| `ceph-filesystem` | ReadWriteMany | 18 | stuck 70 days |
| `ceph-nvme` | ReadWriteOnce | 7 | fine |

## Root cause

`--feature-gates=CSIVolumeGroupSnapshot=true` on the CephFS `csi-snapshotter`
sidecar. Rook sets it for the CephFS controller plugin but not for RBD, which is
why only CephFS broke.

That gate starts group-snapshot informers which request
`groupsnapshot.storage.k8s.io/v1beta2`. The group-snapshot CRDs in the cluster
only served `v1beta1`, so the informer cache never synced and the snapshotter
blocked after startup. It never processed a single VolumeSnapshotContent.

Volsync then waited forever for a `VolumeSnapshot` that could never become ready,
which is why the `Synchronizing=True` condition never cleared, no mover Job was
ever created, and no error was ever surfaced.

Evidence:

```
cephfs csi-snapshotter: --feature-gates=CSIVolumeGroupSnapshot=true
rbd    csi-snapshotter: (no feature gate)          <- worked
```

```
groupsnapshot.storage.k8s.io/v1beta1  served  <- present
groupsnapshot.storage.k8s.io/v1beta2  served  <- MISSING
```

`sonarr` and `radarr` were byte-identical in volsync config except
`volumeSnapshotClassName` (`ceph-filesystem` dead, `csi-ceph-blockpool` fine).

Restarting the cephfs ctrlplugin pods did **not** help. The leader lease even had
to expire (137s) before a new leader could take over.

## Red herrings

- **Not** the storage class or RWO vs RWX. `immich-thumbs` was moved to
  `ceph-nvme`/RWO on 2026-10-22 and its backups recovered, but the effective
  change was `volumeSnapshotClassName` -> `csi-ceph-blockpool`, not the access
  mode. Migrating the other 18 volumes would have been unnecessary work.
- CephFS snapshots *did* exist in Ceph (`ceph fs subvolume snapshot ls`) even
  while Kubernetes showed `readyToUse=false`, because the driver created them
  and the response never made it back.
- The TrueCharts `snapshot-controller` chart 6.2.4 ships a v8.7.0
  snapshot-controller image but stale group-snapshot CRDs
  (`api-approved.../pull/1150`, v1beta1 only). Newer CRDs reference
  `pull/1337`. `controller-gen.kubebuilder.io/version` is v0.15.0 in both old and
  new, so it is not a useful tell.

## Fix

Replaced the group-snapshot CRDs with external-snapshotter v8.7.0, which serves
v1beta2. Snapshots began completing within ~45 seconds and the whole backlog
drained.

```
clusters/main/kubernetes/system/snapshot-controller/crds/
```

All 25 sources then reported `Successful` for 2026-11-14.

`navidrome` additionally needed its restic repo initialised, since
`cluster-navidrome` had never been created. Volsync handled that automatically
once snapshots worked.

## Guard against regression

The CRDs are now managed from this repo by the `snapshot-controller-crds` Flux
Kustomization (`crds-ks.yaml`), with:

- `dependsOn: snapshot-controller` so it applies after the Helm release
- `force: true` so Flux wins field ownership against Helm
- `prune: false` because pruning a CRD would cascade-delete its objects

Without that, the next TrueCharts chart bump would reapply the stale
v1beta1-only CRDs with `crds: CreateReplace` and silently kill all 18 backups
again, with no drift detection on that HelmRelease to warn us.

## Monitoring

The real failure was the silence. Suggested alert:

- `volsync_replicationsource_last_sync_age_seconds > 129600` (36h) for any
  source, which would have caught this in under two days instead of seventy.
- Cheap health check: assert `v1beta2` appears in
  `kubectl get crd volumegroupsnapshotclasses.groupsnapshot.storage.k8s.io -o jsonpath='{range .spec.versions[*]}{.name} {end}'`
