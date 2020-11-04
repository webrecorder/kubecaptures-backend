import asyncio
from datetime import datetime, timezone
import html
import re
import uuid

from fastapi import Request, Query
from fastapi.responses import HTMLResponse
from fastapi.openapi.utils import get_openapi
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, HttpUrl, AnyHttpUrl, UUID4, validator
from typing import Optional, List, Dict, Literal

from browserkube import BrowserKube

# pylint: disable=no-name-in-module

# ============================================================================

K8S_LABEL_PATTERN = '^(([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9])?$'
K8S_LABEL_REGEX = re.compile(K8S_LABEL_PATTERN)
K8S_LABEL_MESSAGE = "{} must consist of alphanumeric characters, '-', '_' or '.', and must start and end with an alphanumeric character."


class Webhook(BaseModel):
    callbackUrl: AnyHttpUrl = Field(..., title='Callback URL',
        description='URL to notify when the capture job is complete.',
        example='http://example.com/callback'
    )
    signingKey: Optional[str] = Field(None, title='Signing Key',
        description="Key to use, when signing the webhook notification.",
        example="a-high-entropy-key-signing-key"
    )
    # All algorithms supported by the version of OpenSSL installed in the "Driver"
    # container are permitted (`docker run node:12.14 openssl list -digest-algorithms`).
    # For simplicity, we restrict to a small subset.
    signingKeyAlgorithm: Optional[Literal['sha1', 'sha224', 'sha256', 'sha384', 'sha512']] = Field(
        None,
        title='Signing Key Algorithm',
        description='Algorithm to use, when signing the webhook notification',
        example='sha256'
    )
    userDataField: Optional[str] = Field(None, title='User Data Field',
        description="For use in passing extra information to your callback: a string you would like included, verbatim, in the webhook notification response.",
        example="foo=bar&boo=baz"
    )

    @validator('signingKey')
    def key_and_algorithm(cls, v, values, **kwargs):
        if 'signingKey' in values and signingKeyAlgorithm not in values:
            raise ValueError('Please specify both signingKey and signingKeyAlgorithm.')
        return v

    @validator('signingKeyAlgorithm')
    def algorithm_and_key(cls, v, values, **kwargs):
        if 'signingKeyAlgorithm' in values and signingKey not in values:
            raise ValueError('Please specify both signingKey and signingKeyAlgorithm.')
        return v


class WebhookList(BaseModel):
    """
    A series of URLs to notify when the capture job is complete.

    Each specified `callbackUrl` will receive an HTTP POST including the `jobid`,
    captured `url`, and `userid` of the capture job (if any). If a value for
    `userDataField` was supplied, it will be included, verbatim, in the response.

    If a `signingKey` and `signingKeyAlgorithm` are provided, the response data
    will be [signed](https://github.com/webrecorder/kubecaptures-backend/blob/main/driver/utils.js#L99)
    and the signature included in the `X-Hook-Signature` HTTP header.
    """
    # This is a convenience model, used to provide a) easy access to the JSON-serialized
    # list of webhooks after validation and b) a good spot for the above the extended
    # description, which appears in the schema.
    __root__: List[Webhook]

    def __iter__(self):
        return iter(self.__root__)

    def __getitem__(self, item):
        return self.__root__[item]


class CaptureRequest(BaseModel):
    # pylint: disable=too-few-public-methods
    urls: List[HttpUrl] = Field(..., title='URLs to Capture',
        description='A list of any length. Permitted schemas: http or https. TLD required.',
        example='http://example.com'
    )
    userid: Optional[str] = Field('', title='Username or User ID',
        description='Label the capture jobs launched by this request with a username/userid so they may selectively be retrieved via "GET /captures?userid=\{userid\}."' + K8S_LABEL_MESSAGE.format(' It'),
        pattern=K8S_LABEL_PATTERN,
        example='2193'
    )
    tag: Optional[str] = Field('', title='Tag',
        description='Annotate the capture jobs launched by this request with a tag of your choice.',
        example='my_value_1.1'
    )
    embeds: Optional[bool] = Field(False, title='Capture oEmbed View of URL', description='See [Capture of "Embeddable" Views](https://capture.perma.cc/docs/#capturing-advanced-features) for details.')
    webhooks: Optional[WebhookList] = None

    @validator('userid')
    def valid_userid_chars(cls, v, values, **kwargs):
        if not K8S_LABEL_REGEX.fullmatch(v):
            raise ValueError(K8S_LABEL_MESSAGE.format('userid'))
        return v

    class Config:
        schema_extra = {
            "example": {
                "urls": [
                    "http://example.com"
                ],
                "userid": "2192",
                "webhooks": [{
                    "callBackUrl": "http://example.com/callback",
                    "signingKey": "a-signing-key",
                    "signingKeyAlgorithm": "sha256",
                    "userDataField": "foo=bar&boo=baz"
                }],
            }
        }


