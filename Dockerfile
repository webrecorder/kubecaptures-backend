FROM oldwebtoday/shepherd:1.2.0-dev

RUN pip install gevent-websocket

CMD python -u main.py

COPY main.py driver/embeds.json /app/
COPY flocks/ /app/flocks/
COPY templates/ /app/templates/
COPY static/ /app/static/
COPY pool_config.yaml /app/pool_config.yaml
