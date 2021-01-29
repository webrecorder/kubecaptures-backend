## KubeCaptures Backend

This repository contains an extension of the [Browserkube](https://github.com/webrecorder/browserkube) system,
designed for an on-demand, single-url capture service. This project is created in collaboration with the [Perma.cc](https://perma.cc) team at [Harvard LIL](https://github.com/harvard-lil).

Requirements:

- A Kubernetes cluster
- A local copy of [`kubectl`](https://kubernetes.io/docs/tasks/tools/install-kubectl/), configured to run commands against the cluster
- A local copy of [Helm 3](https://v3.helm.sh/)

Optional:

Browserkube ships with a minimally-configured deployment of [Minio](https://min.io/) for storage.

You may prefer to use an external S3-compatible storage service like [Amazon Simple Storage Service](https://aws.amazon.com/s3/) or [Digital Oceans Spaces Object Storage](https://www.digitalocean.com/products/spaces/).


## Architecture

This repository is used to build two Docker images for use in a customized installation of the [Helm chart](https://github.com/webrecorder/browserkube/tree/main/chart) defined by Browserkube:

- A `main_image` is built on top of Browserkube's default main_image that swaps out the application's routes, providing a simple API for launching new capture jobs, monitoring and responding to capture job status, and deleting capture jobs. The `main_image` is also responsible for cleaning up expired jobs.

- A `driver_image` is presently built from scratch and is responsible for the mechanics of a capture job: directing the remote browser, waiting until the capture job is considered "complete," and committing the web archive file to storage. In the future, its logic will be split with [Behaviors](https://github.com/webrecorder/behaviors), a Webrecorder system for defining site-specific capture logic. Driver containers are optionally spun up on-demand, as part of a [browser job](https://github.com/webrecorder/browserkube/blob/d0a0cdda254b980a9b206996599d200ebc17abcf/main/templates/browser-job.yaml#L183); without a driver, Browserkube defaults to [...what behavior?].

You do not need a copy of this repository to run the application: all the necessary images are publicly available via Dockerhub.


## Basic Installation

Follow the standard installation instructions for [Browserkube](https://github.com/webrecorder/browserkube/blob/d0a0cdda254b980a9b206996599d200ebc17abcf/README.md#setup), and add two additional keys to your `config.yaml`:

```
main_image: 'webrecorder/kubecaptures-main:dev'
driver_image: 'webrecorder/kubecaptures-driver:dev'
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
6. Clone this repository.

### Kubernetes

7. From any directory, create and start your minikube Kubernetes cluster: `minikube start`.
8. Launch the Kubernetes dashboard: `minikube dashboard`. (It should open a tab in your default browser; that terminal window will continue exposing the dashboard until you terminate the process).

### Configure and Launch Browserkube/KubeCaptures

9. Configure the Helm chart to use our custom KubeCaptures images instead of the Browserkube defaults:
    - touch `config.yaml`
    - add `main_image: 'webrecorder/kubecaptures-main:dev'`
    - add `driver_image: 'webrecorder/kubecaptures-driver:dev'`

10. Run `helm install bk browserkube/browserkube -f ./config.yaml` to install a release (here, arbitrarily named "bk") of the chart on the currently configured Kubernetes cluster. If successful, `helm list` will list the `bk` release, and `kubectl get services` will list the `browserkube` service, and you should be able to see the service and its pods in the Kubernetes dashboard. `kubectl get namespaces` should list the (newly-created) namespace specified by the `browser_namespace` config value.

11. Expose the Minio service to your local machine on port 9000, and in another terminal window, expose the Browserkube/KubeCaptures service on port 8080:
    ```
    kubectl port-forward service/minio 9000
    kubectl port-forward service/browserkube 8080:80
    ```
    Note: this will direct all of a service's traffic to a single pod. If you need to expose all replicas (e.g. to observe load balancing), run `minikube service --url minio` and `minikube service --url browserkube` instead, which will expose the  services on random available ports. This strategy may also help if the port-forwarding is proving to be too [flaky](https://github.com/kubernetes/kubernetes/issues/74551).

12. After the pods are ready, `curl http://localhost:8080` to verify that the homepage of the service is returned.

13. Visit http://localhost:9000 in your web browser and log in using your Minio credentials (default: `YOURACCESSKEY` and `YOURSECRETKEY`).

### Make a test capture

14. Request a capture: `curl -X POST -H "Content-Type: application/json" http://localhost:8080/captures --data '{"urls": ["http://example.com"]}'`. Expect output similar to: `{"urls":1,"jobids":["60239047-28fb-4581-b236-39ed69599fe8"]}`

15. If desired, in the Kubernetes dashboard, navigate to the `browsers` namespace, and locate the corresponding job. It make take quite a while to initialize, this first time. Wait until the job's pod is "Running", and click the "View Logs" button, a left-formatted text icon, from the menu to inspect the logs. Note they do not refresh automatically. The `browser` container's logs will be shown by default. To inspect the `driver` or `pywb` logs, select that container's name in the subtle dropdown in the logs header.

16. Curl `http://localhost:8080/captures`, waiting until it reports the capture job has `"status":"Complete"`:
    ```
    {"jobs":[{"app":"","jobid":"20354ec9-0975-4ea0-bc4b-4cba35d09d02","userid":"user","captureUrl":"http://example.com","userTag":"","startTime":"2020-10-20T22:44:21+00:00","elapsedTime":"2020-10-20T22:44:45+00:00","status":"Complete","accessUrl":"http://minio.minio.svc.cluster.local:9000/kubecaptures/236ca1d4-7b1d-4df5-a62d-5513704897e8.wacz?response-content-disposition=attachment%3B%20filename%3Dexample.com-2020-10-20.wacz&AWSAccessKeyId=YOURACCESSKEY&Signature=cjyWQaOPpr1Ylc7gxJwdsePiXx4%3D&Expires=1603248261"}]}
    ```

17. In your browser, return to the Minio web interface. Verify that the web archive can be found in the bucket.

### Change the code

18. Create a `.env` file in this directory, and use it to provide custom tags (and/or names) for the docker images. E.g.
    ```
    MAIN_TAG=local
    DRIVER_TAG=local
    ```
19. Adjust `config.yaml` to use your custom image tags/names, and ensure Kubernetes will use the locally-built images:
    ```
    main_image: 'webrecorder/kubecaptures-main:local'
    driver_image: 'webrecorder/kubecaptures-driver:local'

    main_pull_policy: "IfNotPresent"
    driver_pull_policy: "IfNotPresent"
    ```
20. Make changes to this repository, adjusting the code for the `main`, `driver`, and `frontend` images as desired.
21. Run `eval $(minikube -p minikube docker-env)` so that, in the current terminal, `docker` and `docker-compose` commands target the minikube Docker daemon, rather than the Docker Desktop daemon. (To observe the results of this command, run `docker images` before and afterwards, and compare the results.)
22. Run `docker-compose build` to build and tag images using your new code.
23. Reinstall Browserkube/KubeCaptures on the cluster, using those custom images:
    - `ctrl+c` in the terminal windows that are proxying Minio and Browserkube/KubeCaptures
    - `helm uninstall bk` and wait a few seconds
    - Rerun `helm install bk browserkube/browserkube -f ./config.yaml`
    - Rerun `kubectl port-forward service/minio 9000` and `kubectl port-forward service/browserkube 8080:80`
    - Test
24. Continue making changes and building new images.
    - If you make changes to the `main` or `frontend` image or alter `config.yaml`, you will need to repeat the above re-installation step each time.
    - If you are only making changes to the `driver` image, you will NOT need to reinstall after building: each newly launched capture job will use the most recent version of the image with the configured name and tag.

### Turn everything off

25. `ctrl+c` in the three terminal windows proxying Minio, Browserkube/KubeCaptures, and the Kubernetes dashboard.
26. `helm uninstall bk`
27. `minikube stop` (or `minikube delete`, to truly start fresh next time)
28. Close any terminal windows in which you ran `eval $(minikube -p minikube docker-env)`.
29. Quit Docker Desktop
