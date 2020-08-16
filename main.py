from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import StreamingResponse, FileResponse

from kubernetes_asyncio import client, config
from kubernetes_asyncio.utils.create_from_yaml import create_from_yaml_single_item

import os
import base64
import yaml

import aiohttp

app = FastAPI()

app.mount("/static", StaticFiles(directory="static"), name="static")

templates = Jinja2Templates(directory="templates")

#if os.environ.get("IN_CLUSTER"):
if os.environ.get("BROWSER"):
    print('Cluster Init')
    config.load_incluster_config()
#else:
#await config.load_kube_config()

#configuration = client.Configuration()
#api_client = client.ApiClient(configuration)
core_api = client.CoreV1Api()
batch_api = client.BatchV1Api()

def make_jobid():
    return base64.b32encode(os.urandom(15)).decode('utf-8').lower()


@app.get("/", response_class=HTMLResponse)
async def read_item(request: Request):
    id = "test"
    return templates.TemplateResponse("index.html", {"request": request, "id": id})


@app.get("/test")
async def test_k8s():
    print("Listing pods with their IPs:")
    ret = await v1.list_pod_for_all_namespaces()

    pods = []

    for i in ret.items:
        print(i.status.pod_ip, i.metadata.namespace, i.metadata.name)
        pods.append({'ip': i.status.pod_ip, 'name': i.metadata.name})

    return {'pods': pods}


@app.get("/run")
async def run(url: str = ""):
    jobid = make_jobid()

    filename = jobid + "/0.wacz"

    data = templates.env.get_template("browser-job.yaml").render({"jobid": jobid, "url": url, "upload_filename": filename})
    job = yaml.safe_load(data)
    res = await batch_api.create_namespaced_job(namespace="browsers", body=job)

    #data = templates.env.get_template("browser-service.yaml").render({"jobid": jobid, "url": url})
    #service = yaml.safe_load(data)
    #res = await core_api.create_namespaced_service(namespace="browsers", body=service)

    return {"jobid": jobid}


@app.get("/download/{jobid}.wacz")
async def download(jobid):
    async def iter_chunks(source):
        async for chunk, _ in source.iter_chunks():
            yield chunk

    async with aiohttp.ClientSession() as session:
        async with session.get('http://service-{0}.browsers:8080/api/download/capture'.format(jobid)) as resp:
            if resp.status != 200:
                print(resp.status)
                return {"error": {"status": resp.status}}

            with open('/tmp/download', 'wb') as fd:
                while True:
                    chunk = await resp.content.read()
                    if not chunk:
                        break

                    fd.write(chunk)

        async with session.get('http://service-{0}.browsers:80/exit'.format(jobid)) as resp:
            print('Exiting?')

        return FileResponse("/tmp/download", media_type="application/warc")
