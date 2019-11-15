from fastapi import FastAPI
from starlette.responses import HTMLResponse
from starlette.requests import Request

app = FastAPI()

@app.get("/oembed/{url:path}")
def read_root(request: Request):
    url = request.path_params['url']
    return {"url": url}


