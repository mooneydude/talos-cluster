# Repository instructions

## Secret handling (critical)

This repo stores secrets with SOPS + age. Never do any of the following without
explicit operator approval:

- **Never decrypt files.** No `sops decrypt`, `sops -d`, `sops --decrypt`,
  `sops --set`, or `clustertool decrypt` on `clusterenv.yaml`, `*.secret.yaml`,
  or `talsecret.yaml`.
- **Never read key material.** Do not `read`, `cat`, `head`, `tail`, `sed`,
  `grep`, or otherwise open `age.agekey` or any `*.agekey` file.
- **Never dump cluster secrets.** Do not run `kubectl get secret ... -o
  yaml/json/jsonpath`, `kubectl describe secret`, or
  `kubectl exec ... env | grep -i secret` / `cat /data/secret*` to stdout or a
  file.
- **Never write resolved values to disk.** Do not redirect
  `helmrelease ... -o jsonpath='{.spec.values}'`, decrypted YAML, or live
  HelmRelease values to `/tmp` or anywhere else to run render tests. Use dummy
  placeholder values (e.g. `DUMMY`) instead.
- **Secret additions are the operator's job.** When a migration needs a new
  secret (e.g. `ETESYNC_SECRET_KEY`), report the key name and value location,
  and let the operator add and encrypt it with sops. Do not print the value.

## Secret workflow

- Secrets live in `clusters/main/clusterenv.yaml` and are consumed by Flux as
  the `cluster-config` ConfigMap at
  `clusters/main/kubernetes/flux-system/flux/clustersettings.secret.yaml`.
- To change a value: decrypt with sops, edit, re-encrypt, then run
  `clustertool genconfig` so the ConfigMap is regenerated. Only the operator
  performs these steps.
- HelmReleases reference secrets as `${PLACEHOLDER}`; Flux substitutes them at
  reconcile time.

## Chart migrations (common-2026)

- Render-test new chart versions with dummy values, never the live resolved
  values.
- For CNPG-backed charts: pin `dependencies.postgresql.operator.pgVersion` to
  the cluster's current major, verify the cluster is healthy, then remove the
  pin to upgrade to PostgreSQL 18.
- The closed schema can silently drop keys. Inspect the rendered output for
  dropped resources (Cluster, ObjectStore, ScheduledBackup, secrets), not just
  the `helm template` exit code.
