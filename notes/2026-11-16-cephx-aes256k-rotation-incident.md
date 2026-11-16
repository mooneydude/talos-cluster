# 2026-11-16: CephX aes256k rotation broke live CephFS/RBD kernel mounts

## Summary

Rotating cephx keys to `aes256k` (to clear Ceph Tentacle's `AUTH_INSECURE_KEY_TYPE`
warnings / CVE-2025-30156 remediation) deleted the old CSI client entities
(`client.csi-cephfs-node`, `client.csi-rbd-node`, etc.) and replaced them with
suffixed ones (`client.csi-cephfs-node.2`, ...). Every **already-mounted** kernel
CephFS client kept using the old entity name and started failing cephx auth with
`-13` (EACCES) against the mons and OSDs. The kernel client did not fail cleanly —
it hung, which wedged CSI nodeplugin pods, app pods using CephFS PVCs across the
cluster, and ultimately the Talos reboot sequence itself (stuck in the `umount`
phase holding the machine lock). Recovery required a **hard power cycle** of each
affected node; `talosctl reboot` (even `--mode force`) could not complete.

## What rotated, and why it broke live mounts

Commits `ca95ad92` and `a79c94c7` in
`clusters/main/kubernetes/core/rook-ceph/cluster/helm-releas.yaml` set:

```yaml
security:
  cephx:
    allowedCiphers: ["aes256k"]
    daemon:   { keyType: aes256k, keyRotationPolicy: KeyGeneration, keyGeneration: 2 }
    csi:      { keyType: aes256k, keyRotationPolicy: KeyGeneration, keyGeneration: 2 }
    rbdMirrorPeer: { keyType: aes256k, keyRotationPolicy: KeyGeneration, keyGeneration: 2 }
```

Rook's `KeyGeneration` policy does not rotate keys in place: it creates a new
entity (`client.csi-cephfs-node.2`) and **deletes the old one**
(`client.csi-cephfs-node`), then updates the CSI secrets to point at the new
entity. New CSI mount operations pick this up immediately and work fine — this
was verified with a scratch PVC/pod before rolling out further.

The miss: existing kernel mounts (CephFS `krbd`/`ceph` kernel client) keep their
session keyed to the *old* entity name and are never told to re-authenticate.
Once the old entity is deleted, every read/write against it fails in the kernel
with:

```
libceph: auth protocol 'cephx' msgr authentication failed: -13
libceph: auth protocol 'cephx' authorization to osd failed: -13
cephx server client.csi-cephfs-node: couldn't find entity name: client.csi-cephfs-node   (seen 3421x on one mon)
```

Ceph docs do call this out ("rotating CSI keys disrupts existing PV
connections"), but the practical effect is worse than "disrupted": the kernel
client doesn't error out and release the mount, it hangs indefinitely. That hang:

- Blocked any pod I/O to a CephFS PVC on the affected node (DB writes, config
  reads, etc.) — e.g. audiobookshelf's `/login` POST writes a session row on a
  CephFS-backed `config` PVC, so the request hung 60s and nginx returned `504`.
- Crash-looped the `cephfs.csi.ceph.com` nodeplugin pods on every node with
  `GRPC error: ... an operation with the given target path ... mount already
  exists` — a previous mount syscall was stuck, so retries got rejected forever.
- Wedged `talosctl reboot` for the affected node in the `umount` phase (`do_umount`
  blocked on `namespace_sem`), after which `machined` held the reboot actor lock
  and even `--mode force` or a second reboot attempt failed with
  `failed to acquire lock: timeout`.

## Recovery

No clean in-band fix was found. Things ruled out:
- Recreating the old cephx entities with their original keys: unrecoverable,
  Rook deleted them and overwrote the only copies (the CSI Secrets).
- `k8up`/`velero`/etcd snapshots of the old keys: none exist in this cluster.
- Live lazy/force unmount (`umount -l -f`) via a privileged pod + `nsenter` into
  the host mount namespace: technically possible (confirmed we can get a root
  shell on any node without SSH this way), but not attempted for recovery — the
  CSI driver tracks mount state by path, and a partial unmount risked leaving
  the kernel thread wedged while CSI believed the path was free, which looked
  like it could reproduce the same deadlock with no clean signal to detect it.

What worked: a **hard power cycle** of the affected node (power off/on, not
`talosctl reboot`). On boot, the mount table is empty, so every CephFS/RBD PVC
remounts fresh using the new `.2` keys. Verified clean afterward:
`ceph -s` back to `HEALTH_WARN` (ciphers-only warning), all mons/osds up,
`201 active+clean` PGs, 0 new `couldn't find entity name` errors, and
audiobookshelf login returning fast `401`s instead of hanging.

This was needed node-by-node for every node that had CephFS/RBD PVCs mounted at
rotation time (in this cluster: all three workers).

## Rule for next time

**Do cephx `KeyGeneration` rotation only in a planned maintenance window**, and
treat it as equivalent to "every node with a Ceph-backed kernel mount needs a
reboot afterward," specifically:

1. Before rotating, inventory every node with CephFS/RBD PVCs
   (`kubectl get pods -A -o json` cross-referenced with PVC `storageClassName`).
2. Rotate.
3. Immediately after rotation finishes, cordon + drain + **hard power cycle**
   each affected node in turn (not a graceful `talosctl reboot` — if any
   CephFS mount on that node is already wedged, the reboot sequence itself will
   wedge in `umount` and require a hard cycle anyway, so don't waste time on the
   graceful path).
4. Only mark the rotation complete once every node has been cycled and
   `ceph auth ls` / mon logs show zero `couldn't find entity name` errors over a
   few minutes.
5. A fresh-mount test in a scratch namespace (what we did mid-incident) proves
   the *new* keys work. It proves nothing about *existing* mounts and should not
   be used as a signal that rotation is safe to leave as-is.

## Open item

Rook issue filed upstream: rook/rook#18811 — `AUTH_EMERGENCY_CIPHERS_SET`
persists after migration even though all entities are on `aes256k`. Believed
harmless (mons just *permit* falling back to legacy ciphers in an emergency;
nothing is actually using them), but no supported way found to clear it without
fighting Rook's reconcile loop.
