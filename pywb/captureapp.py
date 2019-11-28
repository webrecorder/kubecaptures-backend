from gevent.monkey import patch_all; patch_all()

import requests
from urllib.parse import parse_qsl

from pywb.apps.frontendapp import FrontEndApp
from pywb.apps.cli import ReplayCli
from pywb.apps.wbrequestresponse import WbResponse
from warcio.timeutils import timestamp_now, timestamp_to_iso_date
from werkzeug.routing import Rule


# ============================================================================
class CaptureApp(FrontEndApp):
    def __init__(self, *args, **kwargs):
        super(CaptureApp, self).__init__(*args, **kwargs)
        self.custom_record_path = (
            self.recorder_path + '&put_record={rec_type}&url={url}'
        )

    def _init_routes(self):
        super(CaptureApp, self)._init_routes()
        self.url_map.add(
            Rule(
                '/api/screenshot/<coll>', endpoint=self.put_screenshot, methods=['PUT']
            )
        )

    def put_screenshot(self, environ, coll):
        chunks = []
        while True:
            buff = environ['wsgi.input'].read()
            print('LEN', len(buff))
            if not buff:
                break

            chunks.append(buff)

        data = b''.join(chunks)

        params = dict(parse_qsl(environ.get('QUERY_STRING')))

        return self.put_record(
            environ, coll, 'screenshot:{url}', 'resource', params, data
        )

    def put_record(self, environ, coll, target_uri_format, rec_type, params, data):
        headers = {'Content-Type': environ.get('CONTENT_TYPE', 'text/plain')}

        url = params.get('url')

        if not url:
            return WbResponse.json_response({'error': 'no url'})

        timestamp = params.get('timestamp')
        if timestamp:
            headers['WARC-Date'] = timestamp_to_iso_date(timestamp)

        target_uri = target_uri_format.format(url=url)
        put_url = self.custom_record_path.format(
            url=target_uri, coll=coll, rec_type=rec_type
        )
        res = requests.put(put_url, headers=headers, data=data)

        res = res.json()

        return WbResponse.json_response(res)


application = CaptureApp()

# ============================================================================
class Cli(ReplayCli):
    def load(self):
        super(ReplayCli, self).load()
        return CaptureApp(custom_config=self.extra_config)


# ============================================================================
#if __name__ == "__main__":
#    print('Starting pywb CaptureApp')
#    Cli().run()
