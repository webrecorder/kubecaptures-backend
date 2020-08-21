from typing import Dict, List

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import StreamingResponse, FileResponse

from kubernetes_asyncio import client, config
from kubernetes_asyncio.utils.create_from_yaml import create_from_yaml_single_item

from pydantic import BaseModel
from pprint import pprint

import os
import base64
import yaml

import aiohttp


class CaptureRequest(BaseModel):
    urls: List[str]
    userid: str = "user"


app = FastAPI()

app.mount("/static", StaticFiles(directory="static"), name="static")

templates = Jinja2Templates(directory="templates")

# if os.environ.get("IN_CLUSTER"):
if os.environ.get("BROWSER"):
    print("Cluster Init")
    config.load_incluster_config()
# else:
# await config.load_kube_config()

# configuration = client.Configuration()
# api_client = client.ApiClient(configuration)
core_api = client.CoreV1Api()
batch_api = client.BatchV1Api()


def make_jobid():
    return base64.b32encode(os.urandom(15)).decode("utf-8").lower()


@app.get("/", response_class=HTMLResponse)
async def read_item(request: Request):
    id = "test"
    return templates.TemplateResponse("index.html", {"request": request, "id": id})


@app.get("/capture")
async def run(url: str = "", userid: str = ""):
    return await start_job([url], userid)


@app.post("/capture")
async def start(capture: CaptureRequest):
    return await start_job(capture.urls, capture.userid)


@app.get("/jobs")
async def list_jobs(jobid: str, userid: str = "", index: int = -1):
    label_selector = "jobid=" + jobid
    if userid:
        label_selector += f",userid={userid}"

    if index >= 0:
        label_selector += f",index={index}"

    api_response = await batch_api.list_namespaced_job(
        namespace="browsers", label_selector=label_selector
    )

    jobs = []

    for job in api_response.items:
        data = job.metadata.labels
        data.update(job.metadata.annotations)

        if job.status.active:
            data["status"] = "active"
        elif job.status.failed:
            data["status"] = "failed"
        elif job.status.succeeded:
            data["status"] = "success"
        else:
            data["status"] = "unknown"

        if data["status"] != "success":
            data.pop("storageUrl", "")
            data.pop("accessUrl", "")

        jobs.append(data)

    return {"jobs": jobs}


async def start_job(urls: List[str], userid: str = "user"):
    jobid = make_jobid()

    index = 0
    for url in urls:
        data = templates.env.get_template("browser-job.yaml").render(
            {
                "userid": userid,
                "jobid": jobid,
                "index": index,
                "url": url,
                "filename": f"{ jobid }/{ index }.wacz",
                "access_prefix": os.environ.get("ACCESS_PREFIX"),
                "storage_prefix": os.environ.get("STORAGE_PREFIX"),
            }
        )
        job = yaml.safe_load(data)

        res = await batch_api.create_namespaced_job(namespace="browsers", body=job)

        index += 1

    return {"jobid": jobid, "urls": index}
