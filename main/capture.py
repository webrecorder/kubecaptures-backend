import html
import uuid
import asyncio

import urllib.parse
import datetime

from typing import List

from fastapi import Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

# pylint: disable=no-name-in-module
from pydantic import BaseModel

from browserkube import BrowserKube


# ============================================================================
class CaptureRequest(BaseModel):
    # pylint: disable=too-few-public-methods
    urls: List[str]
    userid: str = "user"
    tag: str = ""
    embeds: bool = False


# ============================================================================
class CaptureApp(BrowserKube):
    # pylint: disable=too-many-instance-attributes
    def __init__(self):
        super().__init__()

        self.app.mount("/replay", StaticFiles(directory="replay"), name="replay")

    def init_routes(self):
        # pylint: disable=unused-variable
        @self.app.get("/", response_class=HTMLResponse)
        async def read_item(request: Request):
            return self.templates.TemplateResponse("index.html", {"request": request})

        @self.app.post("/captures")
        async def start(capture: CaptureRequest):
            return await self.start_job(capture)

        @self.app.get("/captures")
        async def list_jobs(userid: str = ""):
            return await self.list_jobs(userid)

        @self.app.delete("/capture/{jobid}")
        async def delete_job(jobid: str, userid: str = ""):
            return await self.delete_job(jobid, userid)

    async def start_job(self, capture: CaptureRequest):
        jobs = []

        for capture_url in capture.urls:
            jobid = str(uuid.uuid4())

            filename = f"{ jobid }.wacz"
            storage_url = self.job_env['storage_prefix'] + filename

            try:
                download_filename = (
                    urllib.parse.urlsplit(capture_url).netloc
                    + "-"
                    + str(datetime.datetime.utcnow())[:10]
                    + ".wacz"
                )
            except Exception as exc:
                print("Error Creating Download Filename", exc)
                download_filename = None

            access_url = await self.storage.get_presigned_url(
                storage_url, download_filename
            )

            labels = {"userid": capture.userid}

            annotations = {
                "userTag": capture.tag,
                "captureUrl": capture_url,
                "storageUrl": storage_url,
                "accessUrl": access_url,
            }

            driver_env = {"STORAGE_URL": storage_url}

            if not self.job_env.get("headless"):
                driver_env["DISABLE_CACHE"] = "1"

            if capture.embeds:
                annotations["useEmbeds"] = "1"
                driver_env["EMBEDS"] = "1"

            jobs.append(
                self.init_browser_job(
                    browser=self.default_browser,
                    start_url=capture_url,
                    labels=labels,
                    annotations=annotations,
                    driver_env=driver_env,
                    use_proxy=True,
                )
            )

        job_ids = await asyncio.gather(*jobs)

        return {"urls": len(jobs), "jobids": job_ids}

    async def list_jobs(self, userid: str = ""):
        label_selector = []
        if userid:
            label_selector.append(f"userid={userid}")

        api_response = await self.k8s.list_jobs(label_selector=",".join(label_selector))

        jobs = []

        for job in api_response.items:
            data = job.metadata.labels
            data["captureUrl"] = job.metadata.annotations["captureUrl"]
            data["userTag"] = job.metadata.annotations["userTag"]
            data["startTime"] = job.status.start_time
            if job.metadata.annotations.get("useEmbeds") == "1":
                data["useEmbeds"] = True

            if job.status.completion_time:
                data["elapsedTime"] = job.status.completion_time
            else:
                data["elapsedTime"] = (
                    str(datetime.datetime.utcnow().isoformat())[:19] + "Z"
                )

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

    async def delete_job(self, jobid: str, userid: str = ""):
        api_response = await self.k8s.get_job(self.get_job_name(jobid))

        if userid and api_response.metadata.labels.get("userid") != userid:
            return {"deleted": False}

        if not api_response:
            return {"deleted": False}

        storage_url = api_response.metadata.annotations.get("storageUrl")
        if storage_url:
            await self.storage.delete_object(storage_url)

        await super().remove_browser_job(jobid)


# ============================================================================
app = CaptureApp().app
