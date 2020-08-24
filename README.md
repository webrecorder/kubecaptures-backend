## permafact-server

This repository contains an experimental, Kubernetes-native browser capture implementation.

Requirements:
- A kubernetes cluster, accessible via `kubectl`

- Helm 3 installed.

- S3-compatible block storage (eg. Minio) and credentials to read, write, delete to a block storage bucket path.


## Setup

The system uses Helm to deploy to a Kubernetes cluster. All of the cluster config settings are set it config.yaml

1. Copy `config.sample.yaml` -> `config.yaml`

2. Fill in the details of credentials

3. Run `helm install perma permafact -f ./config.yaml` to the currently configured Kubernetes cluster.

   Or, you can also run `./relaunch.sh`, which will stop previous cluster and redeploy.



