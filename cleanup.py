from kubernetes_asyncio import client, config
import asyncio
import os
import datetime
import aiobotocore
import urllib.parse


# ============================================================================
class StorageManager:
    def __init__(self):
        self.session = aiobotocore.get_session()
        self.endpoint_url = os.environ.get("AWS_ENDPOINT", "")
        if not self.endpoint_url:
            self.endpoint_url = None

    async def delete_object(self, url):
        async with self.session.create_client(
            "s3",
            endpoint_url=self.endpoint_url,
            aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
            aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
        ) as s3:
            parts = urllib.parse.urlsplit(url)
            resp = await s3.delete_object(Bucket=parts.netloc, Key=parts.path[1:])

    async def get_presigned_url(self, url):
        async with self.session.create_client(
            "s3",
            endpoint_url=self.endpoint_url,
            aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
            aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
        ) as s3:
            parts = urllib.parse.urlsplit(url)
            return await s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": parts.netloc, "Key": parts.path[1:]},
                ExpiresIn=int(os.environ.get("JOB_CLEANUP_INTERVAL", 60)) * 60,
            )


# ============================================================================
async def main():
    if os.environ.get("BROWSER"):
        print("Cluster Init")
        config.load_incluster_config()
    else:
        await config.load_kube_config()

    minutes = os.environ.get("")

    storage = StorageManager()

    cleanup_interval = datetime.timedelta(
        minutes=int(os.environ.get("JOB_CLEANUP_INTERVAL", 60))
    )

    print("Deleting jobs older than {0} minutes".format(cleanup_interval))
    await delete_jobs(cleanup_interval)
    await delete_pods(cleanup_interval)
    print("Done!")


async def delete_jobs(cleanup_interval):
    batch_api = client.BatchV1Api()

    api_response = await batch_api.list_namespaced_job(namespace="browsers")

    for job in api_response.items:
        if job.status.succeeded != 1:
            continue

        duration = datetime.datetime.utcnow() - job.status.start_time.replace(
            tzinfo=None
        )

        if duration < cleanup_interval:
            print("Keeping job {0}, not old enough".format(job.metadata.name))
            continue

        print("Deleting job: " + job.metadata.name)

        storageUrl = job.metadata.annotations.get("storageUrl")
        if storageUrl:
            try:
                print("Deleting archive file: " + storageUrl)
                await storage.delete_object(storageUrl)
            except Exception as e:
                print(e)

        await batch_api.delete_namespaced_job(
            name=job.metadata.name,
            namespace="browsers",
            propagation_policy="Foreground",
        )


async def delete_pods(cleanup_interval):
    core_api = client.CoreV1Api()
    api_response = await core_api.list_namespaced_pod(
        namespace="browsers", field_selector="status.phase=Succeeded"
    )

    for pod in api_response.items:
        if (
            datetime.datetime.utcnow() - pod.status.start_time.replace(tzinfo=None)
        ) < cleanup_interval:
            print("Keeping pod {0}, not old enough".format(pod.metadata.name))
            continue

        await core_api.delete_namespaced_pod(pod.metadata.name, namespace="browsers")


# asyncio.run(main())
if __name__ == "__main__":
    loop = asyncio.get_event_loop()
    loop.run_until_complete(main())
    loop.close()

#
