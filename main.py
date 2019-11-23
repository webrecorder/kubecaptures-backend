from app import application
from flask import Blueprint, jsonify, Response, send_from_directory, request
import requests
from geventwebsocket.handler import WebSocketHandler
import time


def init_embeds_routes(flask_app, app):
    @app.route('/api/capture/<path:url>')
    def start_embed(url):
        #user_params = {'url': url, 'timestamp': ''}
        user_params = {'url': 'about:blank'}
        image_name = 'chrome:76'
        flock = 'embed_browser'
        resp = app.do_request(image_name, user_params=user_params, flock=flock)
        reqid = resp['reqid']

        if request.query_string:
            url += '?' + request.query_string.decode('utf-8')

        res = app.get_pool(reqid=reqid).start(reqid, environ={'CAPTURE_URL': url})
        #return app.get_pool(reqid=reqid).start(reqid, environ=json_data.get('environ'))
        return jsonify({'id': reqid})

    @app.route('/api/capture')
    def get_ws():
        ws = request.environ["wsgi.websocket"]
        url = ws.receive()

        # set later
        user_params = {'url': 'about:blank'}
        image_name = 'chrome:76'
        flock = 'embed_browser'
        resp = app.do_request(image_name, user_params=user_params, flock=flock)
        reqid = resp['reqid']

        if request.query_string:
            url += '?' + request.query_string.decode('utf-8')

        print('WS URL: ' + url)

        res = app.get_pool(reqid=reqid).start(reqid, environ={'CAPTURE_URL': url})

        ws.send('id:' + reqid)

        done = False

        try:
            while True:
                print('Wait for ping')
                res = ws.receive()
                assert res == 'ping', res
                print('Got ping')

                time.sleep(3.0)

                if done:
                    continue

                try:
                    r = requests.get('http://embedserver-{0}:3000/done'.format(reqid))
                    if r.json().get('done'):
                        ws.send('done')
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


    @app.route('/api/done/<reqid>')
    def is_ready(reqid):
        try:
            r = requests.get('http://embedserver-{0}:3000/done'.format(reqid))
            print(r.text)
            return jsonify(r.json())
        except Exception as e:
            return jsonify({'error': str(e)})

    @app.route('/api/download/<reqid>.warc')
    def download_warc(reqid):
        try:
            r = requests.get('http://embedserver-{0}:3000/download'.format(reqid), stream=True)
            if r.status_code == 404:
                return jsonify({'error': 'not_yet_ready'})

            return Response(r.iter_content(1024*32), mimetype='application/octet-stream')
        except Exception as e:
            return jsonify({'error': str(e)})

    @app.route('/api/download/<reqid>.png')
    def download_png(reqid):
        try:
            r = requests.get('http://embedserver-{0}:3000/screenshot'.format(reqid), stream=True)
            if r.status_code == 404:
                return jsonify({'error': 'not_yet_ready'})

            return Response(r.iter_content(1024*32), mimetype='image/png')
        except Exception as e:
            return jsonify({'error': str(e)})

    @app.route('/sw.js')
    def static_sw():
        return send_from_directory('/app/static', 'sw.js')


def main():
    embeds = Blueprint('embeds', 'embeds', template_folder='templates', static_folder='static')
    init_embeds_routes(embeds, application)
    application.register_blueprint(embeds)


main()


# ============================================================================
if __name__ == '__main__':
    from gevent.pywsgi import WSGIServer
    WSGIServer(('0.0.0.0', 9020), application, handler_class=WebSocketHandler).serve_forever()



