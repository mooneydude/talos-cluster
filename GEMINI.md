# Gemini Project Analysis: talos-cluster

## Project Overview

This repository contains the infrastructure-as-code (IaC) for a Kubernetes cluster managed using GitOps principles. The cluster is built on Talos Linux and uses FluxCD to automatically synchronize the cluster's state with the configuration defined in this repository.

The project is structured to manage a variety of applications and core cluster services, from networking and storage to user-facing applications.

**Key Technologies:**

*   **Orchestration:** Kubernetes
*   **OS:** Talos Linux
*   **GitOps:** FluxCD
*   **Manifest Management:** Kustomize, Helm
*   **Secrets Management:** SOPS with age encryption
*   **CNI:** Cilium
*   **Storage:** Rook-Ceph for distributed block and file storage.
*   **Ingress:** NGINX Ingress Controller (with separate internal and external instances)
*   **Service Mesh/Load Balancing:** MetalLB for LoadBalancer services.
*   **Databases:** CloudNativePG for managing PostgreSQL clusters.
*   **Backups:** VolSync for volume snapshots and backups.
*   **CI/CD:** GitHub Actions for automation (e.g., Renovate for dependency updates).

## Architecture

The repository follows a standard GitOps structure:

*   `clusters/main/`: Contains the configuration for the `main` cluster.
*   `clusters/main/kubernetes/`: The root for all Kubernetes manifests for the cluster.
    *   `flux-entry.yaml`: The main Flux `Kustomization` that bootstraps the cluster reconciliation.
    *   `apps/`: Contains user-facing applications like Jellyfin, Home Assistant, Nextcloud, etc.
    *   `core/`: Contains essential cluster-wide services like DNS (`blocky`), certificate issuers, and MetalLB's configuration.
    *   `networking/`: Defines the NGINX ingress controllers.
    *   `system/`: Holds system-level components like `cert-manager`, `rook-ceph`, `volsync`, and other operators.
    *   `kube-system/`: Manages components within the `kube-system` namespace, such as `cilium`.

FluxCD monitors the `main` branch of this repository. When changes are committed, Flux automatically applies them to the cluster. Most applications are deployed via Helm charts, which are defined in `HelmRelease` custom resources. Kustomize is used to patch and organize these manifests.

## Development Workflow

This is not a traditional software project with build/run commands. Instead, the workflow revolves around modifying Kubernetes manifests and committing them to Git.

### Prerequisites

To work with this repository, you will need the following tools:

*   `git`: For version control.
*   `sops`: To decrypt/encrypt secrets.
*   `age`: The backend for SOPS encryption. You will need access to the private key.
*   `flux`: The CLI for interacting with FluxCD.
*   `kubectl`: The Kubernetes command-line tool.
*   `kustomize`: For building and customizing YAML manifests.

### Modifying an Existing Application

1.  Locate the application's `HelmRelease` file (e.g., `clusters/main/kubernetes/apps/jellyfin/app/helm-release.yaml`).
2.  Modify the `values` section to change the application's configuration.
3.  Commit and push the changes to the `main` branch. Flux will automatically apply the changes.

### Editing Secrets

Secrets are encrypted with SOPS. To edit a secret:

1.  Ensure you have the necessary `age` private key configured for SOPS.
2.  Run `sops <file_path>` to open the encrypted file in your default editor. For example:
    ```bash
    sops clusters/main/kubernetes/flux-system/flux/clustersettings.secret.yaml
    ```
3.  Make your changes, save, and exit. SOPS will automatically re-encrypt the file.
4.  Commit and push the changes.

### Forcing a Reconciliation

To manually trigger a Flux reconciliation without waiting for the next interval:

```bash
# Reconcile the top-level kustomization
flux reconcile kustomization flux-entry --namespace flux-system

# Reconcile a specific application
flux reconcile kustomization jellyfin --namespace flux-system
```