class CaptureRequestResponse(BaseModel):
    urls: int = Field(...,
        title='URLs',
        description='The count of successfully submitted capture jobs. Equal to the length of `jobids`.'
    )
    jobids: List[UUID4] = Field(..., title='Capture Job IDs')

    class Config:
        schema_extra = {
            "example": {
                "urls": 1,
                "jobids": ["9296b848-20c9-43b4-a2bc-debfead8f1b1"],
            }
        }


class CaptureJob(BaseModel):
    jobid: UUID4 = Field(..., title='Capture Job ID')
    userid: str = Field(..., title='Username/User ID',
        description='The username or userid labeling the job, supplied by the user at job creation.',
        pattern=K8S_LABEL_PATTERN,
        example='2193'
    )
    captureUrl: HttpUrl = Field(..., title='Captured (Target) URL',
        example='http://example.com'
    )
    useEmbeds: bool = Field(..., title='Capture Incdlues oEmbed View of URL',
        description='Did the user request the oEmbed view be included in the archive? See [Capture of "Embeddable" Views](https://capture.perma.cc/docs/#capturing-advanced-features) for details.'
    )
    userTag: str = Field(..., title='User-Supplied Tag',
        description='The tag annotating the job, supplied by the user at job creation.',
        example='my_value_1.1'
    )
    startTime: datetime = Field(..., title='Start Time')
    elapsedTime: datetime = Field (..., title='Elapsed Time')
    accessUrl: HttpUrl = Field(None, title='Access URL',
        description='The publicly-accessible, presigned URL from which the archive may be downloaded. This field is only populated once the job is "Complete".',
    )
    # 'status' must be defined last so that all other fields have been validated
    # and therefore should be present in 'values' when our custom validator runs.
    status: Literal['In progress', 'Complete', 'Failed', 'Unknown']

    @validator('status')
    def accessUrl_if_complete(cls, v, values, **kwargs):
        if v == 'Complete':
            if not values.get('accessUrl'):
                raise ValueError('"Complete" capture jobs must have an accessUrl.')
        elif values.get('accessUrl'):
            raise ValueError('Only "Complete" capture jobs may have an accessUrl.')
        return v


class CaptureJobListResponse(BaseModel):
    jobs: List[CaptureJob]

    class Config:
        schema_extra = {
            "example": {
                "jobs": [
                    {
                        "jobid": "3834c425-d0c5-4c0f-ba00-95474a962247",
                        "userid": "2139",
                        "captureUrl": "http://example.com",
                        "useEmbeds": False,
                        "userTag": "",
                        "startTime":"2020-11-03T20:59:00+00:00",
                        "elapsedTime":"2020-11-03T20:59:29+00:00",
                        "status": "Failed"
                    },
                    {
                        "jobid": "43973804-f513-40c8-83de-bf478d1f4c44",
                        "userid": "abcd",
                        "captureUrl": "http://example.com/page1",
                        "useEmbeds": True,
                        "userTag": "my_value_1.1",
                        "startTime": "2020-11-03T16:51:07+00:00",
                        "elapsedTime":"2020-11-03T16:51:31+00:00",
                        "accessUrl": "http://minio.default.svc.cluster.local:9000/kubecaptures/e7fb8701-3754-4bd8-b4ed-de7b1fe75a1f.wacz?response-content-disposition=attachment%3B%20filename%3Dexample.com-2020-11-03.wacz&AWSAccessKeyId=YOURACCESSKEY&Signature=h3fZWDyXOFGYzau3gqr7wikgUHU%3D&Expires=1604436667",
                        "status": "Complete"
                    },
                    {
                        "jobid": "9e42748a-2d38-4dd6-976d-5e076992247b",
                        "userid": "",
                        "captureUrl": "http://example.com/page2",
                        "useEmbeds": False,
                        "userTag": "",
                        "startTime":"2020-11-03T20:59:00+00:00",
                        "elapsedTime":"2020-11-03T20:59:05+00:00",
                        "status": "In progress"
                    }
                ]
            }
        }


