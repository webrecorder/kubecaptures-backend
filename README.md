## permafact-server

This repository contains an experimental, Kubernetes-native browser capture implementation.

Requirements:
- A kubernetes cluster, accessible via `kubectl`

- Helm 3 installed.

- S3-compatible block storage (eg. Minio) and credentials to read, write, delete to a block storage bucket path.


## Setup

The system uses Helm to deploy to a Kubernetes cluster. All of the cluster config settings are set it config.yaml

1. Copy `config.sample.yaml` -> `config.yaml`.

2. Fill in the details of credentials.

3. Before first run, create the `browsers` namespace by running `kubectl create namespace browsers`.

3. To start, run `helm install perma permafact -f ./config.yaml` to the currently configured Kubernetes cluster.

4. To stop the cluster, run `helm uninstall perma permafact`.


### Ingress Option

If the `ingress.host` and `ingress.cert_email` are set, the Helm chart will configure an Ingress controller,
on the specified host, and attempt to obtain an SSL cert (via Letsencrypt).

If the host is omitted, no ingress is created. This may be useful for only accessing the service via an internal network.

