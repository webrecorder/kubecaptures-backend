from app import application
from flask import Blueprint, jsonify, Response, send_from_directory, request
import requests
from geventwebsocket.handler import WebSocketHandler
import time

import json
import re

EMBED_SERVER = 'http://embedserver-{0}/{1}'

embeds = {}

def init_allowed_urls():
    global embeds
    with open('./embeds.json', 'rt') as fh:
        embeds = json.loads(fh.read())['embeds']

    for embed in embeds:
        embed['rx'] = re.compile(embed['rx'])

def is_valid_url(url):
    for embed in embeds:
        if embed['rx'].match(url):
            return True

    return False

def init_embeds_routes(flask_app, app):
    @app.route('/api/capture')
    def get_ws():
        ws = request.environ["wsgi.websocket"]
        url = ws.receive()

        if not is_valid_url(url):
            ws.send('error: invalid_url')
            return  ''

        # set later
        user_params = {'url': 'about:blank'}
        image_name = 'chrome:76'
        flock = 'embed_browser'
        resp = app.do_request(image_name, user_params=user_params, flock=flock)
        reqid = resp['reqid']

        print('WS URL: ' + url)

        res = app.get_pool(reqid=reqid).start(reqid, environ={'CAPTURE_URL': url})

        ws.send('id:' + reqid)

        done = False

        try:
            while True:
                res = ws.receive()
                assert res == 'ping', res

                time.sleep(3.0)

                if done:
                    continue

                try:
                    r = requests.get(EMBED_SERVER.format(reqid, 'status'))
                    ws.send('status ' + r.text)
                    res = r.json()
                    if res.get('done'):
                        done = True

                except Exception as e:
                    print(e)
                    ws.send('error')
                    break

        except Exception as ee:
            print(ee)

        finally:
            print('stopping flock: ' + reqid)
            app.get_pool(reqid=reqid).stop(reqid)
            return ''


    @app.route('/api/download/<reqid>/<name>.warc')
    def download_warc(reqid, name):
        try:
            r = requests.get(EMBED_SERVER.format(reqid, 'download'), stream=True)
            if r.status_code == 404:
                return jsonify({'error': 'not_yet_ready'})

            return Response(r.iter_content(1024*32), mimetype='application/octet-stream')
        except Exception as e:
            return jsonify({'error': str(e)})

    @app.route('/sw.js')
    def static_sw():
        return send_from_directory('/app/static', 'sw.js')


def main():
    embeds = Blueprint('embeds', 'embeds', template_folder='templates', static_folder='static')
    init_allowed_urls()
    init_embeds_routes(embeds, application)
    application.register_blueprint(embeds)


main()


# ============================================================================
if __name__ == '__main__':
    from gevent.pywsgi import WSGIServer
    WSGIServer(('0.0.0.0', 9020), application, handler_class=WebSocketHandler).serve_forever()



