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

from cleanup import StorageManager


class CaptureRequest(BaseModel):
    urls: List[str]
    userid: str = "user"


app = FastAPI()

app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/replay", StaticFiles(directory="replay"), name="replay")

templates = Jinja2Templates(directory="templates")

# if os.environ.get("IN_CLUSTER"):
if os.environ.get("BROWSER"):
    print("Cluster Init")
    config.load_incluster_config()

core_api = client.CoreV1Api()
batch_api = client.BatchV1Api()

profile_url = os.environ.get("PROFILE_URL", "")
headless = not profile_url

access_prefix = os.environ.get("ACCESS_PREFIX")
storage_prefix = os.environ.get("STORAGE_PREFIX")

storage = StorageManager()


def make_jobid():
    return base64.b32encode(os.urandom(15)).decode("utf-8").lower()


def get_job_name(jobid, index):
    return f"capture-{jobid}-{index}"


@app.get("/", response_class=HTMLResponse)
async def read_item(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.post("/captures")
async def start(capture: CaptureRequest):
    return await start_job(capture.urls, capture.userid)


@app.delete("/capture/{jobid}/{index}")
async def delete_job(jobid: str, index: str):
    name = get_job_name(jobid, index)

    try:
        api_response = await batch_api.read_namespaced_job(
            name=name, namespace="browsers"
        )
    except Exception as e:
        print(e)
        return {"deleted": False}

    storage_url = api_response.metadata.annotations.get("storageUrl")
    if storage_url:
        await storage.delete_object(storage_url)

    api_response = await batch_api.delete_namespaced_job(
        name=name, namespace="browsers"
    )
    return {"deleted": True}


@app.get("/captures")
async def list_jobs(jobid: str = "", userid: str = "", index: int = -1):
    label_selector = []
    if jobid:
        label_selector.append(f"jobid={jobid}")

    if userid:
        label_selector.append(f"userid={userid}")

    if index >= 0:
        label_selector.append(f"index={index}")

    api_response = await batch_api.list_namespaced_job(
        namespace="browsers", label_selector=",".join(label_selector)
    )

    jobs = []

    for job in api_response.items:
        data = job.metadata.labels
        data.update(job.metadata.annotations)
        data['startTime'] = job.status.start_time

        if job.status.active:
            data["status"] = "In progress"
        elif job.status.failed:
            data["status"] = "Failed"
        elif job.status.succeeded:
            data["status"] = "Complete"
        else:
            data["status"] = "Unknown"

        if data["status"] != "Complete":
            data.pop("storageUrl", "")
            data.pop("accessUrl", "")

        jobs.append(data)

    return {"jobs": jobs}


async def start_job(urls: List[str], userid: str = "user"):
    jobid = make_jobid()

    index = 0
    for url in urls:
        job_name = get_job_name(jobid, index)
        data = templates.env.get_template("browser-job.yaml").render(
            {
                "userid": userid,
                "jobid": jobid,
                "index": index,
                "job_name": job_name,
                "url": url,
                "filename": f"{ jobid }/{ index }.wacz",
                "access_prefix": access_prefix,
                "storage_prefix": storage_prefix,
                "profile_url": profile_url,
                "headless": headless,
            }
        )
        job = yaml.safe_load(data)

        res = await batch_api.create_namespaced_job(namespace="browsers", body=job)

        index += 1

    return {"jobid": jobid, "urls": index}
