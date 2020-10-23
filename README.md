## KubeCaptures Backend

This repository contains an extension of the [Browserkube](https://github.com/webrecorder/browserkube) system,
designed for an on-demand, single-url capture service. This project is created in collaboration with the [Perma.cc](https://perma.cc) team at [Harvard LIL](https://github.com/harvard-lil).

Requirements:
- A Kubernetes cluster
- A local copy of [`kubectl`](https://kubernetes.io/docs/tasks/tools/install-kubectl/), configured to run commands against the cluster
- A local copy of [Helm 3](https://v3.helm.sh/)
- S3-compatible block storage and credentials to read, write, delete to a block storage bucket path.


## Architecture

This repository is used to build two Docker images for use in a customized installation of the [Helm Chart](https://github.com/webrecorder/browserkube/tree/main/chart) defined by Browserkube:

- A `main_image` is built on top of Browserkube's [default main_image](https://github.com/webrecorder/browserkube/blob/ddd9012ebd2125cd6376d438879ed21c3ff60c6b/chart/templates/deploy.yaml#L108) and swaps out the application's routes, providing a simple API for launching new capture jobs, monitoring and responding to capture job status, and deleting capture jobs. The `main_image` is also responsible for [cleaning up expired jobs](https://github.com/webrecorder/browserkube/blob/ddd9012ebd2125cd6376d438879ed21c3ff60c6b/chart/templates/deploy.yaml#L22).

- A `driver_image` is presently built from scratch and is responsible for the mechanics of a capture job: directing the remote browser, waiting until the capture job is considered "complete," and committing the web archive file to storage. In the future, its logic will be split with [Behaviors](https://github.com/webrecorder/behaviors), a Webrecorder system for defining site-specific capture logic. Driver containers are [optionally](https://github.com/webrecorder/browserkube/blob/e792c4080fb44738297c7fd3d2a95c083be10b95/chart/templates/configmap.yaml#L74) spun up on-demand, as part of a [browser job](https://github.com/webrecorder/browserkube/blob/41ccddb0f634e3e112a3480bc06277fe0c491a09/templates/browser-job.yaml#L183); without a driver, Browserkube defaults to [...what behavior?].

You do not need a copy of this repository to run the application: all the necessary images are publicly available via Dockerhub.


## Basic Installation

Follow the standard installation instructions for [Browserkube](https://github.com/webrecorder/browserkube/blob/41ccddb0f634e3e112a3480bc06277fe0c491a09/README.md), adding two additional keys to your `config.yml`:

```
main_image: 'ikreymer/permaproof-main:dev'
driver_image: 'ikreymer/permaproof-driver:dev'
```


## Sample Development Workflow

This is one way to get up-and-running with a local installation.

### Prerequisites

1. Install [Docker Desktop](https://docs.docker.com/desktop/).
2. Launch Docker Desktop, [configure it](https://docs.docker.com/docker-for-mac/#resources) to use at least 2 CPU and at least 8G RAM, and restart.
3. Install [minikube](https://minikube.sigs.k8s.io/docs/start/).
3. (Necessary?) Configure minikube to use at least 8G RAM: in any directory, run `minikube config set memory 8192`.
4. Install [Helm](https://helm.sh/docs/intro/install/).
5. Add the Browserkube chart repository to Helm: `helm repo add browserkube https://webrecorder.github.io/browserkube/charts`
6. Clone this repository and [Browserkube](https://github.com/webrecorder/browserkube).

### Kubernetes + Minio

7. From any directory, create and start your minikube Kubernetes cluster: `minikube start`.
8. Launch the Kubernetes dashboard: `minikube dashboard`. (It should open a tab in your default browser; that terminal window will continue exposing the dashboard until you terminate the process).
10. In another terminal window, use Helm to deploy [Minio](https://min.io/), an S3-like local storage service, to your cluster: `helm install minio minio/minio`.
11. Retrieve your Minio `ACCESS_KEY`: `echo $(kubectl get secret minio -o jsonpath="{.data.accesskey}" | base64 --decode)` and `SECRET_ACCESS_KEY`: `echo $(kubectl get secret minio -o jsonpath="{.data.secretkey}" | base64 --decode)`.
12. Expose the Minio web interface to your local machine on port 9000:
    ```
    export POD_NAME=$(kubectl get pods -l "release=minio" -o jsonpath="{.items[0].metadata.name}")
    kubectl port-forward $POD_NAME 9000
    ```
13. Visit http://127.0.0.1:9000 in your web browser, and log in using your Minio `ACCESS_KEY` and `SECRET_KEY`.
14. Click the orange "plus" icon in the lower right-hand corner of the screen, then, from the popup menu, click the yellow "create bucket" button, labeled with a hard drive icon. Enter a bucket name "kubecaptures" and press enter. Confirm that you are now at a URL like `http://127.0.0.1:9000/minio/kubecaptures/`.
15. (Optional) In the left-hand sidebar, hover over your bucket name, and click on the three-dotted "expand" icon, then select "Edit policy." Select "Read-and-write" from the dropdown, and then press "Add". In another terminal window, curl `http://127.0.0.1:9000/minio/kubecaptures/` and confirm that results like the following are returned: `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>kubecaptures</Name><Prefix></Prefix><Marker></Marker><MaxKeys>1000</MaxKeys><Delimiter></Delimiter><IsTruncated>false</IsTruncated></ListBucketResult>`

### Configure Browserkube/KubeCaptures

16. In another terminal window, navigate to the directory where you cloned Browserkube (not THIS repository) and `cp config.sample.yaml config.yml`
17. Configure the `storage` section of `config.yml` to use minio:
    - set `access_key` to your Minio `ACCESS_KEY` and `secret_key` to your Minio `SECRET_KEY`
    - set `api_endpoint` to `http://minio.default.svc.cluster.local:9000`
    - set `storage_prefix` to `s3://kubecaptures/`.
    - (wrong!) set `access_prefix` to `http://localhost:9000/kubecaptures/`
    - set `force_path_style` to `True`
18. Configure the Helm chart to use our custom KubeCaptures images instead of the Browserkube defaults:
    - set `main_image` to `ikreymer/permaproof-main:dev`
    - set `driver_image` to  `ikreymer/permaproof-driver:dev`
19. Create the `browsers` namespace by running `kubectl create namespace browsers`.

### Launch Browserkube/KubeCaptures

20. Still in the directory where you cloned Browserkube (not THIS repository), run `helm install bk browserkube/browserkube -f ./config.yaml` to install a release (here, arbitrarily named "bk") of the chart ("browserkube/browserkube") on the currently configured Kubernetes cluster. If successful, `helm list` will list the `bk` release, and `kubectl get services` will list the `browserkube` service, and you should be able to see the service and its pods in the Kubernetes dashboard.
21. Expose the service to your local machine on an available port: `minikube service --url browserkube`, which will produce output similar to:
    ```
    😿  service default/browserkube has no node port
    🏃  Starting tunnel for service browserkube.
    |-----------|-------------|-------------|------------------------|
    | NAMESPACE |    NAME     | TARGET PORT |          URL           |
    |-----------|-------------|-------------|------------------------|
    | default   | browserkube |             | http://127.0.0.1:51669 |
    |-----------|-------------|-------------|------------------------|
    http://127.0.0.1:51669
    ```
22. After the pods are ready, in another terminal window, curl the URL exposed in the last step, and verify that the homepage of the service is returned.

### Make a test capture

23. Request a capture: `curl -X POST -H "Content-Type: application/json" http://127.0.0.1:51669/captures --data '{"urls": ["http://example.com"]}'` (correcting the port to match the URL exposed in the step above). Expect output similar to: `{"urls":1,"jobids":["60239047-28fb-4581-b236-39ed69599fe8"]}`

24. If desired, in the Kubernetes dashboard, navigate to the `browsers` namespace, and locate the corresponding job. It make take quite a while to initialize, this first time. Wait until the job's pod is "Running", and click the "View Logs" button, a left-formatted text icon, from the menu to inspect the logs. Note they do not refresh automatically. The `browser` container's logs will be shown by default. To inspect the `driver` or `pywb` logs, select that container's name in the subtle dropdown in the logs header.

25. Curl `http://127.0.0.1:51669/captures`, waiting until it reports the capture job has `"status":"Complete"`:
    ```
    {"jobs":[{"app":"","jobid":"20354ec9-0975-4ea0-bc4b-4cba35d09d02","userid":"user","captureUrl":"http://example.com","userTag":"","startTime":"2020-10-20T22:44:21+00:00","elapsedTime":"2020-10-20T22:44:45+00:00","status":"Complete","accessUrl":"http://minio.minio.svc.cluster.local:9000/kubecaptures/236ca1d4-7b1d-4df5-a62d-5513704897e8.wacz?response-content-disposition=attachment%3B%20filename%3Dexample.com-2020-10-20.wacz&AWSAccessKeyId=YOURACCESSKEY&Signature=cjyWQaOPpr1Ylc7gxJwdsePiXx4%3D&Expires=1603248261"}]}
    ```

26. In your browser, return to the Minio web interface. Verify that the web archive can be found in the bucket.

### Change the code

27. Create a `.env` file in this directory, and use it to provide custom names for the docker images, being sure to use your own Docker username. E.g.
    ```
    MAIN_IMAGE=rcremona/kubecaptures-backend-main
    MAIN_TAG=dev
    DRIVER_IMAGE=rcremona/kubecaptures-backend-driver
    DRIVER_TAG=dev
    ```
28. Make changes to this repository, adjusting the code for the main or driver images as desired.
29. Run `docker-compose build` to build and tag images using your new code.
30. Push those images to Dockerhub:
    ```
    docker login
    docker push rcremona/kubecaptures-backend-main:dev
    docker push rcremona/kubecaptures-backend-driver:dev
    ```
32. Adjust `config.yml` to use your custom images.
33. Reinstall Browserkube/KubeCaptures on the cluster, using those custom images:
    - `ctrl+c` in the terminal window in which you ran `minikube service --url browserkube`
    - `heml uninstall bk`
    - Rerun `helm install bk browserkube/browserkube -f ./config.yaml`
    - Rerun `minikube service --url browserkube`
    - Test
34. Continue making changes, building new images, and pushing them to Dockerhub.
    - If you make changes to the `main` image or alter `config.yml`, you will need to repeat the above re-installation step each time.
    - If you are only making changes to the `driver` image, you will NOT need to reinstall after pushing to Dockerhub: each newly launched capture job will use the most recent version of the image with the configured name and tag.

### Turn everything off

33. `ctrl+c` in the three terminal windows proxying Browserkube/KubeCaptures, Minio and the Kubernetes dashboard.
34. `helm uninstall bk` and `helm uninstall minio`
35. `minikube stop` (or `minikube delete`, to truly start fresh next time)
36. Quit Docker Desktop
