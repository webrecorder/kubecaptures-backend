FROM webrecorder/browserkube

ENV APP_MODULE capture

COPY templates/ /app/templates/
COPY static/ /app/static/
COPY replay/ /app/replay/

ADD capture.py /app/
