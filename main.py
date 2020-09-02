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
import html

import urllib.parse
import datetime

import aiohttp

from cleanup import StorageManager


class CaptureRequest(BaseModel):
    urls: List[str]
    userid: str = "user"
    tag: str = ""


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

job_max_duration = int(os.environ.get("JOB_MAX_DURATION") or 0) * 60

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
    return await start_job(capture)


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
        data["captureUrl"] = job.metadata.annotations["captureUrl"]
        data["userTag"] = job.metadata.annotations["userTag"]
        data["startTime"] = job.status.start_time

        if job.status.active:
            data["status"] = "In progress"
        elif job.status.failed:
            data["status"] = "Failed"
        elif job.status.succeeded:
            data["status"] = "Complete"
            data["accessUrl"] = html.unescape(job.metadata.annotations["accessUrl"])
        else:
            data["status"] = "Unknown"

        jobs.append(data)

    return {"jobs": jobs}


async def start_job(capture: CaptureRequest):
    jobid = make_jobid()

    index = 0
    for url in capture.urls:
        job_name = get_job_name(jobid, index)

        filename = f"{ jobid }/{ index }.wacz"
        storage_url = storage_prefix + filename

        try:
            download_filename = urllib.parse.urlsplit(url).netloc + '-' + str(datetime.datetime.utcnow())[:10] + '.wacz'
        except:
            download_filename = None

        access_url = await storage.get_presigned_url(storage_url, download_filename)

        data = templates.env.get_template("browser-job.yaml").render(
            {
                "userid": capture.userid,
                "jobid": jobid,
                "index": index,
                "job_name": job_name,
                "user_tag": capture.tag,
                "url": url,
                "filename": filename,
                "access_url": access_url,
                "storage_url": storage_url,
                "profile_url": profile_url,
                "headless": headless,
                "job_max_duration": job_max_duration
            }
        )
        job = yaml.safe_load(data)

        res = await batch_api.create_namespaced_job(namespace="browsers", body=job)

        index += 1

    return {"jobid": jobid, "urls": index}