# ============================================================================
class CaptureApp(BrowserKube):
    # pylint: disable=too-many-instance-attributes
    def __init__(self):
        super().__init__()

        self.app.mount("/replay", StaticFiles(directory="replay"), name="replay")

    def init_routes(self):
        """
        This overrides and replaces the routes defined in the upstream Browserkube repo.
        """
        @self.app.get("/", response_class=HTMLResponse, tags=["HTML Pages"])
        async def home(request: Request):
            return self.templates.TemplateResponse("index.html", {"request": request})

        @self.app.post("/captures",
            responses={201: {"description": "Capture Jobs Created."}},
            response_model=CaptureRequestResponse,
            status_code=201,
            tags=["Capture Jobs"]
        )
        async def start_capture_jobs(capture_request: CaptureRequest):
            return await self.start_job(capture_request)

        @self.app.get("/captures", response_model=CaptureJobListResponse, tags=["Capture Jobs"])
        async def list_capture_jobs(userid: Optional[str] = Query(
                "",
                title="Username/User ID",
                description="Limit to jobs labeled with this username/user id at their creation.",
                regex=K8S_LABEL_PATTERN,
                example="2139"
            )):
            return await self.list_jobs(userid)

        @self.app.delete("/capture/{jobid}")
        async def delete_capture_job(jobid: str, userid: str = ""):
            return await self.delete_job(jobid, userid)

    async def start_job(self, capture_request: CaptureRequest):
        """
        Launch a k8s job for each requested URL.
        """
        jobs = []
        for capture_url in capture_request.urls:
            jobid = str(uuid.uuid4())

            # Regarding URLs, filenames, and paths:
            #
            # storage_url: This is parsed via code in the upstream repo then
            #    used to construct the desired bucket name and key:
            #    ```
            #    parts = urllib.parse.urlsplit(url)
            #    params = {"Bucket": parts.netloc, "Key": parts.path[1:]}
            #    ```
            #    The protocol is ignored, and is arbitrary: it simply allows
            #    the parsing function to work. We may wish to refactor later.
            #
            # download_filename: The name of the archive file as we'd like it
            #    to appear, when a user follows the download link.
            #
            # access_url: The presigned URL users can use to download the archive.
            storage_url = f"{ self.job_env['storage_prefix'] }{ jobid }.wacz"
            download_filename = f"{ capture_url.host }{ capture_url.port or '' }-{datetime.now(timezone.utc):%Y-%m-%d}.wacz"
            access_url = await self.storage.get_presigned_url(
                storage_url, download_filename
            )

            # Regarding Labels, Annotations, and Driver ENV:
            #
            # labels can be used to select and filter k8s jobs. labels are validated
            #    by K8S_LABEL_PATTERN.
            #
            # annotations can be used to associate other metadata with a job. Annotation
            #    keys can only contain certain characters and must follow a convention:
            #    https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations/#syntax-and-character-set.
            #    Annotation values are seeming unconstrained (spaces, commas, unicode, etc.).
            #
            # driver_env can be used to pass data to the job's driver container
            #    via ENV vars, accessible via `process.env`. The values provided
            #    here are interpolated upstream into a Jinja template before passing
            #    to k8s:
            #    ```
            #    data = self.templates.env.get_template("browser-job.yaml").render(config)
            #    job = yaml.safe_load(data)
            #    await self.k8s.create_job(job)
            #    ```
            #    In the process, the values are HTML-encoded. So, be aware: if you add
            #    new values, you will need to unencode them inside the driver container.
            #    Values are seemingly unconstrained (spaces, unicode, etc.).
            labels = {"userid": capture_request.userid}
            annotations = {
                "userTag": capture_request.tag,
                "captureUrl": capture_url,
                "storageUrl": storage_url,
                "accessUrl": access_url,
            }
            driver_env = {
                "STORAGE_URL": storage_url,
                "USERID": capture_request.userid,
                "JOBID": jobid
            }
            if capture_request.webhooks:
                driver_env["WEBHOOK_DATA"] = capture_request.webhooks.json()
            if not self.job_env.get("headless"):
                driver_env["DISABLE_CACHE"] = "1"
            if capture_request.embeds:
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
        return CaptureRequestResponse(urls=len(jobs), jobids=job_ids)

    async def list_jobs(self, userid: str = ""):
        """
        Retrieve all k8s capture jobs, or optionally, only those labeled with `userid`.
        """
        api_response = await self.k8s.list_jobs(label_selector=f"userid={userid}" if userid else "")
        jobs = []
        for job in api_response.items:
            if job.status.active:
                status = "In progress"
            elif job.status.failed:
                status = "Failed"
            elif job.status.succeeded:
                status = "Complete"
            else:
                # When does this happen? Let's look at the Kubernetes docs
                # and see if we can report something more useful than 'Unknown'.
                # Probably, these are failures of a particular variety.
                status = "Unknown"
            jobs.append(CaptureJob(
                jobid = job.metadata.labels.get('jobid'),
                userid = job.metadata.labels.get('userid'),
                captureUrl = job.metadata.annotations["captureUrl"],
                useEmbeds = job.metadata.annotations.get("useEmbeds") == "1",
                userTag = job.metadata.annotations["userTag"],
                startTime = job.status.start_time,
                elapsedTime = job.status.completion_time or datetime.now(timezone.utc).replace(microsecond=0),
                accessUrl = html.unescape(job.metadata.annotations["accessUrl"]) if status == 'Complete' else None,
                status = status
            ))
        return CaptureJobListResponse(jobs=jobs)

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

# In the future, title and version should be set via the Helm chart's config,
# and passed into self.app = FastAPI() in the upstream repository, as per
# https://fastapi.tiangolo.com/tutorial/metadata/#title-description-and-version.
# Hard-coding and overriding here for now.
def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    openapi_schema = get_openapi(
        title="KubeCaptures Backend",
        version="0.0.1",
        description="Capture individual target URLs on demand.",
        routes=app.routes,
    )
    app.openapi_schema = openapi_schema
    return app.openapi_schema
app.openapi = custom_openapi
